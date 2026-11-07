# dwp-display-render SIZE URL PUT_URL: screenshot a downwind.pro display
# page (one that sets <html data-ready>) at SIZE (WxH), cut it to the
# panels' four greys, and PUT it to the display server (Node-RED's
# /magtrmnl/<name>.bmp|png). A PUT_URL ending in .png gets a 2-bit
# grayscale PNG, which TRMNL firmware reads; anything else a 4-grey BMP3
# for the MagTag.
{ lib, stdenv, writeShellApplication, python3, imagemagick, curl, chromium, dejavu_fonts, makeFontsConf }:
let
  fonts = makeFontsConf { fontDirectories = [ dejavu_fonts ]; };
in
writeShellApplication {
  name = "dwp-display-render";
  runtimeInputs = [ python3 imagemagick curl ];
  text = ''
    if [ $# -ne 3 ]; then
      echo "usage: dwp-display-render WxH URL PUT_URL" >&2
      exit 2
    fi
    size="$1" url="$2" put_url="$3"
    export FONTCONFIG_FILE=${fonts}
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT

    SHOT_SIZE="$size" python3 ${./shot.py} "''${CHROME:-${lib.getExe chromium}}" "$url" "$tmp/screen.png" "''${DISPLAY_TIMEOUT:-60}"

    case "$put_url" in
      *.png) magick "$tmp/screen.png" -colorspace Gray -dither None -posterize 4 \
               -depth 2 -define png:color-type=0 -define png:bit-depth=2 "PNG:$tmp/out" ;;
      *)     magick "$tmp/screen.png" -colorspace Gray -dither None -posterize 4 \
               -type Palette "BMP3:$tmp/out" ;;
    esac

    curl -fsS --max-time 30 -X PUT -H "Content-Type: application/octet-stream" \
      --data-binary "@$tmp/out" "$put_url"
  '';
}
