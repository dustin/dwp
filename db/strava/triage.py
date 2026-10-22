"""Shared pieces of the Strava importers (import-archive and sync).

Triage, per activity:
  - Duplicates: activities whose time ranges overlap are one session
    (riders often record on both phone and watch). The watch track (the
    one with heart rate) is kept unless it is under 90% of the phone's
    length, e.g. started mid-run; the others are never imported.
  - Trim: the track is cut to its first..last fix more than ~25 m off
    land, dropping rigging on the beach and the walk (or drive) home,
    which would otherwise count as time on foil.
  - Downwind: net displacement of 2 km or more, under 5% of the path
    moving back against the overall heading, and different start and
    end beaches (or over 5 km apart). Activities logged as something
    other than SUP, or named "downwind" but failing the test, go to
    review.

Each import is the same as add-run: gpx_filter.py, then import.sql with
DWP_RIDER, DWP_BOARD and DWP_FOIL; import.sql replaces any of the
rider's runs that overlap.

A point is (epoch seconds, lat, lon, heart rate or None).
"""

import csv
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

csv.field_size_limit(sys.maxsize)  # coastline WKT is megabytes
DB_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAKE_DIR = os.environ.get("LAKE") or os.path.expanduser("~/stuff/duck")

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(DB_DIR, "gpxconvert"))
sys.path.insert(0, DB_DIR)
import dwp_publish  # noqa: E402
import gpx_filter  # noqa: E402
import kml  # noqa: E402

GPX = "{http://www.topografix.com/GPX/1/1}"
HR = "{http://www.garmin.com/xmlschemas/TrackPointExtension/v1}hr"
LAND_BUFFER_M = 25  # so a fix on the sand still counts as land


def die(msg):
    print(f"{os.path.basename(sys.argv[0])}: {msg}", file=sys.stderr)
    sys.exit(1)


def run(cmd, cwd=None, env=None, stdin=None):
    print("+ " + " ".join(cmd), file=sys.stderr)
    r = subprocess.run(cmd, cwd=cwd, env=env, stdin=stdin)
    if r.returncode != 0:
        die(f"{cmd[0]} failed (exit {r.returncode})")


def rings(wkt):
    """A WKT shape's rings, each a list of (x, y) in local metres (see xy)."""
    return [[xy(float(lat), float(lon)) for lon, lat in
             (pair.split() for pair in ring.split(","))]
            for ring in re.findall(r"\(([^()]+)\)", wkt)]


def load_shapes(name, col):
    """(name, rings) rows from one of db's parquet files, via the duckdb CLI."""
    q = (f"install spatial; load spatial; "
         f"copy (select {col}, ST_AsText(geom) as wkt from '{name}') to '/dev/stdout' (format csv)")
    out = subprocess.run(["duckdb", "-c", q], cwd=DB_DIR, check=True,
                         capture_output=True, text=True).stdout
    return [(r[col], rings(r["wkt"])) for r in csv.DictReader(out.splitlines())]


# --- geometry -------------------------------------------------------------

# Everything here is Maui-sized, so a flat projection centred on 21N is
# plenty: x and y in metres.
COS_LAT = math.cos(math.radians(21))


def xy(lat, lon):
    return (lon * 111320.0 * COS_LAT, lat * 110574.0)


def seg_dist(p, a, b):
    ax, ay = a
    dx, dy = b[0] - ax, b[1] - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
    return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)


class Shapes:
    """Polygons with a grid of their edges, for inside tests and distances."""

    def __init__(self, rings, cell=200.0):
        self.cell = cell
        self.grid = {}   # (i, j) -> edges whose bbox touches that cell
        self.rows = {}   # j -> edges spanning that row of cells, for ray casting
        for ring in rings:
            for a, b in zip(ring, ring[1:] + ring[:1]):
                i0, i1 = sorted((int(a[0] // cell), int(b[0] // cell)))
                j0, j1 = sorted((int(a[1] // cell), int(b[1] // cell)))
                for j in range(j0, j1 + 1):
                    self.rows.setdefault(j, []).append((a, b))
                    for i in range(i0, i1 + 1):
                        self.grid.setdefault((i, j), []).append((a, b))

    def inside(self, p):
        """Even-odd ray cast to the east; holes count correctly."""
        x, y = p
        n = 0
        for (ax, ay), (bx, by) in self.rows.get(int(y // self.cell), ()):
            if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
                n += 1
        return n % 2 == 1

    def near(self, p, r):
        """Whether any edge is within r metres (r up to one cell)."""
        i, j = int(p[0] // self.cell), int(p[1] // self.cell)
        return any(seg_dist(p, a, b) <= r
                   for di in (-1, 0, 1) for dj in (-1, 0, 1)
                   for a, b in self.grid.get((i + di, j + dj), ()))

    def distance(self, p):
        """Metres to the nearest edge, 0 inside. Fine for small shapes."""
        if self.inside(p):
            return 0.0
        return min(seg_dist(p, a, b) for edges in self.rows.values() for a, b in edges)


def hav(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + \
        math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(h))


def bearing(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lo2 - lo1) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def every(pts, step):
    """The first point in each `step`-second bucket."""
    out, last = [], None
    for p in pts:
        if last is None or p[0] - last >= step:
            out.append(p)
            last = p[0]
    return out


# --- tracks ---------------------------------------------------------------

def parse_gpx(data):
    pts = []
    for tp in ET.fromstring(data).iter(GPX + "trkpt"):
        t = tp.find(GPX + "time")
        if t is None:
            continue
        hr = tp.find(".//" + HR)
        pts.append((datetime.fromisoformat(t.text.replace("Z", "+00:00")).timestamp(),
                    float(tp.get("lat")), float(tp.get("lon")),
                    int(hr.text) if hr is not None else None))
    return pts


def summarize(act, pts, land, beaches):
    """Triage numbers for one activity. act has id, type (Strava's
    display name, e.g. "Stand Up Paddling") and name."""
    row = dict(act)
    if len(pts) < 10:
        return row
    row.update(start=pts[0][0], end=pts[-1][0],
               watch=sum(p[3] is not None for p in pts) > len(pts) / 2)
    sub = every(pts, 5)
    water = [not (land.inside(q) or land.near(q, LAND_BUFFER_M))
             for q in (xy(p[1], p[2]) for p in sub)]
    if not any(water):
        return row
    i0 = water.index(True)
    i1 = len(water) - 1 - water[::-1].index(True)
    w = sub[i0:i1 + 1]
    a, b = (w[0][1], w[0][2]), (w[-1][1], w[-1][2])
    hd = bearing(a, b)
    # 30 s legs: path length, distance moving back against the overall
    # heading, and time over 11 km/h.
    tot = back = fast = 0.0
    legs = every(w, 30)
    for p, q in zip(legs, legs[1:]):
        d = hav((p[1], p[2]), (q[1], q[2]))
        tot += d
        if d > 1:
            c = math.cos(math.radians(bearing((p[1], p[2]), (q[1], q[2])) - hd))
            back += d * max(0.0, -c)
        if q[0] > p[0] and d / (q[0] - p[0]) * 3.6 > 11:
            fast += q[0] - p[0]

    def beach(pt):
        q = xy(*pt)
        return min(((n, round(b.distance(q))) for n, b in beaches), key=lambda nb: nb[1])

    sb, sbm = beach(a)
    eb, ebm = beach(b)
    row.update(w_start=w[0][0], w_end=w[-1][0], w_min=round((w[-1][0] - w[0][0]) / 60, 1),
               tail_trim_min=round((pts[-1][0] - w[-1][0]) / 60, 1),
               net_km=round(hav(a, b) / 1000, 2), path_km=round(tot / 1000, 2),
               backtrack=round(back / tot, 3) if tot else 0.0,
               foil_frac=round(fast / max(1.0, w[-1][0] - w[0][0]), 2),
               start_beach=sb, start_beach_m=sbm, end_beach=eb, end_beach_m=ebm)
    return row


def sessions(rows):
    """Group activities whose time ranges overlap."""
    groups, end = [], None
    for r in sorted((r for r in rows if "start" in r), key=lambda r: r["start"]):
        if end is None or r["start"] > end:
            groups.append([r])
            end = r["end"]
        else:
            groups[-1].append(r)
            end = max(end, r["end"])
    return groups


def choose(group):
    """The track to keep for one session, plus a note when it isn't the watch's."""
    tracked = [r for r in group if "net_km" in r] or group
    watch = [r for r in tracked if r.get("watch")]
    phone = [r for r in tracked if not r.get("watch")]
    longest = lambda rs: max(rs, key=lambda r: r.get("path_km", 0))
    if watch and phone:
        w, p = longest(watch), longest(phone)
        if w.get("path_km", 0) >= 0.9 * p.get("path_km", 0):
            return w, ""
        return p, f"watch track short ({w.get('path_km', 0)} vs {p.get('path_km', 0)} km), used phone"
    return longest(tracked), ""


def verdict(r):
    if "net_km" not in r:
        return "skip", "no track on the water"
    named = "downwind" in r["name"].lower()
    sup = r["type"] == "Stand Up Paddling" or named
    dw = (r["net_km"] >= 2 and r["backtrack"] <= 0.05
          and (r["start_beach"] != r["end_beach"] or r["net_km"] > 5))
    far = max(r["start_beach_m"], r["end_beach_m"]) > 3000
    if dw and sup and not far:
        return "downwind", ""
    if dw and sup:
        return "review", "start/end over 3 km from a known beach"
    if named and r["backtrack"] > 0.2 and r["net_km"] > 3:
        return "review", "several downwinds in one recording?"
    if named:
        return "review", f"named downwind but track fails (backtrack {r['backtrack']}, net {r['net_km']} km)"
    if dw:
        return "review", f"looks like a downwinder but logged as {r['type']}"
    return "skip", ""


def local(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone(
        ZoneInfo("Pacific/Honolulu")).strftime("%Y-%m-%d %H:%M")


# --- import ---------------------------------------------------------------

def write_gpx(pts, t0, t1, path):
    with open(path, "w") as fh:
        fh.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                 '<gpx version="1.1" creator="dwp strava" '
                 'xmlns="http://www.topografix.com/GPX/1/1" '
                 'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">'
                 '<trk><trkseg>\n')
        for t, lat, lon, hr in pts:
            if t0 <= t <= t1:
                iso = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                ext = (f"<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>{hr}</gpxtpx:hr>"
                       "</gpxtpx:TrackPointExtension></extensions>") if hr is not None else ""
                fh.write(f'<trkpt lat="{lat}" lon="{lon}"><time>{iso}</time>{ext}</trkpt>\n')
        fh.write("</trkseg></trk></gpx>\n")


def existing_runs(rider):
    """(start, end) epoch seconds of the rider's runs already in the lake."""
    if not rider.replace("-", "").isalnum():
        die(f"odd rider name: {rider}")
    q = (f"use lake; select ts, ts + duration_sec from dwlist "
         f"where rider = '{rider}' and ts is not null and duration_sec is not null")
    out = subprocess.run(["duckdb", "--init", "quack-init.sql", "-noheader", "-csv", "-c", q],
                         cwd=LAKE_DIR, check=True, capture_output=True, text=True).stdout
    return [tuple(map(float, line.split(","))) for line in out.splitlines()
            if line and line[0].isdigit()]


def load_geo():
    """Land and beach shapes for summarize()."""
    land = Shapes([ring for _, rings in load_shapes("coastline.parquet", "isle")
                   for ring in rings])
    beaches = [(n, Shapes(rs, cell=1e6))
               for n, _, w in kml.placemarks(os.path.join(DB_DIR, "beaches.kml"))
               for rs in [rings(w)]]
    return land, beaches


def triage(acts, tracks, land, beaches):
    """One picked row per session, with verdict "v", "why", "pick_note"
    and "duplicates". acts: dicts with id, type, name; tracks: id -> points."""
    rows = [summarize(a, tracks[a["id"]], land, beaches) for a in acts]
    picked = []
    for g in sessions(rows):
        r, note = choose(g)
        r["v"], r["why"] = verdict(r)
        r["pick_note"] = note
        r["duplicates"] = " ".join(x["id"] for x in g if x is not r)
        picked.append(r)
    return picked


def import_run(gpx_path, rider, board, foil, tmp):
    """Import one trimmed track; False if any step failed."""
    csv_path = os.path.join(tmp, "activity.csv")
    try:
        gpx_filter.main([gpx_path, "-o", csv_path])
    except Exception as e:  # noqa: BLE001 - report and move on to the next run
        print(f"gpx_filter failed: {e}", file=sys.stderr)
        return False
    env = dict(os.environ, DWP_CSV=csv_path, DWP_FOIL=foil, DWP_RIDER=rider,
               DWP_BOARD=board, DWP_NEW_FOIL="1")
    with open(os.path.join(DB_DIR, "import.sql")) as sql:
        r = subprocess.run(["duckdb", "-bail", "--init", "quack-init.sql"], cwd=LAKE_DIR, env=env,
                           stdin=sql)
    return r.returncode == 0


def import_sessions(todo, tracks, rider, board, foil, retries=3):
    """Trim and import each picked row in todo; returns the ones that failed.

    A failed import is retried `retries` times with a growing pause (the
    lake is sometimes briefly unavailable) before moving on."""
    failed = []
    with tempfile.TemporaryDirectory(prefix="dwp-strava-") as tmp:
        for i, r in enumerate(todo, 1):
            print(f"[{i}/{len(todo)}] {rider} {local(r['w_start'])} {r['name']}", file=sys.stderr)
            gpx = os.path.join(tmp, f"{r['id']}.gpx")
            pts = tracks[r["id"]]
            if len({p[3] for p in pts if p[3] is not None}) == 1:
                # A stuck sensor: one value for the whole run (seen as
                # 76 bpm throughout). Better no HR than a flat line.
                print("heart rate never changes, dropping it", file=sys.stderr)
                pts = [p[:3] + (None,) for p in pts]
            write_gpx(pts, r["w_start"], r["w_end"], gpx)
            for attempt in range(1, retries + 2):
                if import_run(gpx, rider, board, foil, tmp):
                    break
                if attempt <= retries:
                    print(f"failed, retrying ({attempt}/{retries})", file=sys.stderr)
                    time.sleep(5 * attempt)
            else:
                failed.append(r)
    return failed


def upload():
    try:
        dwp_publish.run()
    except dwp_publish.PublishError as e:
        die(f"publish: {e}")
