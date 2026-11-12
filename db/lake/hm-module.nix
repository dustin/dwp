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

  server = pkgs.writeShellApplication {
    name = "dwp-lake-server";
    runtimeInputs = [ duckdb pkgs.coreutils ];
    text = ''
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
        printf '.read %s\n.bail on\nINSTALL quack; LOAD quack;\n' ${sessionSql}
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
    runtimeInputs = [ duckdb ];
    text = ''
      cd ${lib.escapeShellArg cfg.dir}
      exec duckdb -init ${sessionSql} "$@"
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
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    { home.packages = [ maintenance local ]; }

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
