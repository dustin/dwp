# Home-manager module for surf-alerts: keeps live/alerts.json in the
# bucket from the NWS's active Hawaiʻi alerts (Maui High Surf Advisories
# and Warnings), as a systemd user service (Linux; it runs on aws1).
# Imported by hm-module.nix.
#
#   services.dwp-surf-alerts = {
#     enable = true;
#     rcloneConfig = config.my.secrets.rclone-config.extra.dwp-live.path;
#   };
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-surf-alerts;
  src = lib.fileset.toSource {
    root = ./.;
    fileset = ./surf-alerts;
  };
  env = pkgs.writeShellApplication {
    name = "dwp-surf-alerts";
    runtimeInputs = [ pkgs.python3 pkgs.rclone ];
    text = ''
      export SSL_CERT_FILE="''${SSL_CERT_FILE:-${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt}"
      exec python3 ${src}/surf-alerts "$@"
    '';
  };
in
{
  options.services.dwp-surf-alerts = with lib; {
    enable = mkEnableOption "live/alerts.json from the NWS's Hawaiʻi alerts";
    every = mkOption {
      type = types.int;
      default = 600;
      description = "Seconds between polls of api.weather.gov.";
    };
    rcloneConfig = mkOption {
      type = types.str;
      description = "An rclone config with the s3 remote (RCLONE_CONFIG).";
    };
  };

  config = lib.mkIf (cfg.enable && pkgs.stdenv.hostPlatform.isLinux) {
    systemd.user.services.dwp-surf-alerts = {
      Unit = {
        Description = "downwind.pro surf alerts to live/alerts.json";
        After = [ "network-online.target" ];
      };
      Service = {
        ExecStart = lib.escapeShellArgs [ (lib.getExe env) "--every" (toString cfg.every) ];
        Environment = [ "RCLONE_CONFIG=${cfg.rcloneConfig}" ];
        Restart = "always";
        RestartSec = 60;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
