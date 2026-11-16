# Home-manager module for matrix-bot: a launchd agent on macOS, a systemd
# user service on Linux. It needs nothing from this flake, so a
# home-manager flake can take dwp as a plain source:
#
#   inputs.dwp = { url = "github:dustin/dwp"; flake = false; };
#   ...
#   imports = [ "${inputs.dwp}/bot/hm-module.nix" ];
#   services.dwp-matrix-bot = {
#     enable = true;
#     homeserver = "sallings.org";
#     rooms = [ "!abc:sallings.org" ];
#     users."@dustin:sallings.org" = "dustin";
#     users."@walter:matrix.org" = "walter";
#     tokenFile = config.sops.secrets.dwp-matrix-token.path;
#   };
#
# bot/matrix-bot, and the db/ commands it runs (add-run, publish,
# drive-sync), come from this source (bot/, db/, live/mqtt_weather.py and web/lib/, which the
# import replies' achievements and !forecast read), so a dwp bump updates
# the bot. Set checkout to run a dwp checkout's instead, where edits take
# effect on the bot's next restart.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-matrix-bot;
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.difference
      (lib.fileset.unions [ ../bot ../live/mqtt_weather.py ../db ../web/lib ])
      (lib.fileset.fileFilter (f: f.hasExt "pyc") ../.);
  };
  root = if cfg.checkout == null then "${src}" else cfg.checkout;
  command = [
    "${cfg.package}/bin/dwp-bot-env"
    "${root}/bot/matrix-bot"
    "--homeserver" cfg.homeserver
    "--token-file" cfg.tokenFile
    "--mqtt" cfg.mqtt
  ]
  ++ lib.optional (!cfg.live) "--no-live"
  ++ lib.concatMap (room: [ "--room" room ]) (lib.optional (cfg.room != null) cfg.room ++ cfg.rooms)
  ++ lib.concatLists (lib.mapAttrsToList (mxid: rider: [ "--user" "${mxid}=${rider}" ]) cfg.users);
  # The bot's publishes ask publishd on the same broker it reads weather
  # from (on macOS a launchd agent may only reach it by a Tailscale name).
  publishEnv = lib.optionalAttrs (cfg.mqtt != "") { DWP_MQTT = cfg.mqtt; };
in
{
  # The aws1 publishers (live-wind, surf-alerts, rating) live in ../live;
  # importing them here means a home-manager config that imports this
  # module gets them too.
  imports = [ ../live/hm-module.nix ];

  options.services.dwp-matrix-bot = with lib; {
    enable = mkEnableOption "the downwind.pro Matrix import bot";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./bot-env.nix { };
      description = "dwp-bot-env: runs a command with the bot's tools on PATH.";
    };
    checkout = mkOption {
      type = types.nullOr types.str;
      default = null;
      example = "/Users/dustin/prog/dwp";
      description = "A dwp checkout to run bot/matrix-bot from, instead of this source.";
    };
    homeserver = mkOption { type = types.str; example = "sallings.org"; };
    rooms = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "!abc:sallings.org" ];
      description = "Rooms the bot listens in; run alerts and the pinned conditions go to all of them.";
    };
    room = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "One more room, before rooms (the bot's first room keeps its old state files).";
    };
    users = mkOption {
      type = types.attrsOf types.str;
      example = { "@dustin:sallings.org" = "dustin"; };
      description = "Matrix users the bot listens to, each mapped to the rider their GPX files import as.";
    };
    mqtt = mkOption {
      type = types.str;
      default = "mqtt";
      example = "bee1:1883";
      description = "HOST[:PORT] of the broker with the weather/+ station feed (\"\" for none).";
    };
    live = mkOption {
      type = types.bool;
      default = true;
      description = "Whether the bot writes live/wind.json (off where services.dwp-live-wind does it).";
    };
    tokenFile = mkOption {
      type = types.str;
      default = "${config.home.homeDirectory}/.config/dwp/matrix-token";
      description = "File holding the bot account's access token.";
    };
  };

  config = lib.mkIf cfg.enable (lib.mkMerge [
    (lib.mkIf pkgs.stdenv.hostPlatform.isDarwin {
      launchd.agents.dwp-matrix-bot = {
        enable = true;
        config = {
          Label = "pro.downwind.matrix-bot";
          ProgramArguments = command;
          RunAtLoad = true;
          KeepAlive = true;
          ThrottleInterval = 30;
          StandardOutPath = "${config.home.homeDirectory}/Library/Logs/dwp-matrix-bot.log";
          StandardErrorPath = "${config.home.homeDirectory}/Library/Logs/dwp-matrix-bot.log";
          EnvironmentVariables = {
            HOME = config.home.homeDirectory;
            LANG = "en_US.UTF-8";
          } // publishEnv;
        };
      };
    })
    (lib.mkIf pkgs.stdenv.hostPlatform.isLinux {
      systemd.user.services.dwp-matrix-bot = {
        Unit = {
          Description = "downwind.pro Matrix import bot";
          After = [ "network-online.target" ];
        };
        Service = {
          ExecStart = lib.escapeShellArgs command;
          Environment = lib.mapAttrsToList (k: v: "${k}=${v}") publishEnv;
          Restart = "always";
          RestartSec = 30;
        };
        Install.WantedBy = [ "default.target" ];
      };
    })
  ]);
}
