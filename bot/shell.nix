{ pkgs ? import <nixpkgs> { }
, pkgs-unstable ? pkgs
}:
with pkgs;
mkShell {
  buildInputs = [
    pkgs-unstable.duckdb
    rclone
    python3
    tzdata
    librsvg  # rsvg-convert, for the spectrum images (spectrum_svg.py)
  ];
  shellHook = ''
    export TZDIR="${tzdata}/share/zoneinfo"
    export FONTCONFIG_FILE="${makeFontsConf { fontDirectories = [ dejavu_fonts ]; }}"
  '';
}
