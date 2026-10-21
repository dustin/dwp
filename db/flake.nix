{
  description = "downwind.pro DB stuff";
  nixConfig.bash-prompt = "\[dwp-dev\]$ ";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    nixpkgs-unstable.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };
  outputs = { self, nixpkgs, nixpkgs-unstable, flake-utils }:
    flake-utils.lib.eachDefaultSystem
      (system:
        let 
          pkgs = nixpkgs.legacyPackages.${system};
          pkgs-unstable = import nixpkgs-unstable {
            inherit system;
            overlays = [ (import ../nix/overlay.nix) ];
          };
        in
        {
          packages.db-env = pkgs.callPackage ./db-env.nix { duckdb = pkgs-unstable.duckdb; };
          devShells.default = import ./shell.nix { 
            inherit pkgs;
            inherit pkgs-unstable;
          };
        }
      ) // {
        homeManagerModules.default = ./hm-module.nix;
      };
}
