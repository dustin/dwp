# Home-manager module for cam-motion: every `interval` seconds, measure each
# cam's water motion in turn and publish it (retained) to
# weather/conditions/<cam>_motion. The script skips itself outside
# 05:30-19:00 HST. Imported by ../hm-module.nix, so enabling it is just:
#
#   services.dwp-cam-motion = { enable = true; mqtt = "bee1"; };
#
# (services.dwp-wailea-motion was its name when it only watched Wailea.)
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-cam-motion;
  command = [ (lib.getExe cfg.package) "--mqtt" cfg.mqtt ]
    ++ lib.concatMap (c: [ "--cam" c ]) cfg.cams
    ++ lib.optionals (cfg.logDir != null) [ "--log" cfg.logDir ];
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
      default = [ "wailea" "ulua" "poolenalena" "kahului_harbor" ];
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
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
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
        Service = { Type = "oneshot"; ExecStart = lib.escapeShellArgs command; };
      };
      systemd.user.timers.dwp-cam-motion = {
        Unit.Description = "Cam water motion";
        Timer = { OnUnitActiveSec = cfg.interval; OnActiveSec = 60; };
        Install.WantedBy = [ "timers.target" ];
      };
    })
  ]);
}
