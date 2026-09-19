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
     geometrically straight line. Uses a tighter threshold for points
     immediately following an abnormally long sample gap (a dropped
     fix), since the next fix after a gap is inherently a longer,
     lower-confidence baseline and more likely to overshoot.
  4b. Raw-leg Hampel filter: the same test again, but run on raw,
     unsmoothed fix-to-fix leg speed instead of the ~2s-smoothed
     series stage 3/4 use. Averaging into a trailing window can
     dilute a single bad leg's spike below stage 4's threshold
     before it's ever seen; this pass catches those. It does not
     alter speed_hampel/speed_final -- it only feeds stage 8's
     distrust mask (see below), so it can be tuned independently
     without touching the despiked point-level series.
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
  8. Best sustained speed:   the headline "top speed" figure, computed
     as the best average speed over any span of the track lasting at
     least a configurable window (default 2s), using cumulative
     distance that OMITS any point flagged by stage 1/2 (position) or
     stage 4/4b (speed-domain Hampel, smoothed or raw-leg). Point-level
     speed_final can still carry a residual single-fix glitch; this
     metric asks whether real ground was covered in real time, so a
     one- or two-fix crash/GPS-noise artifact can't produce it.

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
                     hdop_max: float, max_passes: int = 3) -> list[CleanedPoint]:
    """
    Stage 1+2, iterated to convergence (or `max_passes`).

    A single forward pass only ever compares point i against its *raw*
    neighbors i-1/i+1. That misses short bursts of 2+ consecutive bad
    fixes -- e.g. from a crash -- because if i-1 is itself a bad fix,
    the "direct" leg of the detour test is already corrupted and the
    via/direct ratio no longer looks anomalous, so the point right next
    to a bad one can slip through untouched.

    Re-running the test using the *held* positions from the previous
    pass fixes this: once pass N corrects a bad fix to the last known
    good position, that neighbor looks normal to pass N+1, which
    exposes the point(s) beside it. This converges in a couple of
    passes for the short bursts a crash/tumble typically produces.
    """
    n = len(points)
    raw_lat = [p.lat for p in points]
    raw_lon = [p.lon for p in points]
    hdop_outlier = [p.hdop is not None and p.hdop > hdop_max for p in points]

    held_lat = raw_lat[:]
    held_lon = raw_lon[:]
    geo_outlier = [False] * n
    combined = [False] * n
    prev_combined = None

    for _ in range(max(1, max_passes)):
        geo_outlier = [False] * n
        for i in range(1, n - 1):
            prev_lat, prev_lon = held_lat[i - 1], held_lon[i - 1]
            next_lat, next_lon = held_lat[i + 1], held_lon[i + 1]
            direct = haversine_m(prev_lat, prev_lon, next_lat, next_lon)
            via = (haversine_m(prev_lat, prev_lon, raw_lat[i], raw_lon[i])
                   + haversine_m(raw_lat[i], raw_lon[i], next_lat, next_lon))
            # direct == 0 means the track is (per the held positions)
            # stationary on either side of i -- any real detour there is
            # suspect regardless of ratio, so don't let it short-circuit
            # the test the way `direct > 0` used to.
            if via > outlier_min_m and (direct == 0 or via > direct * outlier_ratio):
                geo_outlier[i] = True

        combined = [geo_outlier[i] or hdop_outlier[i] for i in range(n)]

        last_good_lat = last_good_lon = None
        for i in range(n):
            if combined[i] and last_good_lat is not None:
                held_lat[i], held_lon[i] = last_good_lat, last_good_lon
            else:
                held_lat[i], held_lon[i] = raw_lat[i], raw_lon[i]
                last_good_lat, last_good_lon = raw_lat[i], raw_lon[i]

        if combined == prev_combined:
            break
        prev_combined = combined

    cleaned: list[CleanedPoint] = []
    for i, p in enumerate(points):
        is_outlier = combined[i]
        reason = ""
        if geo_outlier[i] and hdop_outlier[i]:
            reason = "both"
        elif geo_outlier[i]:
            reason = "geometric"
        elif hdop_outlier[i]:
            reason = "hdop"

        cleaned.append(CleanedPoint(
            idx=p.idx, time=p.time, lat_raw=p.lat, lon_raw=p.lon,
            lat=held_lat[i], lon=held_lon[i], ele=p.ele, hr=p.hr, hdop=p.hdop,
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


def compute_leg_speed(cleaned: list[CleanedPoint]) -> list[float]:
    """
    Raw, unsmoothed fix-to-fix speed: leg_speed[i] is the speed of the single
    leg from point i-1 to point i (leg_speed[0] is always 0). Unlike
    compute_instant_speed's trailing window, this does no averaging, so a
    single bad fix's full spike survives right up until something explicitly
    tests for it -- which is the point: stage 4 runs a second Hampel pass on
    this series (see below) specifically because averaging into speed_2s can
    dilute a single-leg spike below the point-level Hampel's threshold.
    """
    n = len(cleaned)
    speeds = [0.0] * n
    for i in range(1, n):
        dt = (cleaned[i].time - cleaned[i - 1].time).total_seconds()
        if dt > 0:
            d = haversine_m(cleaned[i - 1].lat, cleaned[i - 1].lon, cleaned[i].lat, cleaned[i].lon)
            speeds[i] = (d / dt) * 3.6
    return speeds


# ----------------------------------------------------------------
# Stage 4: Hampel filter (robust median/MAD outlier test)
# ----------------------------------------------------------------

def hampel_filter(times: list[datetime], speeds: list[float], window_s: float,
                   z_thresh: float, min_abs_kmh: float, mad_floor_kmh: float,
                   gap_z_thresh: float | None = None, gap_ratio: float = 1.5
                   ) -> tuple[list[float], list[bool]]:
    """
    Robust (median/MAD) outlier test on the speed series.

    `gap_z_thresh`, if given, applies a *tighter* z threshold to any point
    whose incoming sample interval is abnormally long relative to the
    track's typical cadence (dt_in > gap_ratio * median_dt). A dropped GPS
    fix means the very next fix is a longer-baseline, lower-confidence
    measurement -- a straight-line overshoot that snaps back on the
    following (normal-cadence) sample looks geometrically unremarkable
    (stage 1 can't see it -- there's no detour shape) but is exactly the
    kind of fix a receiver is more likely to get wrong. Without this, such
    a point can sit just under the default threshold and slip through as
    an uncorrected speed spike.
    """
    n = len(speeds)
    epochs = [t.timestamp() for t in times]
    out = speeds[:]
    flagged = [False] * n

    dts = [epochs[i] - epochs[i - 1] for i in range(1, n)]
    median_dt = statistics.median(dts) if dts else 1.0

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

        thresh = z_thresh
        if gap_z_thresh is not None and i > 0 and median_dt > 0:
            dt_in = epochs[i] - epochs[i - 1]
            if dt_in > median_dt * gap_ratio:
                thresh = min(thresh, gap_z_thresh)

        if z > thresh and abs(speeds[i] - med) > min_abs_kmh:
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
    """Running distance along the track's (stage 1-2 filtered) positions."""
    dist = [0.0] * len(cleaned)
    running = 0.0
    for i in range(1, len(cleaned)):
        running += haversine_m(cleaned[i - 1].lat, cleaned[i - 1].lon,
                                cleaned[i].lat, cleaned[i].lon)
        dist[i] = running
    return dist


# ----------------------------------------------------------------
# Stage 8: best sustained average speed, not a single sample
# ----------------------------------------------------------------

# Finds the best average speed over any span of track covering at least
# window_s seconds. It asks a different question than any single point's
# speed_final: is there a real span of track that covers this much ground
# in this much time? A crash-related whip/glitch that only displaces one
# or two fixes can't satisfy that for any window long enough to matter.
# This is the number that should be reported as top speed, not the max
# of speed_final.
#
# `distrust` (position_outlier OR hampel_flag -- any signal that judges
# the *position itself* untrustworthy, geometric or speed-domain) marks
# points to leave out of this calculation entirely, rather than holding
# them at a substituted position the way stages 1-2 do for the point-level
# series. Substituting a position but keeping the point's real elapsed
# time in the chain creates a "hold, then catch-up" artifact: the
# substituted point's own leg collapses to ~0 distance, but the *next*
# leg (real position - substituted position) then has to cover the real
# ground in only the time since the flagged point, not since the last
# trusted one -- understating that leg's duration and overstating its
# speed, which is exactly the kind of bogus spike this function exists to
# avoid. Omitting the point instead connects the two neighboring trusted
# fixes directly, using their true positions and the true elapsed time
# between them, so ground and time stay consistent.
#
# Uses a two-pointer sweep (O(n)) over the trusted subsequence: for each
# start index i, advance the end index j to the first point at least
# window_s beyond it. Windows that hit a sampling gap (dt far exceeds
# window_s -- including gaps created by omitting a distrusted point) or
# run off the end of the track (dt short of window_s) are skipped rather
# than counted, since neither represents a genuine window_s-long
# sustained span.
def best_sustained_speed(cleaned: list[CleanedPoint], distrust: list[bool],
                          window_s: float, max_gap_ratio: float = 1.5) -> dict:
    best = {
        "speed_kmh": 0.0,
        "start_idx": None,
        "end_idx": None,
        "start_time": None,
        "end_time": None,
        "duration_s": None,
    }

    trusted = [i for i in range(len(cleaned)) if not distrust[i]]
    n = len(trusted)
    if n < 2:
        return best

    times = [cleaned[i].time for i in trusted]
    dist = [0.0] * n
    running = 0.0
    for k in range(1, n):
        a, b = cleaned[trusted[k - 1]], cleaned[trusted[k]]
        running += haversine_m(a.lat, a.lon, b.lat, b.lon)
        dist[k] = running

    j = 0
    for i in range(n):
        if j < i:
            j = i
        while j < n - 1 and (times[j] - times[i]).total_seconds() < window_s:
            j += 1
        dt = (times[j] - times[i]).total_seconds()
        if dt < window_s or dt > window_s * max_gap_ratio:
            continue
        speed = (dist[j] - dist[i]) / dt * 3.6
        if speed > best["speed_kmh"]:
            best = {
                "speed_kmh": speed,
                "start_idx": trusted[i],
                "end_idx": trusted[j],
                "start_time": times[i],
                "end_time": times[j],
                "duration_s": dt,
            }
    return best


# ----------------------------------------------------------------
# Main pipeline + CSV output
# ----------------------------------------------------------------

def run_pipeline(gpx_path: str, args: argparse.Namespace) -> tuple[list[dict], dict]:
    points = parse_gpx(gpx_path)
    if not points:
        raise SystemExit(f"No trackpoints with timestamps found in {gpx_path}")

    cleaned = clean_positions(points, args.outlier_ratio, args.outlier_min_m, args.hdop_max)
    times = [c.time for c in cleaned]

    speed_2s = compute_instant_speed(cleaned, args.speed_window_s)
    speed_hampel, hampel_flag = hampel_filter(
        times, speed_2s, args.hampel_window_s, args.hampel_z_thresh,
        args.hampel_min_abs_kmh, args.hampel_mad_floor_kmh,
        gap_z_thresh=args.hampel_gap_z_thresh, gap_ratio=args.hampel_gap_ratio)
    speed_accel, accel_flag = accel_despike(times, speed_hampel, args.max_accel_kmh_s)
    speed_plateau, plateau_flag, pre_flanks, post_flanks = plateau_despike(
        times, speed_accel, args.plateau_flank_lo_s, args.plateau_flank_hi_s,
        args.plateau_spike_kmh, args.plateau_match_kmh)
    speed_final, sanity_flag = sanity_ceiling(
        speed_plateau, pre_flanks, post_flanks, args.absolute_max_speed_kmh)

    # Stage 4b: a second Hampel pass on raw, unsmoothed fix-to-fix leg speed.
    # speed_2s's trailing-window averaging can dilute a single bad leg's
    # spike below the point-level Hampel's threshold, letting a genuinely
    # bad fix (in-line, so stage 1 can't see it either) through untouched.
    # This only feeds `position_distrust` below -- it does NOT alter
    # speed_hampel/speed_final, so the point-level despike pipeline and its
    # existing flag columns are unaffected.
    leg_speed = compute_leg_speed(cleaned)
    _, leg_hampel_flag = hampel_filter(
        times, leg_speed, args.leg_hampel_window_s, args.leg_hampel_z_thresh,
        args.leg_hampel_min_abs_kmh, args.leg_hampel_mad_floor_kmh)

    dist = cumulative_distance(cleaned)
    position_distrust = [c.position_outlier or hampel_flag[i] or leg_hampel_flag[i]
                          for i, c in enumerate(cleaned)]
    sustained = best_sustained_speed(cleaned, position_distrust, args.sustained_window_s)
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
            "leg_speed_raw_kmh": round(leg_speed[i], 3),
            "leg_hampel_outlier": leg_hampel_flag[i],
            "sustained_distrust": position_distrust[i],
        })
    return rows, sustained


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
    g2.add_argument("--hampel-gap-z-thresh", type=float, default=2.5,
                     help="Tighter z-score threshold applied only to points immediately "
                          "following an abnormally long sample gap, since the fix after a "
                          "dropped sample is inherently lower-confidence (default: 2.5)")
    g2.add_argument("--hampel-gap-ratio", type=float, default=1.5,
                     help="A sample interval above this multiple of the track's median "
                          "cadence counts as a gap for --hampel-gap-z-thresh (default: 1.5)")

    g2b = ap.add_argument_group("Stage 4b: raw-leg Hampel filter")
    g2b.add_argument("--leg-hampel-window-s", type=float, default=6.0,
                      help="Half-window (seconds) for the local median/MAD, applied to "
                           "raw unsmoothed fix-to-fix leg speed (default: 6.0)")
    g2b.add_argument("--leg-hampel-z-thresh", type=float, default=3.0,
                      help="Robust z-score threshold to flag (default: 3.0)")
    g2b.add_argument("--leg-hampel-min-abs-kmh", type=float, default=6.0,
                      help="...and must differ from local median by at least this much (default: 6.0)")
    g2b.add_argument("--leg-hampel-mad-floor-kmh", type=float, default=4.0,
                      help="Assume at least this much natural speed noise (default: 4.0)")

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

    g6 = ap.add_argument_group("Stage 8: sustained top speed")
    g6.add_argument("--sustained-window-s", type=float, default=2.0,
                     help="Window (seconds) for the best-sustained-average \"top speed\" metric, "
                          "computed from cumulative distance independent of the despike pipeline "
                          "(default: 2.0)")

    return ap


def main(argv=None):
    ap = build_arg_parser()
    args = ap.parse_args(argv)

    out_path = args.output
    if out_path is None:
        stem = args.gpx_path.rsplit(".", 1)[0]
        out_path = stem + ".csv"

    rows, sustained = run_pipeline(args.gpx_path, args)
    write_csv(rows, out_path)

    n = len(rows)
    n_hdop = sum(1 for r in rows if r["hdop"] is not None)
    n_pos_outliers = sum(1 for r in rows if r["position_outlier"])
    n_hampel = sum(1 for r in rows if r["hampel_outlier"])
    n_accel = sum(1 for r in rows if r["accel_outlier"])
    n_plateau = sum(1 for r in rows if r["plateau_outlier"])
    n_sanity = sum(1 for r in rows if r["sanity_capped"])
    max_final = max((r["speed_final_kmh"] for r in rows), default=0.0)

    print(f"wrote {n} rows to {out_path}", file=sys.stderr)
    if n_hdop == 0:
        print(f"  hdop: not present in source GPX -- stage 2 is inert, "
              f"position filtering relies on stage 1 (geometric) alone", file=sys.stderr)
    else:
        print(f"  hdop: present on {n_hdop}/{n} points", file=sys.stderr)
    print(f"  position outliers: {n_pos_outliers}", file=sys.stderr)
    print(f"  hampel flagged:    {n_hampel}", file=sys.stderr)
    print(f"  accel flagged:     {n_accel}", file=sys.stderr)
    print(f"  plateau flagged:   {n_plateau}", file=sys.stderr)
    print(f"  sanity capped:     {n_sanity}", file=sys.stderr)
    print(f"  max speed (point, despiked): {max_final:.2f} km/h", file=sys.stderr)
    if sustained["start_idx"] is not None:
        print(f"  top speed (best {args.sustained_window_s:.0f}s sustained): "
              f"{sustained['speed_kmh']:.2f} km/h "
              f"[idx {sustained['start_idx']}-{sustained['end_idx']}, "
              f"{sustained['start_time'].isoformat()} -> {sustained['end_time'].isoformat()}, "
              f"{sustained['duration_s']:.1f}s]", file=sys.stderr)
    else:
        print(f"  top speed (best {args.sustained_window_s:.0f}s sustained): "
              f"n/a (track shorter than window or has a gap covering it)", file=sys.stderr)

    if max_final > sustained["speed_kmh"] * 1.15 and max_final > 20:
        print(f"  NOTE: point-level max ({max_final:.2f} km/h) is notably higher than "
              f"the sustained top speed ({sustained['speed_kmh']:.2f} km/h) -- worth a manual look, "
              f"this can indicate a residual single-fix glitch the despike stages didn't fully catch.",
              file=sys.stderr)


if __name__ == "__main__":
    main()
