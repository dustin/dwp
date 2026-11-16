# Home-manager module for the run rating (live/rating): rates Kīhei and the
# north shore every few minutes from the weather/+ feed and publishes
# weather/conditions/rating, as a systemd user service (Linux; it runs on
# aws1, next to the broker). Imported by live/hm-module.nix. The script comes
# from this source, so a dwp bump updates it.
#
#   services.dwp-rating = {
#     enable = true;
#     jev = "http://100.123.110.66:11434";   # dsstudio on the tailnet
#   };
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-rating;
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [ ./rating ./mqtt_weather.py ../web/lib/data/wind-quality.json ];
  };
  env = pkgs.writeShellApplication {
    name = "dwp-rating";
    runtimeInputs = [ pkgs.python3 ];
    text = ''
      export TZDIR="${pkgs.tzdata}/share/zoneinfo"
      export SSL_CERT_FILE="''${SSL_CERT_FILE:-${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt}"
      exec python3 ${src}/live/rating "$@"
    '';
  };
  command = [ (lib.getExe env) "--mqtt" cfg.mqtt "--topic" cfg.topic
              "--window" cfg.window "--every" (toString cfg.every) "--model" cfg.model ]
    ++ lib.optionals (cfg.jev != null) [ "--jev" cfg.jev ];
in
{
  options.services.dwp-rating = with lib; {
    enable = mkEnableOption "the downwind run rating from the weather/+ feed";
    mqtt = mkOption {
      type = types.str;
      default = "localhost";
      description = "HOST[:PORT] of the broker with the weather/+ feed; the rating goes there too.";
    };
    topic = mkOption {
      type = types.str;
      default = "weather/conditions/rating";
      description = "Where the rating is published (retained).";
    };
    jev = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = ''
        jev's base URL for the model's scores. Null, or unreachable, rates
        without a model: the middle of what the features allow.
      '';
    };
    model = mkOption {
      type = types.str;
      default = "clef-flash";
      description = "The jev model to ask.";
    };
    window = mkOption {
      type = types.str;
      default = "07:00-17:00";
      description = "Hawaii hours (HH:MM-HH:MM) to rate in.";
    };
    every = mkOption {
      type = types.int;
      default = 300;
      description = "Seconds between ratings.";
    };
  };

  config = lib.mkIf (cfg.enable && pkgs.stdenv.hostPlatform.isLinux) {
    systemd.user.services.dwp-rating = {
      Unit = {
        Description = "downwind.pro run rating to ${cfg.topic}";
        After = [ "network-online.target" ];
      };
      Service = {
        ExecStart = lib.escapeShellArgs command;
        Restart = "always";
        RestartSec = 30;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
