# wailea-motion: the Wailea cam's water motion, published over MQTT.
# Python with OpenCV and numpy from nixpkgs; the scripts come from this
# directory (copied into the store, unlike matrix-bot, which runs from a checkout).
{ lib, stdenvNoCC, python3, makeWrapper, cacert }:
let
  python = python3.withPackages (ps: [ ps.opencv4 ps.numpy ]);
in
stdenvNoCC.mkDerivation {
  pname = "wailea-motion";
  version = "0";
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [ ./wailea_motion.py ./water_motion.py ./whitecaps.py ];
  };
  nativeBuildInputs = [ makeWrapper ];
  installPhase = ''
    mkdir -p $out/share/wailea-motion $out/bin
    cp *.py $out/share/wailea-motion/
    makeWrapper ${python}/bin/python3 $out/bin/wailea-motion \
      --add-flags $out/share/wailea-motion/wailea_motion.py \
      --set-default SSL_CERT_FILE ${cacert}/etc/ssl/certs/ca-bundle.crt
    makeWrapper ${python}/bin/python3 $out/bin/water-motion \
      --add-flags $out/share/wailea-motion/water_motion.py
  '';
  meta.mainProgram = "wailea-motion";
}
