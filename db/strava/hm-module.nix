# Home-manager module for strava/sync: every `interval` seconds, import
# every set-up rider's new downwinders from Strava (see strava/sync for
# the one-time per-rider setup). Imported by ../hm-module.nix, so
# enabling it is just:
#
#   services.dwp-strava-sync = { enable = true; dbDir = "/Users/dustin/prog/dwp/db"; };
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-strava-sync;
  command = [ "${cfg.package}/bin/dwp-db-env" "${cfg.dbDir}/strava/sync" "run" ];
in
{
  options.services.dwp-strava-sync = with lib; {
    enable = mkEnableOption "scheduled Strava imports for downwind.pro riders";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ../db-env.nix { };
      description = "dwp-db-env: runs a command with db's tools on PATH.";
    };
    dbDir = mkOption {
      type = types.str;
      example = "/Users/dustin/prog/dwp/db";
      description = "The db directory of a dwp checkout.";
    };
    interval = mkOption {
      type = types.int;
      default = 3600;
      description = "Seconds between syncs.";
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents.dwp-strava-sync = {
        enable = true;
        config = {
          Label = "pro.downwind.strava-sync";
          ProgramArguments = command;
          StartInterval = cfg.interval;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-strava-sync.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-strava-sync.log";
          EnvironmentVariables = {
            HOME = config.home.homeDirectory;
            LANG = "en_US.UTF-8";
          };
        };
      };
    })
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      systemd.user.services.dwp-strava-sync = {
        Unit.Description = "downwind.pro Strava sync";
        Service = { Type = "oneshot"; ExecStart = lib.escapeShellArgs command; };
      };
      systemd.user.timers.dwp-strava-sync = {
        Unit.Description = "downwind.pro Strava sync";
        Timer = { OnUnitActiveSec = cfg.interval; OnActiveSec = 300; };
        Install.WantedBy = [ "timers.target" ];
      };
    })
  ]);
}
