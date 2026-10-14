# `dwp-bot-env CMD...`: run CMD with the bot's tools on PATH, for things
# run outside the dev shell (hm-module.nix runs matrix-bot this way). The
# bot runs db's add-run, publish and strava/sync, so this is db's tools
# plus rsvg-convert for the spectrum images (spectrum_svg.py), with DejaVu
# Sans so they render the same everywhere.
{ writeShellApplication, duckdb, rclone, python3, tzdata, cacert
, librsvg, makeFontsConf, dejavu_fonts }:
writeShellApplication {
  name = "dwp-bot-env";
  runtimeInputs = [ duckdb rclone python3 librsvg ];
  text = ''
    export TZDIR="${tzdata}/share/zoneinfo"
    export SSL_CERT_FILE="''${SSL_CERT_FILE:-${cacert}/etc/ssl/certs/ca-bundle.crt}"
    export FONTCONFIG_FILE="${makeFontsConf { fontDirectories = [ dejavu_fonts ]; }}"
    exec "$@"
  '';
}
