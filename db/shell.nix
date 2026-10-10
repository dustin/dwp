{ pkgs ? import <nixpkgs> { }
, pkgs-unstable ? pkgs
}:
with pkgs;
mkShell {
  buildInputs = [
    pkgs-unstable.duckdb
    rclone
    (python3.withPackages (ps: [ ps.shapely ]))  # shapely: strava/import-archive
    tzdata  # for gpx_filter's zoneinfo
  ];
  shellHook = ''
    export TZDIR="${tzdata}/share/zoneinfo"
    export PATH="$PWD/node_modules/.bin/:$PATH"
  '';
}
