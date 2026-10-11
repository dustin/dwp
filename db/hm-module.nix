# Home-manager module for matrix-bot: a launchd agent on macOS, a systemd
# user service on Linux. It needs nothing from this flake, so a
# home-manager flake can take dwp as a plain source:
#
#   inputs.dwp = { url = "github:dustin/dwp"; flake = false; };
#   ...
#   imports = [ "${inputs.dwp}/db/hm-module.nix" ];
#   services.dwp-matrix-bot = {
#     enable = true;
#     dbDir = "/Users/dustin/prog/dwp/db";
#     homeserver = "sallings.org";
#     room = "!abc:sallings.org";
#     owner = "@dustin:sallings.org";
#     tokenFile = config.sops.secrets.dwp-matrix-token.path;
#   };
#
# matrix-bot, add-run and strava/sync run from dbDir (a checkout), so
# edits there take effect on the bot's next restart; only their tools come
# from the package.
{ config, lib, pkgs, ... }:
let
  cfg = config.services.dwp-matrix-bot;
  command = [
    "${cfg.package}/bin/dwp-db-env"
    "${cfg.dbDir}/matrix-bot"
    "--homeserver" cfg.homeserver
    "--room" cfg.room
    "--owner" cfg.owner
    "--rider" cfg.rider
    "--token-file" cfg.tokenFile
  ];
in
{
  options.services.dwp-matrix-bot = with lib; {
    enable = mkEnableOption "the downwind.pro Matrix import bot";
    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./db-env.nix { };
      description = "dwp-db-env: runs a command with db's tools on PATH.";
    };
    dbDir = mkOption {
      type = types.str;
      example = "/Users/dustin/prog/dwp/db";
      description = "The db directory of a dwp checkout.";
    };
    homeserver = mkOption { type = types.str; example = "sallings.org"; };
    room = mkOption { type = types.str; example = "!abc:sallings.org"; };
    owner = mkOption {
      type = types.str;
      example = "@dustin:sallings.org";
      description = "The only Matrix user the bot takes orders from.";
    };
    rider = mkOption {
      type = types.str;
      default = "dustin";
      description = "Whose runs the GPX files it's sent are.";
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
