# `dwp-db-env CMD...`: run CMD with the dev shell's tools, for things run
# outside it (hm-module.nix runs matrix-bot this way).
{ writeShellApplication, duckdb, rclone, python3, tzdata, cacert
, librsvg, makeFontsConf, dejavu_fonts }:
writeShellApplication {
  name = "dwp-db-env";
  # librsvg: rsvg-convert, for matrix-bot's spectrum images (bot/spectrum_svg.py in the repo root),
  # with DejaVu Sans so they render the same everywhere.
  runtimeInputs = [ duckdb rclone python3 librsvg ];
  text = ''
    export TZDIR="${tzdata}/share/zoneinfo"
    export SSL_CERT_FILE="''${SSL_CERT_FILE:-${cacert}/etc/ssl/certs/ca-bundle.crt}"
    export FONTCONFIG_FILE="${makeFontsConf { fontDirectories = [ dejavu_fonts ]; }}"
    exec "$@"
  '';
}
