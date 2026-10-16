# cam-motion: each cam's water motion (cams.py), published over MQTT.
# Python with OpenCV and numpy from nixpkgs; the scripts come from this
# directory (copied into the store, unlike matrix-bot, which runs from a checkout).
{ lib, stdenvNoCC, python3, makeWrapper, cacert }:
let
  python = python3.withPackages (ps: [ ps.opencv4 ps.numpy ]);
in
stdenvNoCC.mkDerivation {
  pname = "cam-motion";
  version = "0";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./cam_motion.py ./cams.py ./rapidssl-g1.pem ./water_motion.py ./whitecaps.py ];
  };
  nativeBuildInputs = [ makeWrapper ];
  installPhase = ''
    mkdir -p $out/share/cam-motion $out/bin
    cp *.py *.pem $out/share/cam-motion/
    makeWrapper ${python}/bin/python3 $out/bin/cam-motion \
      --add-flags $out/share/cam-motion/cam_motion.py \
      --set-default SSL_CERT_FILE ${cacert}/etc/ssl/certs/ca-bundle.crt
    makeWrapper ${python}/bin/python3 $out/bin/water-motion \
      --add-flags $out/share/cam-motion/water_motion.py
  '';
  meta.mainProgram = "cam-motion";
}
