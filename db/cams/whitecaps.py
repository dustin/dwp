"""Whitecap share of the Wailea open water, by pixels rather than a model.

Whitecaps are small bright, unsaturated patches on blue water. Within the
water band (rocky point on the left masked off), a pixel counts when it is
much brighter than the water around it (local median + K * MAD, and at
least MIN_JUMP levels, so flat overcast water does not count its noise) and low in
saturation. Blobs bigger than MAX_BLOB (boats, sun glare) are dropped.
Prints the share of water pixels that are whitecap and the blob count.

    python3 whitecaps.py frame.jpg [overlay.png]
"""
import sys
import cv2
import numpy as np

WATER = (0, 50, 1920, 160)        # x, y, w, h: open water, above the tallest palm tops
MASK_OUT = [(0, 150, 260, 70)]    # the rocky point at the far left, where waves always break
K, MIN_JUMP, MAX_SAT, MIN_BLOB, MAX_BLOB = 6.0, 30, 60, 4, 400


def measure(img):
    x, y, w, h = WATER
    water = img[y:y + h, x:x + w]
    hsv = cv2.cvtColor(water, cv2.COLOR_BGR2HSV)
    v = hsv[..., 2].astype(np.float32)
    local = cv2.medianBlur(hsv[..., 2], 31).astype(np.float32)
    mad = np.median(np.abs(v - local)) + 1
    white = ((v > local + max(K * mad, MIN_JUMP)) & (hsv[..., 1] < MAX_SAT)).astype(np.uint8)
    keep = np.ones_like(white)
    for mx, my, mw, mh in MASK_OUT:
        keep[max(0, my - y):my - y + mh, max(0, mx - x):mx - x + mw] = 0
    white &= keep
    n, labels, stats, _ = cv2.connectedComponentsWithStats(white, connectivity=8)
    good = [i for i in range(1, n) if MIN_BLOB <= stats[i, cv2.CC_STAT_AREA] <= MAX_BLOB]
    mask = np.isin(labels, good)
    return mask.sum() / keep.sum(), len(good), mask


def main(path, out=None):
    img = cv2.imread(path)
    share, blobs, mask = measure(img)
    print(f"{path}: whitecaps {share * 1000:.2f}‰ of water, {blobs} patches")
    if out:
        x, y, w, h = WATER
        o = img.copy()
        o[y:y + h, x:x + w][mask] = (0, 0, 255)
        cv2.rectangle(o, (x, y), (x + w, y + h), (255, 255, 255), 1)
        cv2.imwrite(out, o[:y + h + 40])


if __name__ == "__main__":
    main(*sys.argv[1:])
