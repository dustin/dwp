# DuckDB 2.0 (LTS), built with nixpkgs' own derivation until nixpkgs
# catches up (nixpkgs-unstable is still on 1.5.5). The database is a DuckDB
# 2.0 file served over quack, neither of which 1.5 can use, so every flake
# here uses this via ./overlay.nix. A copy of nixos-configs pkgs/duckdb.nix; drop both
# once nixpkgs ships 2.x.
#
# nixpkgs' unit-test exclusion list is written for 1.5, so the install
# check is off; the build itself still has to succeed.
#
# 2.0 builds also link a "local_extension_repository" capability by
# default, which points INSTALL at the build's own repository directory
# (a /nix/var/nix/builds/... path that's gone after the build). Release
# builds leave it out, as here, so INSTALL uses extensions.duckdb.org.
#
# 2.0 also no longer parses nixpkgs' OVERRIDE_GIT_DESCRIBE
# ("v2.0.0-0-g<rev>"): it became the version verbatim, and so the
# extension folder. Give it the plain version and commit instead.
{ lib, duckdb, fetchFromGitHub }:

duckdb.overrideAttrs (old: {
  version = "2.0.1";
  rev = "8d78114e90a53823803660bf821f6073ac87da8c";

  src = fetchFromGitHub {
    owner = "duckdb";
    repo = "duckdb";
    tag = "v2.0.1";
    hash = "sha256-DJx1RsCwTIhuoSaNfqUIpDIkQ3YIOYbvGTgufBTalmk=";
  };

  cmakeFlags =
    builtins.filter (f: !(lib.hasPrefix "-DOVERRIDE_GIT_DESCRIBE" f)) (old.cmakeFlags or [ ])
    ++ [
      (lib.cmakeFeature "DUCKDB_EXPLICIT_VERSION" "v2.0.1")
      (lib.cmakeFeature "GIT_COMMIT_HASH" "8d78114e90a53823803660bf821f6073ac87da8c")
      (lib.cmakeFeature "DUCKDB_CAPABILITIES" "httplib;loadable_extensions")
    ];

  doInstallCheck = false;
})
