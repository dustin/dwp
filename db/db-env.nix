# `dwp-db-env CMD...`: run CMD with the dev shell's tools, for things run
# outside it (strava/hm-module.nix runs sync this way).
{ writeShellApplication, duckdb, rclone, python3, tzdata, cacert }:
writeShellApplication {
  name = "dwp-db-env";
  runtimeInputs = [ duckdb rclone python3 ];
  text = ''
    export TZDIR="${tzdata}/share/zoneinfo"
    export SSL_CERT_FILE="''${SSL_CERT_FILE:-${cacert}/etc/ssl/certs/ca-bundle.crt}"
    exec "$@"
  '';
}
