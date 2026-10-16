"""The cams cam_motion.py watches: where each streams from and where its
water is. Plain data (no OpenCV), so db/cam-ingest can read the names too.

Boxes are (x, y, w, h) in the 1920x1080 frame:
  water: the band optical flow measures (water_motion.py)
  land:  a still patch whose flow is subtracted, to cancel camera shake
  caps:  the band whitecaps are counted in (whitecaps.py)
  caps_mask: parts of it where waves always break (rocks, reef)

dx < 0 (right to left in the picture) is down the coast toward Mākena on
every cam so far. The px/s scale differs per cam (distance, zoom), so a
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
}
