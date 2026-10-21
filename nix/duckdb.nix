# DuckDB 2.0 (LTS), built with nixpkgs' own derivation until nixpkgs
# catches up (nixpkgs-unstable is still on 1.5.5). The lake is on 2.0 and
# DuckLake 1.1 now, which 1.5 can't open, so every flake here uses this
# via ./overlay.nix. A copy of nixos-configs pkgs/duckdb.nix; drop both
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
  version = "2.0.0";
  rev = "d54cbbe3df17e8e5ce68312f483b4155836112aa";

  src = fetchFromGitHub {
    owner = "duckdb";
    repo = "duckdb";
    tag = "v2.0.0";
    hash = "sha256-1fhgPD/QGT/fK+BabX2dbTWOsajS6feNl5+9iw8rvwU=";
  };

  cmakeFlags =
    builtins.filter (f: !(lib.hasPrefix "-DOVERRIDE_GIT_DESCRIBE" f)) (old.cmakeFlags or [ ])
    ++ [
      (lib.cmakeFeature "DUCKDB_EXPLICIT_VERSION" "v2.0.0")
      (lib.cmakeFeature "GIT_COMMIT_HASH" "d54cbbe3df17e8e5ce68312f483b4155836112aa")
      (lib.cmakeFeature "DUCKDB_CAPABILITIES" "httplib;loadable_extensions")
    ];

  doInstallCheck = false;
})
