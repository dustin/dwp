# Home-manager module for live-wind: keeps live/wind.json in the bucket
# from the weather/+ feed, as a systemd user service (Linux; it runs on
# aws1, next to the broker). Imported by hm-module.nix. The script comes
# from this source, not a checkout, so a dwp bump updates it.
#
#   services.dwp-live-wind = {
#     enable = true;
#     rcloneConfig = config.my.secrets.rclone-config.extra.dwp-live.path;
#     seedCommand = "duckq -json -c '...'";
#   };
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-live-wind;
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./live-wind ./mqtt_weather.py ];
  };
  env = pkgs.writeShellApplication {
    name = "dwp-live-wind";
    runtimeInputs = [ pkgs.python3 pkgs.rclone ];
    text = ''
      export TZDIR="${pkgs.tzdata}/share/zoneinfo"
      export SSL_CERT_FILE="''${SSL_CERT_FILE:-${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt}"
      exec python3 ${src}/live-wind "$@"
    '';
  };
  command = [ (lib.getExe env) "--mqtt" cfg.mqtt ]
    ++ lib.optionals (cfg.seedCommand != null) [ "--seed-cmd" cfg.seedCommand ];
in
{
  options.services.dwp-live-wind = with lib; {
    enable = mkEnableOption "live/wind.json from the weather/+ feed";
    mqtt = mkOption {
      type = types.str;
      default = "localhost";
      description = "HOST[:PORT] of the broker with the weather/+ feed.";
    };
    rcloneConfig = mkOption {
      type = types.str;
      description = "An rclone config with the s3 remote (RCLONE_CONFIG).";
    };
    seedCommand = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = ''
        Shell command printing older wind rows as a JSON array of
        {site, t, wavg, wdir, wgust, wlull}, seeded under the last
        live/wind.json at start. Failing is fine.
      '';
    };
    extraPath = mkOption {
      type = types.listOf types.package;
      default = [ ];
      description = "Packages on PATH for seedCommand (duckq, say).";
    };
  };

  config = lib.mkIf (cfg.enable && pkgs.stdenv.hostPlatform.isLinux) {
    systemd.user.services.dwp-live-wind = {
      Unit = {
        Description = "downwind.pro live wind to live/wind.json";
        After = [ "network-online.target" ];
      };
      Service = {
        ExecStart = lib.escapeShellArgs command;
        Environment = [
          "RCLONE_CONFIG=${cfg.rcloneConfig}"
          "PATH=${lib.makeBinPath cfg.extraPath}"
        ];
        Restart = "always";
        RestartSec = 30;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
