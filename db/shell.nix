{ pkgs ? import <nixpkgs> { }
, pkgs-unstable ? pkgs
}:
with pkgs;
mkShell {
  buildInputs = [
    pkgs-unstable.duckdb
    rclone
    python3
    tzdata  # for gpx_filter's zoneinfo
  ];
  shellHook = ''
    export TZDIR="${tzdata}/share/zoneinfo"
    export PATH="$PWD/node_modules/.bin/:$PATH"
  '';
}
