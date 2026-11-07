# Home-manager module for the e-paper displays' renders (Linux only): a
# systemd user timer that runs dwp-display-render (./default.nix) for each
# page and PUTs the images to the display server.
#
#   services.dwp-display = {
#     enable = true;
#     server = "http://bee1.lan:1880/magtrmnl";
#   };
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-display;
  render = lib.getExe cfg.package;
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

  config = lib.mkIf (cfg.enable && pkgs.stdenv.hostPlatform.isLinux) {
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
  };
}
