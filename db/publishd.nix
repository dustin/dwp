# Home-manager module for publishd (./publishd), the publish service: the
# one place ./publish runs. Callers set DWP_PUBLISHD to the broker and ask
# it instead (run() in dwp_publish.py, `./publish --request`).
#
#   services.dwp-publishd = {
#     enable = true;
#     mqtt = "mqtt";
#     rcloneConfig = ".../rclone/dwp-publish.conf";  # with the s3 remote
#   };
#
# A launchd agent on macOS, a systemd user service on Linux; it needs the
# lake (lake holding quack-init.sql) like every lake tool.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-publishd;
  # The lake is on DuckDB 2.0; use ../nix/duckdb.nix's until pkgs has it.
  duckdb = if lib.versionAtLeast pkgs.duckdb.version "2" then pkgs.duckdb
    else pkgs.callPackage ../nix/duckdb.nix { inherit (pkgs) duckdb; };
  command = [ (lib.getExe' cfg.package "dwp-publishd") "--mqtt" cfg.mqtt
              "--settle" (toString cfg.settle) "--every" (toString cfg.every) ];
  env = { LAKE = cfg.lake; DWP_PUBLISHD = ""; }
    // lib.optionalAttrs (cfg.rcloneConfig != null) { RCLONE_CONFIG = cfg.rcloneConfig; };
in
{
  options.services.dwp-publishd = with lib; {
    enable = mkEnableOption "the dwp publish service";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./tools.nix { inherit duckdb; };
    };
    mqtt = mkOption {
      type = types.str;
      default = "mqtt";
      description = "HOST[:PORT] of the broker it takes requests on (dwp/publish/req).";
    };
    settle = mkOption {
      type = types.int;
      default = 15;
      description = "Seconds to gather requests into one publish.";
    };
    every = mkOption {
      type = types.int;
      default = 0;
      description = "Also publish after this many seconds without a request (0: never).";
    };
    lake = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/stuff/duck";
      description = "LAKE: a directory whose quack-init.sql connects to the lake.";
    };
    rcloneConfig = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "RCLONE_CONFIG: a config with the s3 remote (null for rclone's default).";
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents.dwp-publishd = {
        enable = true;
        config = {
          Label = "pro.downwind.publishd";
          ProgramArguments = command;
          EnvironmentVariables = env;
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 30;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-publishd.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-publishd.log";
        };
      };
    })
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      systemd.user.services.dwp-publishd = {
        Unit.Description = "dwp publish service";
        Service = {
          ExecStart = lib.escapeShellArgs command;
          Environment = lib.mapAttrsToList (k: v: "${k}=${v}") env;
          Restart = "always";
          RestartSec = 30;
        };
        Install.WantedBy = [ "default.target" ];
      };
    })
  ]);
}
