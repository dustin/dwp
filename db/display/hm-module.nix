# Home-manager modules for the e-paper displays (Linux only).
#
# services.dwp-display, where there's a browser (pitrick): renders pages
# with dwp-display-render (./default.nix) and PUTs the images.
#   api: the display server (./server.py) to render for. Every minute it
#     asks the server what its devices want and renders what's due.
#   pages + server: the old fixed list, PUT to Node-RED's /magtrmnl.
#
#   services.dwp-display = {
#     enable = true;
#     api = "http://aws1:8893";
#     pages = [ ];
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
  run = pkgs.writeShellScript "dwp-display-round" (''
    status=0
  '' + lib.concatMapStrings (p: ''
    ${render} ${lib.escapeShellArgs [ p.size p.url "${cfg.server}/${p.name}" ]} || status=$?
  '') cfg.pages + ''
    exit $status
  '');
  page = lib.types.submodule {
    options = with lib; {
      name = mkOption { type = types.str; description = "Image name on the server, with .bmp or .png."; };
      url = mkOption { type = types.str; };
      size = mkOption { type = types.str; default = "296x128"; description = "WxH."; };
    };
  };
in
{
  options.services.dwp-display = with lib; {
    enable = mkEnableOption "the e-paper display renders";
    api = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "http://aws1:8893";
      description = "The display server (server.py) whose wanted list to render, reached privately.";
    };
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./default.nix { };
    };
    server = mkOption {
      type = types.str;
      default = "http://bee1.lan:1880/magtrmnl";
      description = "Where the images are PUT, as <server>/<name>.";
    };
    onCalendar = mkOption {
      type = types.str;
      # Just after update-buoys' publish at :10 and :40, in the hours the
      # displays are awake (the server sleeps them 21:00–05:45 HST).
      default = "*-*-* 05..20:13,43:00 Pacific/Honolulu";
    };
    pages = mkOption {
      type = types.listOf page;
      default = [
        { name = "buoy.bmp"; url = "https://downwind.pro/magtag.html"; }
        { name = "kaipukaihina.bmp"; url = "https://downwind.pro/magtag.html?card=tide&spot=kaipukaihina"; }
        { name = "ukumehame.bmp"; url = "https://downwind.pro/magtag.html?card=tide&spot=ukumehame"; }
        { name = "guardrails.bmp"; url = "https://downwind.pro/magtag.html?card=tide&spot=guardrails"; }
        { name = "kihei.png"; url = "https://downwind.pro/reterminal.html"; size = "800x480"; }
      ];
      description = "Pages to render, in the server's names (its playlists list them).";
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
    devices = mkOption {
      type = types.attrsOf (types.submodule {
        options = {
          name = mkOption { type = types.str; default = ""; };
          page = mkOption { type = types.str; description = "Page name, as in server.py (kihei, maliko, buoy-pauwela, ...)."; };
        };
      });
      default = { };
      example = { "C4:9E:7E:18:EF:A4" = { name = "sticky"; page = "kihei"; }; };
      description = "Devices by their ID header (MAC); each shows its page whatever its URL says.";
    };
  };

  config = lib.mkMerge [
  (lib.mkIf (cfg.enable && cfg.api != null && pkgs.stdenv.hostPlatform.isLinux) {
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
        ExecStart = lib.escapeShellArgs [
          (lib.getExe pkgs.python3) "${./server.py}" "%S/dwp-display"
          "--port" (toString scfg.port) "--public" scfg.public
          "--devices" (pkgs.writeText "dwp-display-devices.json" (builtins.toJSON scfg.devices))
        ];
        Restart = "always";
        RestartSec = 10;
      };
      Install.WantedBy = [ "default.target" ];
    };
  })

  (lib.mkIf (cfg.enable && cfg.pages != [ ] && pkgs.stdenv.hostPlatform.isLinux) {
    systemd.user.services.dwp-display = {
      Unit.Description = "Render downwind.pro's e-paper display pages";
      Service = {
        Type = "oneshot";
        ExecStart = "${run}";
        # The pages draw times in the browser's zone.
        Environment = [ "TZ=Pacific/Honolulu" ];
      };
    };
    systemd.user.timers.dwp-display = {
      Unit.Description = "Render downwind.pro's e-paper display pages";
      Timer = {
        OnCalendar = cfg.onCalendar;
        Persistent = false;
      };
      Install.WantedBy = [ "timers.target" ];
    };
  })
  ];
}
