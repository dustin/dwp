"""Which way a cam's water is moving, from a few seconds of cam video.

Dense optical flow (OpenCV Farneback) between frames DT apart over the open
water band, with the median flow of a land patch subtracted so camera shake
doesn't count. Prints per-pair and overall median dx/dy in pixels/second
(dx < 0 is right to left in the picture, dy > 0 is toward the beach), the
share of water pixels moving left vs right, and writes an arrow overlay.

    python3 water_motion.py clip.ts [overlay.png]
"""
import sys
import cv2
import numpy as np

WATER = (0, 60, 1920, 230)   # x, y, w, h: Wailea's open water above the palm tops (cams.py has each cam's)
LAND = (1500, 520, 300, 120)  # Wailea's lawn, to cancel camera shake
FPS_SAMPLE, DT = 8, 2         # frames per second sampled; pairs DT samples apart (0.25 s)
SCALE = 0.5                   # flow on a half-size image: faster, and chop is still visible


def crop(img, box):
    x, y, w, h = box
    return img[y:y + h, x:x + w]


def frames(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    step, i = max(1, round(fps / FPS_SAMPLE)), 0
    while True:
        ok, f = cap.read()
        if not ok:
            return
        if i % step == 0:
            yield cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), f
        i += 1


def flow(a, b):
    h, w = a.shape
    a, b = (cv2.resize(x, None, fx=SCALE, fy=SCALE) for x in (a, b))
    f = cv2.calcOpticalFlowFarneback(a, b, None, 0.5, 3, 21, 3, 5, 1.1, 0) / SCALE
    return cv2.resize(f, (w, h))  # back to full-size pixels


def measure(path, out=None, water=WATER, land=LAND):
    """{dx, dy (px/s, median), left, right (share of moving water), pairs},
    or None when too little water moves to measure."""
    fs = list(frames(path))
    per_s = FPS_SAMPLE / DT
    dxs, dys, lefts, rights, field = [], [], [], [], None
    for (a, colour), (b, _) in zip(fs, fs[DT:]):
        w = flow(crop(a, water), crop(b, water))
        still = flow(crop(a, land), crop(b, land)).reshape(-1, 2)
        w = w - np.median(still, axis=0)
        mag = np.hypot(w[..., 0], w[..., 1])
        moving = mag > 0.15  # px per pair: ignore still water and noise
        dx, dy = w[..., 0][moving], w[..., 1][moving]
        if dx.size < 500:
            continue
        dxs.append(np.median(dx) * per_s)
        dys.append(np.median(dy) * per_s)
        lefts.append((dx < 0).mean())
        rights.append((dx > 0).mean())
        field = w if field is None else field + w
        last = colour
    if not dxs:
        return None
    m = {"dx": round(float(np.median(dxs)), 2), "dy": round(float(np.median(dys)), 2),
         "left": round(float(np.mean(lefts)), 2), "right": round(float(np.mean(rights)), 2),
         "pairs": len(dxs)}
    if out:
        field /= len(dxs)
        x0, y0, ww, hh = water
        img = last.copy()
        cv2.rectangle(img, (x0, y0), (x0 + ww, y0 + hh), (255, 255, 255), 1)
        for y in range(20, hh, 40):
            for x in range(20, ww, 40):
                fx, fy = field[y - 20:y + 20, x - 20:x + 20].reshape(-1, 2).mean(axis=0) * per_s * 4
                cv2.arrowedLine(img, (x0 + x, y0 + y), (int(x0 + x + fx), int(y0 + y + fy)),
                                (0, 0, 255), 2, tipLength=0.3)
        cv2.imwrite(out, img[:y0 + hh + 40])
    return m


def main(path, out=None):
    m = measure(path, out)
    if not m:
        print("no measurable water motion")
        return
    print(f"pairs {m['pairs']}  median dx {m['dx']:+.2f} px/s  dy {m['dy']:+.2f} px/s  "
          f"moving left {m['left']:.0%}  right {m['right']:.0%}")


if __name__ == "__main__":
    main(*sys.argv[1:])
