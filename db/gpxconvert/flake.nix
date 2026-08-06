{
  description = "GPX speed/position filtering pipeline (stdlib-only Python)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      forAllSystems = nixpkgs.lib.genAttrs [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in {
      devShells = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            buildInputs = [
              pkgs.python3
              pkgs.tzdata  # zoneinfo needs this in a pure nix sandbox; system tzdata isn't guaranteed present
            ];
            shellHook = ''
              export TZDIR="${pkgs.tzdata}/share/zoneinfo"
            '';
          };
        });
    };
}
