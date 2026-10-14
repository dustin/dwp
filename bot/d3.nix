# d3's UMD bundle, which achievements.mjs loads in place of the npm:d3
# that the web code imports.
{ fetchurl }:
fetchurl {
  url = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js";
  hash = "sha256-8glLv2FBs1lyLE/kVOtsSw8OQswQzHr5IfwVj864ZTk=";
}
