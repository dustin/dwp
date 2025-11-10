{ pkgs ? import <nixpkgs> { }
, pkgs-unstable ? pkgs
}:
with pkgs;
mkShell {
  buildInputs = [
    pkgs-unstable.duckdb
    rclone
  ];
  shellHook = ''
    export PATH="$PWD/node_modules/.bin/:$PATH"
  '';
}
