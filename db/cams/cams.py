"""The cams cam_motion.py watches: where each streams from and where its
water is. Plain data (no OpenCV), so db/cam-ingest can read the names too.

A cam is either Ozolio ("oid", optional "directory") or a plain HLS playlist
("hls", optional "referer" sent as the embedding page, and "intermediate", a
PEM here for a server that sends only its own certificate).

"gate" is the wind station (weather/<gate>) whose run the cam is for; while
it reads under 9 kn the cam is skipped. Default kihei.

Boxes are (x, y, w, h) in the cam's frame (Ozolio 1920x1080, Brownrice 1280x720):
  water: the band optical flow measures (water_motion.py)
  land:  a still patch whose flow is subtracted, to cancel camera shake
  caps:  the band whitecaps are counted in (whitecaps.py)
  caps_mask: parts of it where waves always break (rocks, reef)

A cam with "alertwest" (an AlertWest camera id) isn't a stream: it's the
panorama that camera stitches about every minute, too far off for motion, so
cam_motion.py only keeps "crops" of it, {kind: box}, as <stamp>-<kind>.jpg.

dx < 0 (right to left in the picture) is down the coast toward Mākena on
Wailea and Ulua. Poʻolenalena looks up the coast, so south is toward the
camera there (dy > 0) and dx < 0 is offshore. The px/s scale differs per cam (distance, zoom), so a
threshold set on one cam doesn't carry over to another.
"""

CAMS = {
    # Grand Wailea, looking out over Wailea Beach; water is the top third, behind palms.
    "wailea": {
        "oid": "CID_XWEE00001592", "directory": "DIR_0DEF00000001",
        "water": (0, 60, 1920, 230), "land": (1500, 520, 300, 120),
        "caps": (0, 50, 1920, 160), "caps_mask": [(0, 150, 260, 70)],
    },
    # Wailea Beach Marriott, on the point between Wailea and Ulua beaches,
    # looking northwest at West Maui. Near water left of the reef, above the palm tops.
    "ulua": {
        "oid": "CID_GQRS00000091",
        "water": (0, 370, 1100, 170), "land": (1440, 930, 150, 100),
        "caps": (0, 335, 1550, 170), "caps_mask": [(1120, 445, 430, 60)],
    },
    # Makena Surf, above Poʻolenalena Beach, looking northwest up the coast
    # (Brownrice player on makenasurf.org, 720p). Water left of the shorebreak,
    # between thin palm trunks; the roof is the still patch.
    # streamer4 sends no intermediate: rapidssl-g1.pem (RapidSSL TLS RSA CA G1,
    # under DigiCert Global Root G2) runs out 2027-11-02.
    "poolenalena": {
        "hls": "https://streamer4.brownrice.com/makenasurf/makenasurf.stream/main_playlist.m3u8",
        "referer": "https://makenasurf.org/", "intermediate": "rapidssl-g1.pem",
        "water": (0, 200, 680, 130), "land": (600, 600, 300, 80),
        "caps": (0, 190, 680, 140), "caps_mask": [],
    },
    # Kahului Harbor (Surfline), looking north out the harbor mouth past the
    # breakwater: whitecaps in the harbor and outside it, and how much swell
    # comes in. The harbor water above the tree for motion; the road is still.
    # Trades blow right to left here.
    "kahului_harbor": {
        "hls": "https://hls.cdn-surfline.com/oregon/hi-kahuluiharbor/playlist.m3u8",
        "referer": "https://www.surfline.com/", "gate": "hookipa",
        "water": (0, 400, 1920, 120), "land": (300, 1000, 400, 60),
        "caps": (0, 335, 1920, 390), "caps_mask": [(0, 350, 1190, 42), (570, 525, 500, 300)],
    },
    # AlertWest "Wailea_2" (HECO), up the hill above Wailea: a 392° panorama,
    # 11520x1080, six 1920px frames each exposed on its own. The water is the
    # right third: Mākena and Puʻu Ōlaʻi, the Wailea coast (a pole crosses
    # it), and Kīhei up to Maʻalaea, thin and far.
    "wailea_pano": {
        "alertwest": 15812,
        "crops": {"makena": (7100, 540, 580, 120), "wailea": (7680, 560, 1920, 230),
                  "kihei": (9600, 650, 1200, 120)},
    },
}
