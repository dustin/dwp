# The lake tools that work from any host (cam-ingest, forecast-ingest,
# publish, publishd),
# with what they need on PATH (python3, DuckDB 2.0, rclone), so a service on
# any host can run them without a checkout. They still find the lake the
# usual way: LAKE (default ~/stuff/duck) holding quack-init.sql.
#
# duckdb must be 2.0 (the lake is on 2.0 / DuckLake 1.1); cams/hm-module.nix
# passes ../nix/duckdb.nix's when pkgs' is older.
{ lib, stdenvNoCC, python3, duckdb, rclone, tzdata, cacert, makeWrapper }:

stdenvNoCC.mkDerivation {
  pname = "dwp-db-tools";
  version = "0";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./cam-ingest ./forecast-ingest ./publish ./publishd ./dwp_publish.py ./dwp_mqtt.py
      ./export-lists.sql
      ./cams/cams.py
    ];
  };
  nativeBuildInputs = [ makeWrapper ];
  installPhase = ''
    share=$out/share/dwp-db
    mkdir -p $share $out/bin
    cp -r . $share/
    for t in cam-ingest forecast-ingest publish publishd; do
      makeWrapper ${python3}/bin/python3 $out/bin/dwp-$t \
        --add-flags $share/$t \
        --prefix PATH : ${lib.makeBinPath [ duckdb rclone ]} \
        --set-default TZDIR ${tzdata}/share/zoneinfo \
        --set-default SSL_CERT_FILE ${cacert}/etc/ssl/certs/ca-bundle.crt
    done
  '';
  meta.mainProgram = "dwp-cam-ingest";
}
