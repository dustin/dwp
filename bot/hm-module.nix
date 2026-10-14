# Home-manager module for matrix-bot: a launchd agent on macOS, a systemd
# user service on Linux. It needs nothing from this flake, so a
# home-manager flake can take dwp as a plain source:
#
#   inputs.dwp = { url = "github:dustin/dwp"; flake = false; };
#   ...
#   imports = [ "${inputs.dwp}/bot/hm-module.nix" ];
#   services.dwp-matrix-bot = {
#     enable = true;
#     checkout = "/Users/dustin/prog/dwp";
#     homeserver = "sallings.org";
#     rooms = [ "!abc:sallings.org" ];
#     users."@dustin:sallings.org" = "dustin";
#     users."@walter:matrix.org" = "walter";
#     tokenFile = config.sops.secrets.dwp-matrix-token.path;
#   };
#
# bot/matrix-bot, and the db/ commands it runs (add-run, publish,
# strava/sync), run from the checkout, so edits there take effect on the
# bot's next restart; only their tools come from the package.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-matrix-bot;
  command = [
    "${cfg.package}/bin/dwp-bot-env"
    "${cfg.checkout}/bot/matrix-bot"
    "--homeserver" cfg.homeserver
    "--token-file" cfg.tokenFile
    "--mqtt" cfg.mqtt
  ]
  ++ lib.concatMap (room: [ "--room" room ]) (lib.optional (cfg.room != null) cfg.room ++ cfg.rooms)
  ++ lib.concatLists (lib.mapAttrsToList (mxid: rider: [ "--user" "${mxid}=${rider}" ]) cfg.users);
in
{
  options.services.dwp-matrix-bot = with lib; {
    enable = mkEnableOption "the downwind.pro Matrix import bot";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./bot-env.nix { };
      description = "dwp-bot-env: runs a command with the bot's tools on PATH.";
    };
    checkout = mkOption {
      type = types.str;
      example = "/Users/dustin/prog/dwp";
      description = "A dwp checkout; the bot runs its bot/matrix-bot.";
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
          };
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
          Restart = "always";
          RestartSec = 30;
        };
        Install.WantedBy = [ "default.target" ];
      };
    })
  ]);
}
