# Home-manager module for the half-hourly buoy job (./update-buoys): every
# Hawaiʻi buoy's readings and spectra into the lake, the latest Pauwela
# report to MQTT (ocean/buoy-update), then forecast-ingest and a publish
# (through publishd). A systemd user timer at :10 and :40 (Linux; on
# pitrick, next to the lake).
#
#   services.dwp-buoys.enable = true;
#
# It needs the lake (lake holding quack-init.sql) like every lake tool, and
# the broker as "mqtt".
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-buoys;
  duckdb = if lib.versionAtLeast pkgs.duckdb.version "2" then pkgs.duckdb
    else pkgs.callPackage ../nix/duckdb.nix { inherit (pkgs) duckdb; };
in
{
  options.services.dwp-buoys = with lib; {
    enable = mkEnableOption "the half-hourly buoy job (update-buoys)";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./tools.nix { inherit duckdb; };
    };
    lake = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/.config/lakes/dwp";
      description = "LAKE: a directory whose quack-init.sql connects to the lake.";
    };
    onCalendar = mkOption {
      type = types.str;
      default = "*-*-* *:10,40:00";
      description = "When to run (systemd OnCalendar).";
    };
  };

  config = lib.mkIf (cfg.enable && pkgs.stdenv.hostPlatform.isLinux) {
    systemd.user.services.dwp-buoys = {
      Unit.Description = "dwp buoys, forecasts and publish";
      Service = {
        Type = "oneshot";
        ExecStart = lib.getExe' cfg.package "dwp-update-buoys";
        Environment = [ "LAKE=${cfg.lake}" ];
        TimeoutStartSec = "25min";
      };
    };
    systemd.user.timers.dwp-buoys = {
      Unit.Description = "dwp buoys, half-hourly";
      Timer = {
        OnCalendar = cfg.onCalendar;
        Persistent = true;
      };
      Install.WantedBy = [ "timers.target" ];
    };
  };
}
