# Home-manager module for cam-motion: every `interval` seconds, measure each
# cam's water motion in turn and publish it (retained) to
# weather/conditions/<cam>_motion. The script skips itself outside
# 05:30-19:00 HST. Imported by ../hm-module.nix, so enabling it is just:
#
#   services.dwp-cam-motion = { enable = true; mqtt = "bee1"; };
#
# (services.dwp-wailea-motion was its name when it only watched Wailea.)
#
# With ingest.enable, each round then runs cam-ingest (../cam-ingest) on
# the same host: the round's readings go into the lake and its images to
# S3 from here, so any host can be the one watching the cams. It needs the
# lake (ingest.lake holding quack-init.sql) and an rclone config with the
# s3 remote (ingest.rcloneConfig).
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-cam-motion;
  motion = [ (lib.getExe cfg.package) "--mqtt" cfg.mqtt ]
    ++ lib.concatMap (c: [ "--cam" c ]) cfg.cams
    ++ lib.optionals (cfg.logDir != null) [ "--log" cfg.logDir ];
  # The lake is on DuckDB 2.0; use ../../nix/duckdb.nix's until pkgs has it.
  duckdb = if lib.versionAtLeast pkgs.duckdb.version "2" then pkgs.duckdb
    else pkgs.callPackage ../../nix/duckdb.nix { inherit (pkgs) duckdb; };
  round = pkgs.writeShellScript "dwp-cam-round" (''
    status=0
    ${lib.escapeShellArgs motion} || status=$?
  '' + lib.optionalString cfg.ingest.enable ''
    export LAKE=${lib.escapeShellArg cfg.ingest.lake}
    ${lib.optionalString (cfg.ingest.rcloneConfig != null)
      "export RCLONE_CONFIG=${lib.escapeShellArg cfg.ingest.rcloneConfig}"}
    ${lib.getExe' cfg.ingest.package "dwp-cam-ingest"} --log ${lib.escapeShellArg cfg.logDir} || status=$?
  '' + ''
    exit $status
  '');
  command = [ "${round}" ];
  old = [ "services" "dwp-wailea-motion" ];
  new = [ "services" "dwp-cam-motion" ];
in
{
  imports = map (o: lib.mkRenamedOptionModule (old ++ [ o ]) (new ++ [ o ]))
    [ "enable" "package" "mqtt" "interval" ];

  options.services.dwp-cam-motion = with lib; {
    enable = mkEnableOption "cam water-motion readings over MQTT";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./default.nix { };
    };
    mqtt = mkOption {
      type = types.str;
      example = "bee1";
      description = "Broker host to publish weather/conditions/<cam>_motion to.";
    };
    cams = mkOption {
      type = types.listOf types.str;
      default = [ "wailea" "ulua" "poolenalena" "kahului_harbor" "wailea_pano" ];
      description = "Cams (names in cams.py) to measure, one after another.";
    };
    interval = mkOption {
      type = types.int;
      default = 600;
      description = "Seconds between rounds of readings.";
    };
    logDir = mkOption {
      type = types.nullOr types.str;
      default = "${config.xdg.cacheHome}/{cam}-motion";
      description = "Where to keep motion.jsonl and an arrow overlay per reading, {cam} being the cam's name (null for none).";
    };
    ingest = {
      enable = mkEnableOption "cam-ingest after each round: readings to the lake, images to S3, from this host";
      package = mkOption {
        type = types.package;
        default = pkgs.callPackage ../tools.nix { inherit duckdb; };
      };
      lake = mkOption {
        type = types.str;
        default = "${config.home.homeDirectory}/stuff/duck";
        description = "LAKE for cam-ingest: a directory whose quack-init.sql connects to the lake.";
      };
      rcloneConfig = mkOption {
        type = types.nullOr types.str;
        default = null;
        description = "RCLONE_CONFIG for the upload: a config with the s3 remote (null for rclone's default).";
      };
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    {
      assertions = [{
        assertion = cfg.ingest.enable -> cfg.logDir != null;
        message = "services.dwp-cam-motion.ingest needs logDir: cam-ingest reads it.";
      }];
    }
    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents.dwp-cam-motion = {
        enable = true;
        config = {
          Label = "pro.downwind.cam-motion";
          ProgramArguments = command;
          StartInterval = cfg.interval;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-cam-motion.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-cam-motion.log";
        };
      };
    })
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      systemd.user.services.dwp-cam-motion = {
        Unit.Description = "Cam water motion";
        Service = { Type = "oneshot"; ExecStart = "${round}"; };
      };
      systemd.user.timers.dwp-cam-motion = {
        Unit.Description = "Cam water motion";
        Timer = { OnUnitActiveSec = cfg.interval; OnActiveSec = 60; };
        Install.WantedBy = [ "timers.target" ];
      };
    })
  ]);
}
