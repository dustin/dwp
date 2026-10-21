# DuckDB 2.0 in place of nixpkgs' duckdb; see ./duckdb.nix.
final: prev: {
  duckdb = final.callPackage ./duckdb.nix { inherit (prev) duckdb; };
}
