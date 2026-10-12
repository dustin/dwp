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
    librsvg  # rsvg-convert, for matrix-bot's spectrum images
  ];
  shellHook = ''
    export TZDIR="${tzdata}/share/zoneinfo"
    export FONTCONFIG_FILE="${makeFontsConf { fontDirectories = [ dejavu_fonts ]; }}"
    export PATH="$PWD/node_modules/.bin/:$PATH"
  '';
}
