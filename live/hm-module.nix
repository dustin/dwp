# Home-manager modules for dwp's always-on publishers on aws1, next to the
# broker: live-wind (live/wind.json), surf-alerts (live/alerts.json) and
# the run rating (weather/conditions/rating). Each runs its script from
# this source, so a dwp bump updates it. bot/hm-module.nix imports this
# too, so importing either brings them in.
{
  imports = [ ./live-wind.nix ./surf-alerts.nix ./rating.nix ];
}
