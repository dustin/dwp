#!/usr/bin/env python3
"""
gpx_filter.py -- parse a GPX track, apply a multi-stage speed/position
filtering pipeline, and emit a CSV with both raw and filtered fields.

No third-party dependencies. Stdlib only (xml.etree, statistics, csv,
bisect, zoneinfo).

Pipeline stages, in order:
  1. Geometric detour test:  a single bad GPS fix makes the track jump
     out to the side and snap back; the path *through* it is much
     longer than the path *around* it. Needs no speed/accel assumption.
  2. HDOP test (optional):   if the GPX includes <hdop>, fixes the
     receiver itself flags as low-confidence get the same treatment.
     Stages 1-2 both "hold" the last known-good position through any
     flagged point, so it contributes ~zero spurious distance/speed.
  3. Instantaneous speed:    computed from a ~2s trailing window
     against the (already-cleaned) positions, not a single-sample
     delta -- better signal-to-noise for the same reason a longer
     baseline reduces relative position-error impact.
  4. Hampel filter:          a robust (median/MAD-based) statistical
     outlier test on the speed series itself. Catches single-point
     temporal spikes that stage 1 can't see because they sit on a
     geometrically straight line.
  5. Acceleration despike:   flags a point only if BOTH the incoming
     and outgoing rate of change exceed a plausible max AND point in
     opposite directions (a "spike" shape) -- a real acceleration
     ramp stays elevated, so this leaves genuine speed changes alone.
  6. Guard-band plateau test: the same idea as (5) generalized to
     spikes 1-2 points wide, using medians from windows a few
     seconds away on each side (deliberately excluding the immediate
     neighborhood so a short plateau can't inflate its own baseline).
  7. Sanity ceiling:         a very generous last-resort cap for
     physically-impossible values. Should essentially never fire --
     stages 1-6 are what should actually be doing the work, since
     they judge *context/support*, not raw magnitude, and so
     correctly let genuine fast conditions through untouched.

Run with --help for the full list of tunable thresholds.
"""

import argparse
import bisect
import csv
import statistics
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import math


# ----------------------------------------------------------------
# GPX parsing
# ----------------------------------------------------------------

def _strip_ns(tag: str) -> str:
    return tag.split('}')[-1] if '}' in tag else tag


def _parse_gpx_time(s: str) -> datetime:
    s = s.strip()
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    return datetime.fromisoformat(s)


@dataclass
class Point:
    idx: int
    time: datetime
    lat: float
    lon: float
    ele: float | None = None
    hr: int | None = None
    hdop: float | None = None


def parse_gpx(path: str) -> list[Point]:
    tree = ET.parse(path)
    root = tree.getroot()
    points: list[Point] = []
    for trkpt in root.iter():
        if _strip_ns(trkpt.tag) != 'trkpt':
            continue
        lat = float(trkpt.attrib['lat'])
        lon = float(trkpt.attrib['lon'])
        ele = None
        time = None
        hdop = None
        hr = None
        for child in trkpt:
            tag = _strip_ns(child.tag)
            if tag == 'ele' and child.text:
                ele = float(child.text)
            elif tag == 'time' and child.text:
                time = _parse_gpx_time(child.text)
            elif tag == 'hdop' and child.text:
                hdop = float(child.text)
            elif tag == 'extensions':
                for ext in child.iter():
                    if _strip_ns(ext.tag) == 'hr' and ext.text:
                        hr = int(ext.text)
        if time is None:
            continue  # a trkpt with no timestamp is unusable for this pipeline
        points.append(Point(idx=len(points), time=time, lat=lat, lon=lon,
                             ele=ele, hr=hr, hdop=hdop))
    points.sort(key=lambda p: p.time)
    for i, p in enumerate(points):
        p.idx = i
    return points


# ----------------------------------------------------------------
# Geometry
# ----------------------------------------------------------------

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


# ----------------------------------------------------------------
# Stage 1+2: geometric detour + HDOP outlier detection, with
# last-known-good position holding
# ----------------------------------------------------------------

@dataclass
class CleanedPoint:
    idx: int
    time: datetime
    lat_raw: float
    lon_raw: float
    lat: float          # filtered/held position
    lon: float
    ele: float | None
    hr: int | None
    hdop: float | None
    position_outlier: bool
    position_outlier_reason: str  # "", "geometric", "hdop", "both"


def clean_positions(points: list[Point], outlier_ratio: float, outlier_min_m: float,
                     hdop_max: float) -> list[CleanedPoint]:
    n = len(points)
    cleaned: list[CleanedPoint] = []
    last_good_lat = last_good_lon = None

    for i, p in enumerate(points):
        geo_outlier = False
        if 0 < i < n - 1:
            prev_p, next_p = points[i - 1], points[i + 1]
            direct = haversine_m(prev_p.lat, prev_p.lon, next_p.lat, next_p.lon)
            via = (haversine_m(prev_p.lat, prev_p.lon, p.lat, p.lon)
                   + haversine_m(p.lat, p.lon, next_p.lat, next_p.lon))
            if direct > 0 and via > outlier_min_m and via > direct * outlier_ratio:
                geo_outlier = True

        hdop_outlier = p.hdop is not None and p.hdop > hdop_max

        is_outlier = geo_outlier or hdop_outlier
        reason = ""
        if geo_outlier and hdop_outlier:
            reason = "both"
        elif geo_outlier:
            reason = "geometric"
        elif hdop_outlier:
            reason = "hdop"

        if is_outlier and last_good_lat is not None:
            lat, lon = last_good_lat, last_good_lon
        else:
            lat, lon = p.lat, p.lon
            last_good_lat, last_good_lon = p.lat, p.lon

        cleaned.append(CleanedPoint(
            idx=p.idx, time=p.time, lat_raw=p.lat, lon_raw=p.lon,
            lat=lat, lon=lon, ele=p.ele, hr=p.hr, hdop=p.hdop,
            position_outlier=is_outlier, position_outlier_reason=reason,
        ))
    return cleaned


# ----------------------------------------------------------------
# Stage 3: instantaneous speed from a trailing time window
# ----------------------------------------------------------------

def compute_instant_speed(cleaned: list[CleanedPoint], window_s: float) -> list[float]:
    n = len(cleaned)
    times = [p.time for p in cleaned]
    speeds = [0.0] * n
    j = 0  # two-pointer: earliest index within the trailing window of i
    for i in range(n):
        while (times[i] - times[j]).total_seconds() > window_s:
            j += 1
        dt = (times[i] - times[j]).total_seconds()
        if dt > 0:
            d = haversine_m(cleaned[j].lat, cleaned[j].lon, cleaned[i].lat, cleaned[i].lon)
            speeds[i] = (d / dt) * 3.6
        else:
            speeds[i] = 0.0
    return speeds


# ----------------------------------------------------------------
# Stage 4: Hampel filter (robust median/MAD outlier test)
# ----------------------------------------------------------------

def hampel_filter(times: list[datetime], speeds: list[float], window_s: float,
                   z_thresh: float, min_abs_kmh: float, mad_floor_kmh: float
                   ) -> tuple[list[float], list[bool]]:
    n = len(speeds)
    epochs = [t.timestamp() for t in times]
    out = speeds[:]
    flagged = [False] * n
    for i in range(n):
        lo = bisect.bisect_left(epochs, epochs[i] - window_s)
        hi = bisect.bisect_right(epochs, epochs[i] + window_s)
        local = speeds[lo:hi]
        if len(local) < 3:
            continue
        med = statistics.median(local)
        mad = statistics.median([abs(x - med) for x in local])
        mad_floored = max(mad, mad_floor_kmh / 1.4826)
        z = abs(speeds[i] - med) / (1.4826 * mad_floored)
        if z > z_thresh and abs(speeds[i] - med) > min_abs_kmh:
            out[i] = med
            flagged[i] = True
    return out, flagged


# ----------------------------------------------------------------
# Stage 5: single-point acceleration despike (two-sided "V" test)
# ----------------------------------------------------------------

def accel_despike(times: list[datetime], speeds: list[float], max_accel_kmh_s: float,
                   max_dt_s: float = 3.0) -> tuple[list[float], list[bool]]:
    n = len(speeds)
    out = speeds[:]
    flagged = [False] * n
    for i in range(1, n - 1):
        dt_in = (times[i] - times[i - 1]).total_seconds()
        dt_out = (times[i + 1] - times[i]).total_seconds()
        if dt_in <= 0 or dt_out <= 0 or dt_in > max_dt_s or dt_out > max_dt_s:
            continue
        accel_in = (speeds[i] - speeds[i - 1]) / dt_in
        accel_out = (speeds[i + 1] - speeds[i]) / dt_out
        if (abs(accel_in) > max_accel_kmh_s and abs(accel_out) > max_accel_kmh_s
                and (accel_in > 0) != (accel_out > 0)):
            frac = dt_in / (dt_in + dt_out)
            out[i] = speeds[i - 1] + (speeds[i + 1] - speeds[i - 1]) * frac
            flagged[i] = True
    return out, flagged


# ----------------------------------------------------------------
# Stage 6: guard-band plateau test
# ----------------------------------------------------------------

def plateau_despike(times: list[datetime], speeds: list[float], flank_lo_s: float,
                     flank_hi_s: float, spike_kmh: float, match_kmh: float
                     ) -> tuple[list[float], list[bool], list[float | None], list[float | None]]:
    n = len(speeds)
    epochs = [t.timestamp() for t in times]
    out = speeds[:]
    flagged = [False] * n
    pre_flanks: list[float | None] = [None] * n
    post_flanks: list[float | None] = [None] * n

    for i in range(n):
        pre_lo = bisect.bisect_left(epochs, epochs[i] - flank_hi_s)
        pre_hi = bisect.bisect_right(epochs, epochs[i] - flank_lo_s)
        post_lo = bisect.bisect_left(epochs, epochs[i] + flank_lo_s)
        post_hi = bisect.bisect_right(epochs, epochs[i] + flank_hi_s)

        pre_vals = speeds[pre_lo:pre_hi]
        post_vals = speeds[post_lo:post_hi]
        if not pre_vals or not post_vals:
            continue

        pre = statistics.median(pre_vals)
        post = statistics.median(post_vals)
        pre_flanks[i] = pre
        post_flanks[i] = post

        if (abs(pre - post) < match_kmh
                and abs(speeds[i] - pre) > spike_kmh
                and abs(speeds[i] - post) > spike_kmh):
            out[i] = (pre + post) / 2.0
            flagged[i] = True

    return out, flagged, pre_flanks, post_flanks


# ----------------------------------------------------------------
# Stage 7: sanity ceiling (last resort only)
# ----------------------------------------------------------------

def sanity_ceiling(speeds: list[float], pre_flanks: list[float | None],
                    post_flanks: list[float | None], ceiling_kmh: float
                    ) -> tuple[list[float], list[bool]]:
    out = speeds[:]
    flagged = [False] * len(speeds)
    for i, s in enumerate(speeds):
        if s > ceiling_kmh:
            pre, post = pre_flanks[i], post_flanks[i]
            if pre is not None and post is not None:
                out[i] = (pre + post) / 2.0
            elif pre is not None:
                out[i] = pre
            elif post is not None:
                out[i] = post
            else:
                out[i] = ceiling_kmh
            flagged[i] = True
    return out, flagged


# ----------------------------------------------------------------
# Cumulative distance, from cleaned (position-filtered) points
# ----------------------------------------------------------------

def cumulative_distance(cleaned: list[CleanedPoint]) -> list[float]:
    dist = [0.0] * len(cleaned)
    running = 0.0
    for i in range(1, len(cleaned)):
        running += haversine_m(cleaned[i - 1].lat, cleaned[i - 1].lon,
                                cleaned[i].lat, cleaned[i].lon)
        dist[i] = running
    return dist


# ----------------------------------------------------------------
# Main pipeline + CSV output
# ----------------------------------------------------------------

def run_pipeline(gpx_path: str, args: argparse.Namespace) -> list[dict]:
    points = parse_gpx(gpx_path)
    if not points:
        raise SystemExit(f"No trackpoints with timestamps found in {gpx_path}")

    cleaned = clean_positions(points, args.outlier_ratio, args.outlier_min_m, args.hdop_max)
    times = [c.time for c in cleaned]

    speed_2s = compute_instant_speed(cleaned, args.speed_window_s)
    speed_hampel, hampel_flag = hampel_filter(
        times, speed_2s, args.hampel_window_s, args.hampel_z_thresh,
        args.hampel_min_abs_kmh, args.hampel_mad_floor_kmh)
    speed_accel, accel_flag = accel_despike(times, speed_hampel, args.max_accel_kmh_s)
    speed_plateau, plateau_flag, pre_flanks, post_flanks = plateau_despike(
        times, speed_accel, args.plateau_flank_lo_s, args.plateau_flank_hi_s,
        args.plateau_spike_kmh, args.plateau_match_kmh)
    speed_final, sanity_flag = sanity_ceiling(
        speed_plateau, pre_flanks, post_flanks, args.absolute_max_speed_kmh)

    dist = cumulative_distance(cleaned)
    tz = ZoneInfo(args.tz)

    rows = []
    for i, c in enumerate(cleaned):
        rows.append({
            "idx": c.idx,
            "time_utc": c.time.isoformat(),
            "time_local": c.time.astimezone(tz).isoformat(),
            "lat_raw": c.lat_raw,
            "lon_raw": c.lon_raw,
            "lat_filtered": c.lat,
            "lon_filtered": c.lon,
            "ele_m": c.ele,
            "hr": c.hr,
            "hdop": c.hdop,
            "position_outlier": c.position_outlier,
            "position_outlier_reason": c.position_outlier_reason,
            "speed_2s_kmh": round(speed_2s[i], 3),
            "speed_hampel_kmh": round(speed_hampel[i], 3),
            "hampel_outlier": hampel_flag[i],
            "speed_accel_kmh": round(speed_accel[i], 3),
            "accel_outlier": accel_flag[i],
            "speed_plateau_kmh": round(speed_plateau[i], 3),
            "plateau_outlier": plateau_flag[i],
            "speed_final_kmh": round(speed_final[i], 3),
            "sanity_capped": sanity_flag[i],
            "distance_cumulative_m": round(dist[i], 2),
        })
    return rows


def write_csv(rows: list[dict], out_path: str) -> None:
    if not rows:
        return
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="Filter a GPX track's speed/position data and emit a CSV with raw + filtered fields.")
    ap.add_argument("gpx_path", help="Path to the input .gpx file")
    ap.add_argument("-o", "--output", default=None,
                     help="Output CSV path (default: <gpx_path stem>.csv)")
    ap.add_argument("--tz", default="Pacific/Honolulu",
                     help="IANA timezone for the time_local column (default: Pacific/Honolulu)")

    ap.add_argument("--speed-window-s", type=float, default=2.0,
                     help="Trailing window (seconds) for instantaneous speed (default: 2.0)")

    g1 = ap.add_argument_group("Stage 1-2: geometric + HDOP position outliers")
    g1.add_argument("--outlier-ratio", type=float, default=2.5,
                     help="via_dist / direct_dist above this = flagged (default: 2.5)")
    g1.add_argument("--outlier-min-m", type=float, default=5.0,
                     help="Ignore the geometric test below this detour distance in meters (default: 5.0)")
    g1.add_argument("--hdop-max", type=float, default=5.0,
                     help="Fixes with HDOP above this are held/skipped, if the GPX supplies HDOP (default: 5.0)")

    g2 = ap.add_argument_group("Stage 4: Hampel filter")
    g2.add_argument("--hampel-window-s", type=float, default=12.0,
                     help="Half-window (seconds) for the local median/MAD (default: 12.0)")
    g2.add_argument("--hampel-z-thresh", type=float, default=4.0,
                     help="Robust z-score threshold to flag (default: 4.0)")
    g2.add_argument("--hampel-min-abs-kmh", type=float, default=8.0,
                     help="...and must differ from local median by at least this much (default: 8.0)")
    g2.add_argument("--hampel-mad-floor-kmh", type=float, default=3.0,
                     help="Assume at least this much natural speed noise (default: 3.0)")

    g3 = ap.add_argument_group("Stage 5: acceleration despike")
    g3.add_argument("--max-accel-kmh-s", type=float, default=20.0,
                     help="Max plausible speed change per second for the two-sided spike test (default: 20.0)")

    g4 = ap.add_argument_group("Stage 6: guard-band plateau test")
    g4.add_argument("--plateau-flank-lo-s", type=float, default=3.0,
                     help="Near edge of the flank window in seconds (default: 3.0)")
    g4.add_argument("--plateau-flank-hi-s", type=float, default=10.0,
                     help="Far edge of the flank window in seconds (default: 10.0)")
    g4.add_argument("--plateau-spike-kmh", type=float, default=8.0,
                     help="Point must differ from BOTH flanks by at least this (default: 8.0)")
    g4.add_argument("--plateau-match-kmh", type=float, default=8.0,
                     help="...and the two flanks must agree with each other by this much (default: 8.0)")

    g5 = ap.add_argument_group("Stage 7: sanity ceiling")
    g5.add_argument("--absolute-max-speed-kmh", type=float, default=65.0,
                     help="Last-resort ceiling for physically-impossible values; should rarely fire (default: 65.0)")

    return ap


def main(argv=None):
    ap = build_arg_parser()
    args = ap.parse_args(argv)

    out_path = args.output
    if out_path is None:
        stem = args.gpx_path.rsplit(".", 1)[0]
        out_path = stem + ".csv"

    rows = run_pipeline(args.gpx_path, args)
    write_csv(rows, out_path)

    n = len(rows)
    n_pos_outliers = sum(1 for r in rows if r["position_outlier"])
    n_hampel = sum(1 for r in rows if r["hampel_outlier"])
    n_accel = sum(1 for r in rows if r["accel_outlier"])
    n_plateau = sum(1 for r in rows if r["plateau_outlier"])
    n_sanity = sum(1 for r in rows if r["sanity_capped"])
    max_final = max((r["speed_final_kmh"] for r in rows), default=0.0)

    print(f"wrote {n} rows to {out_path}", file=sys.stderr)
    print(f"  position outliers: {n_pos_outliers}", file=sys.stderr)
    print(f"  hampel flagged:    {n_hampel}", file=sys.stderr)
    print(f"  accel flagged:     {n_accel}", file=sys.stderr)
    print(f"  plateau flagged:   {n_plateau}", file=sys.stderr)
    print(f"  sanity capped:     {n_sanity}", file=sys.stderr)
    print(f"  max speed (final): {max_final:.2f} km/h", file=sys.stderr)


if __name__ == "__main__":
    main()
