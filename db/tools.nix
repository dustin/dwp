# The database tools that work from any host (cam-ingest, forecast-ingest,
# wind-ingest, publish, publishd, update-buoys),
# with what they need on PATH (python3, DuckDB 2.0, rclone, curl, nc), so a service on
# any host can run them without a checkout. They still find the database the
# usual way: DWP_DB (default ~/.config/duckq/dwp, which nixos-configs' duckq
# renders) holding quack-init.sql.
#
# duckdb must be 2.0 (the database and quack are 2.0); cams/hm-module.nix
# passes ../nix/duckdb.nix's when pkgs' is older.
{ lib, stdenvNoCC, python3, duckdb, rclone, curl, netcat-openbsd, coreutils, gnused, gnugrep, tzdata, cacert, makeWrapper }:

stdenvNoCC.mkDerivation {
  pname = "dwp-db-tools";
  version = "0";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./cam-ingest ./forecast-ingest ./wind-ingest ./publish ./publishd ./dwp_publish.py ./dwp_mqtt.py
      ./export-lists.sql
      ./update-buoys ./swell/collect ./swell/update.sql ./swell/stdmet.sql ./swell/recent-export.sql
      ./cams/cams.py
    ];
  };
  nativeBuildInputs = [ makeWrapper ];
  installPhase = ''
    share=$out/share/dwp-db
    mkdir -p $share $out/bin
    cp -r . $share/
    for t in cam-ingest forecast-ingest wind-ingest publish publishd; do
      makeWrapper ${python3}/bin/python3 $out/bin/dwp-$t \
        --add-flags $share/$t \
        --prefix PATH : ${lib.makeBinPath [ duckdb rclone ]} \
        --set-default TZDIR ${tzdata}/share/zoneinfo \
        --set-default SSL_CERT_FILE ${cacert}/etc/ssl/certs/ca-bundle.crt
    done
    # update-buoys and swell/collect are shell scripts that run their
    # neighbours (./forecast-ingest, ./publish) from this share dir.
    makeWrapper $share/update-buoys $out/bin/dwp-update-buoys \
      --prefix PATH : ${lib.makeBinPath [ python3 duckdb rclone curl netcat-openbsd coreutils gnused gnugrep ]} \
      --set-default TZDIR ${tzdata}/share/zoneinfo \
      --set-default SSL_CERT_FILE ${cacert}/etc/ssl/certs/ca-bundle.crt
  '';
  meta.mainProgram = "dwp-cam-ingest";
}
