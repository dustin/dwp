# Home-manager module for the dwp lake's server: a DuckDB session with the
# dwp lake (one plain DuckDB file, DIR/lake.duckdb) attached as `lake`,
# served over Quack, DuckDB 2.0's remote protocol, so every dwp
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
# DIR holds lake.duckdb and a .lake-name file reading `dwp`: the server
# won't start without it, so it can't serve some other lake's directory by
# mistake. The server is the file's only writer: DuckDB locks it, so
# everything else goes through quack (or dwp-lake-local with the server
# stopped).
#
# Until 2026-11 the lake was a DuckLake (DIR/lake.sqlite3 catalog + DIR/lake/
# Parquet). dwp-lake-migrate copies that into DIR/lake.duckdb once, with the
# server stopped, and leaves the DuckLake files alone; delete them once the
# new lake has been fine for a while.
#
# Also a nightly dwp-lake-maintenance (maintenance.sql) through the server,
# optionally a nightly dwp-lake-backup (backup.*),
# and dwp-lake-local, a DuckDB CLI with the lake attached directly.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-lake;
  # The lake file is DuckDB 2.0's format; use ../../nix/duckdb.nix's until pkgs has it.
  duckdb = if lib.versionAtLeast pkgs.duckdb.version "2" then pkgs.duckdb
    else pkgs.callPackage ../../nix/duckdb.nix { inherit (pkgs) duckdb; };

  sessionSql = pkgs.writeText "dwp-lake-session.sql" ''
    .output /dev/null
    ${builtins.readFile ./init.sql}
    SET memory_limit = '${cfg.memoryLimit}';
    SET threads = ${toString cfg.threads};
    SET temp_directory = '${cfg.dir}/.tmp';
    ATTACH '${cfg.dir}/lake.duckdb' AS lake;
    USE lake;
    .output
  '';

  # Prints a CREATE SECRET for S3 (the old DuckLake's data files in
  # s3://lake.west.spy.net/files/..., and anything views read there), with the default profile's key from
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
      if [ ! -f "$dir/lake.duckdb" ]; then
        if [ -f "$dir/lake.sqlite3" ]; then
          echo "dwp-lake: $dir has the old DuckLake but no lake.duckdb; run dwp-lake-migrate" >&2
        else
          echo "dwp-lake: no $dir/lake.duckdb" >&2
        fi
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

  # One-off: the old DuckLake (lake.sqlite3 + lake/) copied into
  # lake.duckdb, every schema, table, view and macro (COPY FROM DATABASE,
  # as the backup's full copy does), with each table's row count checked
  # before the new file takes the name. Run it with dwp-lake stopped;
  # it does nothing once lake.duckdb exists.
  migrate = pkgs.writeShellApplication {
    name = "dwp-lake-migrate";
    runtimeInputs = [ duckdb pkgs.coreutils pkgs.gnused pkgs.gnugrep ];
    text = s3Secret + ''
      dir=${lib.escapeShellArg cfg.dir}
      cd "$dir"
      if [ -e lake.duckdb ]; then
        echo "dwp-lake-migrate: $dir/lake.duckdb already exists; nothing to do"
        exit 0
      fi
      if [ ! -f lake.sqlite3 ] || [ ! -d lake ]; then
        echo "dwp-lake-migrate: no DuckLake (lake.sqlite3 and lake/) in $dir" >&2
        exit 1
      fi
      rm -f lake.duckdb.tmp lake.duckdb.tmp.wal tables.tmp
      init=$(umask 077; mktemp)
      trap 'rm -f "$init" tables.tmp' EXIT
      {
        printf '.output /dev/null\n'
        cat ${./init.sql}
        printf 'INSTALL ducklake; LOAD ducklake; INSTALL sqlite; LOAD sqlite;\n'
        printf 'SET memory_limit = %s; SET threads = %s;\n' \
          ${lib.escapeShellArg "'${cfg.memoryLimit}'"} ${toString cfg.threads}
        printf "SET temp_directory = '%s/.tmp';\n" "$dir"
        s3_secret
        printf "ATTACH 'ducklake:sqlite:%s/lake.sqlite3' AS old (DATA_PATH '%s/lake/', OVERRIDE_DATA_PATH true);\n" "$dir" "$dir"
        printf "ATTACH '%s/lake.duckdb.tmp' AS new;\n" "$dir"
        printf '.output\n'
      } > "$init"
      mkdir -p .tmp

      echo "copying the DuckLake into lake.duckdb.tmp"
      duckdb -bail -init "$init" -c 'COPY FROM DATABASE old TO new; CHECKPOINT new;'

      # Every table's rows, old against new; error() stops at the first
      # that differs.
      duckdb -bail -init "$init" -list -noheader -c "
        select schema_name || '.' || table_name from duckdb_tables()
         where database_name = 'old' order by 1" > tables.tmp
      sql=""
      while IFS=. read -r s t; do
        sql+="select t, if(n = m, 'ok', error(t || ': ' || n || ' rows in the DuckLake, ' || m || ' copied')) from (select '$s.$t' as t, (select count(*) from old.\"$s\".\"$t\") as n, (select count(*) from new.\"$s\".\"$t\") as m);"$'\n'
      done < <(grep -E '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' tables.tmp)
      if [ -z "$sql" ]; then
        echo "dwp-lake-migrate: no tables found in the DuckLake" >&2
        exit 1
      fi
      echo "checking $(grep -c . <<< "$sql") tables"
      duckdb -bail -init "$init" -list -noheader <<< "$sql"
      duckdb -bail -init "$init" -list -noheader -c "
        select 'views: ' || (select count(*) from duckdb_views() where database_name = 'old' and not internal)
          || ' old, ' || (select count(*) from duckdb_views() where database_name = 'new' and not internal) || ' new'"

      if [ -e lake.duckdb.tmp.wal ]; then
        echo "dwp-lake-migrate: lake.duckdb.tmp.wal left over; not using the copy" >&2
        exit 1
      fi
      mv lake.duckdb.tmp lake.duckdb
      echo "dwp-lake-migrate: $dir/lake.duckdb is the lake now; lake.sqlite3 and lake/ are untouched (delete them later)"
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

      # Right after a (re)start the server isn't listening yet; give it
      # two minutes before failing.
      for i in $(seq 24); do
        duckdb -bail --init quack-init.sql -c 'select 1' >/dev/null 2>&1 && break
        if [ "$i" = 24 ]; then
          echo "dwp-lake-backup: lake server not answering" >&2
          exit 1
        fi
        sleep 5
      done

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
      description = "The lake: lake.duckdb and .lake-name.";
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
        description = "Where lake/<table>.parquet and lake.db.xz are kept.";
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
    { home.packages = [ maintenance local migrate ] ++ lib.optional cfg.backup.enable backup; }

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
