# Home-manager modules for the e-paper displays (Linux only).
#
# services.dwp-display, where there's a browser (pitrick): renders pages
# with dwp-display-render (./default.nix) and PUTs the images.
# Every minute it asks the display server (./server.py, at `api`) what
# its devices want and renders what's due.
#
#   services.dwp-display = {
#     enable = true;
#     api = "http://aws1:8893";
#   };
#
# services.dwp-display-server, where the devices are served from (aws1):
# ./server.py, TRMNL's API with the page in the URL, behind nginx.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-display;
  scfg = config.services.dwp-display-server;
  render = lib.getExe cfg.package;
  sync = pkgs.writeShellScript "dwp-display-sync" ''
    exec ${lib.getExe pkgs.python3} ${./sync.py} ${lib.escapeShellArgs [ cfg.api render ]}
  '';
in
{
  options.services.dwp-display = with lib; {
    enable = mkEnableOption "the e-paper display renders";
    api = mkOption {
      type = types.str;
      example = "http://aws1:8893";
      description = "The display server (server.py) whose wanted list to render, reached privately.";
    };
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./default.nix { };
    };
  };

  options.services.dwp-display-server = with lib; {
    enable = mkEnableOption "the e-paper display server";
    port = mkOption { type = types.port; default = 8893; };
    public = mkOption {
      type = types.str;
      default = "https://api.downwind.pro";
      description = "Where devices reach it; image URLs start with this.";
    };
    mqtt = mkOption {
      type = types.nullOr types.str;
      default = "localhost";
      description = "Broker for the devices' battery voltage and RSSI (display/<sensor>/voltage, .../rssi); null for none.";
    };
    devices = mkOption {
      type = types.attrsOf (types.submodule {
        options = {
          name = mkOption { type = types.str; default = ""; };
          sensor = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "Its sensor tag for the battery readings (display/<sensor>/voltage); default the MAC's last 6.";
          };
          page = mkOption { type = types.str; description = "Page name, as in server.py (kihei, maliko, buoy-pauwela, ...)."; };
        };
      });
      default = { };
      example = { "C4:9E:7E:18:EF:A4" = { name = "sticky"; page = "kihei"; }; };
      description = "Devices by their ID header (MAC); each shows its page whatever its URL says.";
    };
  };

  config = lib.mkMerge [
  (lib.mkIf (cfg.enable && pkgs.stdenv.hostPlatform.isLinux) {
    systemd.user.services.dwp-display-sync = {
      Unit.Description = "Render what the e-paper display server's devices want";
      Service = {
        Type = "oneshot";
        ExecStart = "${sync}";
        # The pages draw times in the browser's zone.
        Environment = [ "TZ=Pacific/Honolulu" ];
      };
    };
    systemd.user.timers.dwp-display-sync = {
      Unit.Description = "Render what the e-paper display server's devices want";
      Timer = {
        OnCalendar = "minutely";
        Persistent = false;
      };
      Install.WantedBy = [ "timers.target" ];
    };
  })

  (lib.mkIf (scfg.enable && pkgs.stdenv.hostPlatform.isLinux) {
    systemd.user.services.dwp-display-server = {
      Unit = {
        Description = "downwind.pro e-paper display server";
        After = [ "network-online.target" ];
      };
      Service = {
        ExecStart = lib.escapeShellArgs ([
          (lib.getExe pkgs.python3) "${./server.py}" "%S/dwp-display"
          "--port" (toString scfg.port) "--public" scfg.public
          "--devices" (pkgs.writeText "dwp-display-devices.json" (builtins.toJSON scfg.devices))
        ] ++ lib.optionals (scfg.mqtt != null) [
          "--mqtt" scfg.mqtt "--mosquitto-pub" "${pkgs.mosquitto}/bin/mosquitto_pub"
        ]);
        Restart = "always";
        RestartSec = 10;
      };
      Install.WantedBy = [ "default.target" ];
    };
  })

  ];
}
