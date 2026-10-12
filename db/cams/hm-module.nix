# Home-manager module for wailea-motion: every `interval` seconds, measure the
# Wailea cam's water motion and publish it (retained) to
# weather/conditions/wailea_motion. The script skips itself outside
# 05:30-19:00 HST. Imported by ../hm-module.nix, so enabling it is just:
#
#   services.dwp-wailea-motion = { enable = true; mqtt = "bee1"; };
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-wailea-motion;
  command = [ (lib.getExe cfg.package) "--mqtt" cfg.mqtt ]
    ++ lib.optionals (cfg.logDir != null) [ "--log" cfg.logDir ];
in
{
  options.services.dwp-wailea-motion = with lib; {
    enable = mkEnableOption "Wailea cam water-motion readings over MQTT";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./default.nix { };
    };
    mqtt = mkOption {
      type = types.str;
      example = "bee1";
      description = "Broker host to publish weather/conditions/wailea_motion to.";
    };
    interval = mkOption {
      type = types.int;
      default = 600;
      description = "Seconds between readings.";
    };
    logDir = mkOption {
      type = types.nullOr types.str;
      default = "${config.xdg.cacheHome}/wailea-motion";
      description = "Where to keep motion.jsonl and an arrow overlay per reading (null for none).";
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents.dwp-wailea-motion = {
        enable = true;
        config = {
          Label = "pro.downwind.wailea-motion";
          ProgramArguments = command;
          StartInterval = cfg.interval;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-wailea-motion.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-wailea-motion.log";
        };
      };
    })
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      systemd.user.services.dwp-wailea-motion = {
        Unit.Description = "Wailea cam water motion";
        Service = { Type = "oneshot"; ExecStart = lib.escapeShellArgs command; };
      };
      systemd.user.timers.dwp-wailea-motion = {
        Unit.Description = "Wailea cam water motion";
        Timer = { OnUnitActiveSec = cfg.interval; OnActiveSec = 60; };
        Install.WantedBy = [ "timers.target" ];
      };
    })
  ]);
}
