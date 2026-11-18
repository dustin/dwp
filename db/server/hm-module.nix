# Home-manager module for the dwp database's server: a DuckDB session with
# the dwp database (one DuckDB file, DIR/dwp.duckdb) attached as `dwp`,
# served over Quack, DuckDB 2.0's remote protocol, so every dwp tool
# reaches it the usual way (DWP_DB's quack-init.sql), from any host.
#
#   services.dwp-db = {
#     enable = true;
#     tokenFile = config.sops.secrets.quack-token.path;
#   };
#
# It listens on localhost only; TLS and the tailnet name come from a proxy
# in front of it (`tailscale serve`). A systemd user service on Linux, a
# launchd agent on macOS.
#
# The server is the file's only writer: DuckDB locks it, so everything
# else goes through quack (or dwp-db-local with the server stopped).
#
# Also a nightly dwp-db-maintenance (maintenance.sql) through the server,
# optionally a nightly dwp-db-backup (backup.*), and dwp-db-local, a
# DuckDB CLI with the file attached directly.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-db;
  # The file is DuckDB 2.0's format; use ../../nix/duckdb.nix's until pkgs has it.
  duckdb = if lib.versionAtLeast pkgs.duckdb.version "2" then pkgs.duckdb
    else pkgs.callPackage ../../nix/duckdb.nix { inherit (pkgs) duckdb; };

  sessionSql = pkgs.writeText "dwp-db-session.sql" ''
    .output /dev/null
    ${builtins.readFile ./init.sql}
    SET memory_limit = '${cfg.memoryLimit}';
    SET threads = ${toString cfg.threads};
    SET temp_directory = '${cfg.dir}/.tmp';
    ATTACH '${cfg.dir}/dwp.duckdb' AS dwp;
    USE dwp;
    .output
  '';

  server = pkgs.writeShellApplication {
    name = "dwp-db-server";
    runtimeInputs = [ duckdb pkgs.coreutils ];
    text = ''
      dir=${lib.escapeShellArg cfg.dir}
      token_file=${lib.escapeShellArg cfg.tokenFile}

      if [ ! -f "$dir/dwp.duckdb" ]; then
        echo "dwp-db: no $dir/dwp.duckdb" >&2
        exit 1
      fi

      # The token is rendered by sops at login, maybe after this starts.
      for _ in $(seq 60); do
        [ -s "$token_file" ] && break
        sleep 2
      done
      if [ ! -s "$token_file" ]; then
        echo "dwp-db: no token in $token_file" >&2
        exit 1
      fi
      token=$(tr -d '\n' < "$token_file")

      mkdir -p "$dir/.tmp"
      cd "$dir"
      # The CLI serves while it reads stdin: feed it the SQL, then a stdin
      # that never ends. .bail around quack_serve so a failure exits (and
      # the service manager restarts it) instead of idling unserved.
      exec duckdb < <(
        printf '.read %s\n' ${sessionSql}
        printf '.bail on\nINSTALL quack; LOAD quack;\n'
        printf "CALL quack_serve('%s', token = '%s');\n.bail off\n" \
          ${lib.escapeShellArg cfg.listen} "$token"
        exec tail -f /dev/null
      )
    '';
  };

  # The file opened directly, without the server: for one-off work while
  # dwp-db is stopped (or refusing to start).
  local = pkgs.writeShellApplication {
    name = "dwp-db-local";
    runtimeInputs = [ duckdb ];
    text = ''
      cd ${lib.escapeShellArg cfg.dir}
      duckdb -init ${sessionSql} "$@"
    '';
  };

  # Each table in main copied to BACKUP_DIR/tables/<table>.parquet (zstd
  # 9), synced to backup.remote (this database's own prefix), and,
  # separately, a full copy as one DuckDB file, xz'd, at
  # BACKUP_DIR/dwp.duckdb.xz. The COPYs run in the server's session
  # through quack, so the paths are the server's: this belongs on the
  # database's host.
  backup = pkgs.writeShellApplication {
    name = "dwp-db-backup";
    runtimeInputs = [ duckdb pkgs.rclone pkgs.xz pkgs.coreutils pkgs.gnugrep ];
    text = ''
      bak=${lib.escapeShellArg cfg.backup.dir}
      out=$bak/tables
      mkdir -p "$out"
      cd "''${DWP_DB:-${cfg.client}}"
      rm -f "$bak/tables.list" "$bak/full.tmp.duckdb" "$bak/full.tmp.duckdb.xz"

      # Right after a (re)start the server isn't listening yet; give it
      # two minutes before failing.
      for i in $(seq 24); do
        duckdb -bail --init quack-init.sql -c 'select 1' >/dev/null 2>&1 && break
        if [ "$i" = 24 ]; then
          echo "dwp-db-backup: server not answering" >&2
          exit 1
        fi
        sleep 5
      done

      # The CLI's .output writes here, so the list of tables comes back as
      # a file; keep only names, since 2.0 may print warnings first.
      duckdb -bail --init quack-init.sql <<SQL
      .mode list
      .headers off
      .output $bak/tables.list
      select table_name from duckdb_tables()
       where database_name = 'dwp' and schema_name = 'main' order by 1;
      .output
      SQL
      sql=""
      while read -r t; do
        sql+="copy (from main.\"$t\") to '$out/$t.parquet' (compression zstd, compression_level 9);"$'\n'
      done < <(grep -E '^[a-z_][a-z0-9_]*$' "$bak/tables.list")
      if [ -z "$sql" ]; then
        echo "dwp-db-backup: no tables found in dwp.main" >&2
        exit 1
      fi
      echo "copying $(grep -c . <<< "$sql") tables to $out"
      duckdb -bail --init quack-init.sql <<< "$sql"

      echo "syncing to ${cfg.backup.remote}"
      rclone sync -v "$out/" ${lib.escapeShellArg cfg.backup.remote}

      echo "full copy to $bak/dwp.duckdb.xz"
      duckdb -bail --init quack-init.sql <<SQL
      DETACH DATABASE IF EXISTS bak;
      ATTACH '$bak/full.tmp.duckdb' AS bak;
      COPY FROM DATABASE dwp TO bak;
      DETACH bak;
      SQL
      xz -9 -T0 "$bak/full.tmp.duckdb"
      mv "$bak/full.tmp.duckdb.xz" "$bak/dwp.duckdb.xz"
    '';
  };

  maintenance = pkgs.writeShellApplication {
    name = "dwp-db-maintenance";
    runtimeInputs = [ duckdb ];
    text = ''
      cd "''${DWP_DB:-${cfg.client}}"
      exec duckdb -bail --init quack-init.sql < ${./maintenance.sql}
    '';
  };
in
{
  options.services.dwp-db = with lib; {
    enable = mkEnableOption "the dwp database's Quack server";
    dir = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/db/dwp";
      description = "Directory holding dwp.duckdb.";
    };
    listen = mkOption {
      type = types.str;
      # Not 9494, the big lake's port on dsstudio, so both can share a host.
      default = "quack:127.0.0.1:9495";
      description = "Quack listen URI. Keep it on localhost; put a TLS proxy in front.";
    };
    tokenFile = mkOption {
      type = types.str;
      description = "File holding the Quack token clients attach with.";
    };
    memoryLimit = mkOption {
      type = types.str;
      default = "3GB";
      description = "DuckDB memory_limit for the session.";
    };
    threads = mkOption {
      type = types.int;
      default = 4;
      description = "DuckDB threads for the session.";
    };
    client = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/.config/duckq/dwp";
      description = "DWP_DB for maintenance and backup: a directory whose quack-init.sql connects to this server.";
    };
    maintenance = mkOption {
      type = types.bool;
      default = true;
      description = "Run maintenance.sql nightly at 03:30.";
    };
    backup = {
      enable = mkEnableOption "the nightly per-table Parquet copy (03:00) to S3 and full .duckdb.xz copy";
      dir = mkOption {
        type = types.str;
        default = "${config.home.homeDirectory}/db/dwp-bak";
        description = "Where tables/<table>.parquet and dwp.duckdb.xz are kept.";
      };
      remote = mkOption {
        type = types.str;
        example = "s3:backup.west.spy.net/dwp-db/";
        description = "rclone destination the Parquet files are synced to: this database's alone, since sync deletes what isn't in BACKUP_DIR/tables.";
      };
      rcloneConfig = mkOption {
        type = types.nullOr types.str;
        default = null;
        description = "RCLONE_CONFIG with the remote's credentials (null for rclone's default).";
      };
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    { home.packages = [ maintenance local ] ++ lib.optional cfg.backup.enable backup; }

    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      systemd.user.services.dwp-db = {
        Unit = {
          Description = "dwp database Quack server";
          After = [ "sops-nix.service" ];
        };
        Service = {
          ExecStart = lib.getExe server;
          Restart = "always";
          RestartSec = 30;
          LimitNOFILE = 65536;
        };
        Install.WantedBy = [ "default.target" ];
      };
      systemd.user.services.dwp-db-backup = lib.mkIf cfg.backup.enable {
        Unit.Description = "dwp database backup (export to S3, full copy)";
        Service = {
          Type = "oneshot";
          ExecStart = lib.getExe backup;
          Environment = lib.optional (cfg.backup.rcloneConfig != null)
            "RCLONE_CONFIG=${cfg.backup.rcloneConfig}";
        };
      };
      systemd.user.timers.dwp-db-backup = lib.mkIf cfg.backup.enable {
        Unit.Description = "dwp database backup, nightly";
        Timer = {
          OnCalendar = "*-*-* 03:00:00";
          Persistent = true;
        };
        Install.WantedBy = [ "timers.target" ];
      };
      systemd.user.services.dwp-db-maintenance = lib.mkIf cfg.maintenance {
        Unit.Description = "dwp database maintenance";
        Service = {
          Type = "oneshot";
          ExecStart = lib.getExe maintenance;
        };
      };
      systemd.user.timers.dwp-db-maintenance = lib.mkIf cfg.maintenance {
        Unit.Description = "dwp database maintenance, nightly";
        Timer = {
          OnCalendar = "*-*-* 03:30:00";
          Persistent = true;
        };
        Install.WantedBy = [ "timers.target" ];
      };
    })

    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents.dwp-db = {
        enable = true;
        config = {
          Label = "pro.downwind.db";
          ProgramArguments = [ (lib.getExe server) ];
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 30;
          SoftResourceLimits.NumberOfFiles = 65536;
          HardResourceLimits.NumberOfFiles = 65536;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-db.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-db.log";
        };
      };
      launchd.agents.dwp-db-backup = lib.mkIf cfg.backup.enable {
        enable = true;
        config = {
          Label = "pro.downwind.db-backup";
          ProgramArguments = [ (lib.getExe backup) ];
          StartCalendarInterval = [ { Hour = 3; Minute = 0; } ];
          EnvironmentVariables = lib.optionalAttrs (cfg.backup.rcloneConfig != null)
            { RCLONE_CONFIG = cfg.backup.rcloneConfig; };
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-db-backup.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-db-backup.log";
        };
      };
      launchd.agents.dwp-db-maintenance = lib.mkIf cfg.maintenance {
        enable = true;
        config = {
          Label = "pro.downwind.db-maintenance";
          ProgramArguments = [ (lib.getExe maintenance) ];
          StartCalendarInterval = [ { Hour = 3; Minute = 30; } ];
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-db-maintenance.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-db-maintenance.log";
        };
      };
    })
  ]);
}
