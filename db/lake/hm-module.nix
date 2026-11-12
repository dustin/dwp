# Home-manager module for the dwp lake's server: a DuckDB session with the
# dwp DuckLake (SQLite catalog + Parquet files in one directory) attached
# as `lake`, served over Quack, DuckDB 2.0's remote protocol, so every dwp
# tool reaches it the usual way (LAKE's quack-init.sql), from any host.
#
#   services.dwp-lake = {
#     enable = true;
#     tokenFile = config.sops.secrets.quack-token.path;
#   };
#
# It listens on localhost only; TLS and the tailnet name come from a proxy
# in front of it (`tailscale serve`). A systemd user service on Linux, a
# launchd agent on macOS.
#
# DIR holds lake.sqlite3 and lake/ (the catalog's data_path, relative) and
# a .lake-name file reading `dwp`: the server won't start without it, so it
# can't serve some other lake's directory by mistake. lake/ must be this
# lake's alone, since maintenance deletes files the catalog doesn't list.
#
# Also a nightly dwp-lake-maintenance (maintenance.sql) through the server,
# optionally a nightly dwp-lake-backup (backup.*),
# and dwp-lake-local, a DuckDB CLI with the lake attached directly.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-lake;
  # The lake is on DuckDB 2.0; use ../../nix/duckdb.nix's until pkgs has it.
  duckdb = if lib.versionAtLeast pkgs.duckdb.version "2" then pkgs.duckdb
    else pkgs.callPackage ../../nix/duckdb.nix { inherit (pkgs) duckdb; };

  sessionSql = pkgs.writeText "dwp-lake-session.sql" ''
    .output /dev/null
    ${builtins.readFile ./init.sql}
    SET memory_limit = '${cfg.memoryLimit}';
    SET threads = ${toString cfg.threads};
    SET temp_directory = '${cfg.dir}/.tmp';
    ATTACH 'ducklake:sqlite:${cfg.dir}/lake.sqlite3' AS lake
      (DATA_PATH '${cfg.dir}/lake/', OVERRIDE_DATA_PATH true);
    USE lake;
    .output
  '';

  # Prints a CREATE SECRET for the lake's data files in S3
  # (s3://lake.west.spy.net/files/...), with the default profile's key from
  # the AWS credentials file (the aws extension's credential chain wants a
  # ~/.aws/config too). Same region as the big lake's secret. Nothing
  # without the file.
  s3Secret = ''
    s3_secret() {
      local f=${lib.escapeShellArg cfg.awsCredentials} id="" key=""
      [ -r "$f" ] || return 0
      id=$(sed -n 's/^[[:space:]]*aws_access_key_id[[:space:]]*=[[:space:]]*//p' "$f" | head -n 1)
      key=$(sed -n 's/^[[:space:]]*aws_secret_access_key[[:space:]]*=[[:space:]]*//p' "$f" | head -n 1)
      [ -n "$id" ] && [ -n "$key" ] || return 0
      printf "CREATE OR REPLACE SECRET lake_s3 (TYPE s3, KEY_ID '%s', SECRET '%s', REGION '%s');\n" \
        "$id" "$key" ${lib.escapeShellArg cfg.s3Region}
    }
  '';

  server = pkgs.writeShellApplication {
    name = "dwp-lake-server";
    runtimeInputs = [ duckdb pkgs.coreutils pkgs.gnused ];
    text = s3Secret + ''
      dir=${lib.escapeShellArg cfg.dir}
      token_file=${lib.escapeShellArg cfg.tokenFile}

      if [ "$(cat "$dir/.lake-name" 2> /dev/null)" != dwp ]; then
        echo "dwp-lake: $dir/.lake-name doesn't say dwp; not serving it" >&2
        exit 1
      fi
      if [ -L "$dir/lake" ] || [ ! -d "$dir/lake" ] || [ ! -f "$dir/lake.sqlite3" ]; then
        echo "dwp-lake: $dir needs lake.sqlite3 and its own lake/ directory (not a link)" >&2
        exit 1
      fi

      # The token is rendered by sops at login, maybe after this starts.
      for _ in $(seq 60); do
        [ -s "$token_file" ] && break
        sleep 2
      done
      if [ ! -s "$token_file" ]; then
        echo "dwp-lake: no token in $token_file" >&2
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
        printf '.output /dev/null\n'; s3_secret; printf '.output\n'
        printf '.bail on\nINSTALL quack; LOAD quack;\n'
        printf "CALL quack_serve('%s', token = '%s');\n.bail off\n" \
          ${lib.escapeShellArg cfg.listen} "$token"
        exec tail -f /dev/null
      )
    '';
  };

  # The lake opened directly, without the server: for one-off work while
  # dwp-lake is stopped (or refusing to start), like the split's drops.
  local = pkgs.writeShellApplication {
    name = "dwp-lake-local";
    runtimeInputs = [ duckdb pkgs.coreutils pkgs.gnused ];
    text = s3Secret + ''
      cd ${lib.escapeShellArg cfg.dir}
      init=$(umask 077; mktemp)
      trap 'rm -f "$init"' EXIT
      { cat ${sessionSql}; printf '.output /dev/null\n'; s3_secret; printf '.output\n'; } > "$init"
      duckdb -init "$init" "$@"
    '';
  };

  # The big lake's back-the-duck-up.sh, for this lake: each table in main
  # copied to BACKUP_DIR/lake/<table>.parquet (zstd 9, the names its
  # backup.sql used), synced to backup.remote (this lake's own prefix),
  # and, separately, a full copy as one DuckDB file, xz'd, at
  # BACKUP_DIR/lake.db.xz. The COPYs run in the server's session through
  # quack, so the paths are the server's: this belongs on the lake's host.
  backup = pkgs.writeShellApplication {
    name = "dwp-lake-backup";
    runtimeInputs = [ duckdb pkgs.rclone pkgs.xz pkgs.coreutils pkgs.gnugrep ];
    text = ''
      bak=${lib.escapeShellArg cfg.backup.dir}
      out=$bak/lake
      mkdir -p "$out"
      cd "''${LAKE:-${cfg.client}}"
      rm -f "$bak/tables" "$bak/full.tmp.db" "$bak/full.tmp.db.xz"

      # The CLI's .output writes here, so the list of tables comes back as
      # a file; keep only names, since 2.0 may print warnings first.
      duckdb -bail --init quack-init.sql <<SQL
      .mode list
      .headers off
      .output $bak/tables
      select table_name from duckdb_tables()
       where database_name = 'lake' and schema_name = 'main' order by 1;
      .output
      SQL
      sql=""
      while read -r t; do
        sql+="copy (from main.\"$t\") to '$out/$t.parquet' (compression zstd, compression_level 9);"$'\n'
      done < <(grep -E '^[a-z_][a-z0-9_]*$' "$bak/tables")
      if [ -z "$sql" ]; then
        echo "dwp-lake-backup: no tables found in lake.main" >&2
        exit 1
      fi
      echo "copying $(grep -c . <<< "$sql") tables to $out"
      duckdb -bail --init quack-init.sql <<< "$sql"

      echo "syncing to ${cfg.backup.remote}"
      rclone sync -v "$out/" ${lib.escapeShellArg cfg.backup.remote}

      echo "full copy to $bak/lake.db.xz"
      duckdb -bail --init quack-init.sql <<SQL
      DETACH DATABASE IF EXISTS bak;
      ATTACH '$bak/full.tmp.db' AS bak;
      COPY FROM DATABASE lake TO bak;
      DETACH bak;
      SQL
      xz -9 -T0 "$bak/full.tmp.db"
      mv "$bak/full.tmp.db.xz" "$bak/lake.db.xz"
    '';
  };

  maintenance = pkgs.writeShellApplication {
    name = "dwp-lake-maintenance";
    runtimeInputs = [ duckdb ];
    text = ''
      cd "''${LAKE:-${cfg.client}}"
      exec duckdb -bail --init quack-init.sql < ${./maintenance.sql}
    '';
  };
in
{
  options.services.dwp-lake = with lib; {
    enable = mkEnableOption "the dwp lake's Quack server";
    dir = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/lakes/dwp";
      description = "The lake: lake.sqlite3, lake/ and .lake-name.";
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
    awsCredentials = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/.aws/credentials";
      description = "AWS credentials file whose default key reads the lake's data files in S3.";
    };
    s3Region = mkOption {
      type = types.str;
      default = "us-east-1";
      description = "Region for the lake's S3 secret.";
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
      default = "${config.home.homeDirectory}/.config/lakes/dwp";
      description = "LAKE for maintenance: a directory whose quack-init.sql connects to this server.";
    };
    maintenance = mkOption {
      type = types.bool;
      default = true;
      description = "Run maintenance.sql nightly at 03:30.";
    };
    backup = {
      enable = mkEnableOption "the nightly per-table Parquet copy (03:00) to S3 and full .db.xz copy";
      dir = mkOption {
        type = types.str;
        default = "${config.home.homeDirectory}/lakes/dwp-bak";
        description = "Where lake/<table>.parquet and lake.db.xz are kept. Never inside DIR/lake.";
      };
      remote = mkOption {
        type = types.str;
        example = "s3:backup.west.spy.net/ducklake-dwp/";
        description = "rclone destination the Parquet files are synced to: this lake's alone, since sync deletes what isn't in BACKUP_DIR/lake.";
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
      systemd.user.services.dwp-lake = {
        Unit = {
          Description = "dwp lake Quack server";
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
      systemd.user.services.dwp-lake-backup = lib.mkIf cfg.backup.enable {
        Unit.Description = "dwp lake backup (export to S3, full copy)";
        Service = {
          Type = "oneshot";
          ExecStart = lib.getExe backup;
          Environment = lib.optional (cfg.backup.rcloneConfig != null)
            "RCLONE_CONFIG=${cfg.backup.rcloneConfig}";
        };
      };
      systemd.user.timers.dwp-lake-backup = lib.mkIf cfg.backup.enable {
        Unit.Description = "dwp lake backup, nightly";
        Timer = {
          OnCalendar = "*-*-* 03:00:00";
          Persistent = true;
        };
        Install.WantedBy = [ "timers.target" ];
      };
      systemd.user.services.dwp-lake-maintenance = lib.mkIf cfg.maintenance {
        Unit.Description = "dwp lake maintenance";
        Service = {
          Type = "oneshot";
          ExecStart = lib.getExe maintenance;
        };
      };
      systemd.user.timers.dwp-lake-maintenance = lib.mkIf cfg.maintenance {
        Unit.Description = "dwp lake maintenance, nightly";
        Timer = {
          OnCalendar = "*-*-* 03:30:00";
          Persistent = true;
        };
        Install.WantedBy = [ "timers.target" ];
      };
    })

    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents.dwp-lake = {
        enable = true;
        config = {
          Label = "pro.downwind.lake";
          ProgramArguments = [ (lib.getExe server) ];
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 30;
          SoftResourceLimits.NumberOfFiles = 65536;
          HardResourceLimits.NumberOfFiles = 65536;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-lake.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-lake.log";
        };
      };
      launchd.agents.dwp-lake-backup = lib.mkIf cfg.backup.enable {
        enable = true;
        config = {
          Label = "pro.downwind.lake-backup";
          ProgramArguments = [ (lib.getExe backup) ];
          StartCalendarInterval = [ { Hour = 3; Minute = 0; } ];
          EnvironmentVariables = lib.optionalAttrs (cfg.backup.rcloneConfig != null)
            { RCLONE_CONFIG = cfg.backup.rcloneConfig; };
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-lake-backup.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-lake-backup.log";
        };
      };
      launchd.agents.dwp-lake-maintenance = lib.mkIf cfg.maintenance {
        enable = true;
        config = {
          Label = "pro.downwind.lake-maintenance";
          ProgramArguments = [ (lib.getExe maintenance) ];
          StartCalendarInterval = [ { Hour = 3; Minute = 30; } ];
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-lake-maintenance.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-lake-maintenance.log";
        };
      };
    })
  ]);
}
