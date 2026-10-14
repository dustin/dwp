# Home-manager modules for db's services. It needs nothing from this flake,
# so a home-manager flake can take dwp as a plain source:
#
#   inputs.dwp = { url = "github:dustin/dwp"; flake = false; };
#   ...
#   imports = [ "${inputs.dwp}/db/hm-module.nix" ];
{
  # services.dwp-wailea-motion: the Wailea cam's water motion, see cams/hm-module.nix.
  # services.dwp-strava-sync: scheduled Strava imports, see strava/hm-module.nix.
  imports = [ ./cams/hm-module.nix ./strava/hm-module.nix ];
}
