"""Publish runs and conditions to the CDN, uploading only what changed.

    ./publish             export and upload whatever changed
    ./publish --all       ...checking every conditions day and every list,
                          not just the last 14 days' (nightly, or after a backfill)
    ./publish --dry-run   say what would be uploaded; upload and record nothing
    ./publish verify      check the bucket against the manifest
    ./publish verify --fix   ...and re-upload whatever is missing or wrong
    ./publish orphans     list objects the database no longer makes (from the S3
                          inventory in the database, so about a day behind)
    ./publish orphans --delete   ...and delete them from S3

Each of these asks the publish service (./publishd, wherever it runs) to
do it, over MQTT (DWP_MQTT, default mqtt), and prints what it printed;
so does run(), which add-run, the bot and drive-sync call. Add --local to
run it here instead, for when publishd is down.

Everything under s3:db.downwind.pro/ that comes from the database goes through
here: each run's track and each rider's lists under runs/, and one file per
site and day under wind/, swell/, swell_partition/ and swell_spectrum/.

Cam readings and images (cam_motion and cam_images, which cam-ingest
fills) publish per site and day like the conditions, under cam_motion/ and
cam_images/. cam-ingest puts the images themselves in S3 from the host that
took them and records them with file null, so publish never needs them. Rows
from before that name a local file instead: each one the manifest doesn't
have goes to S3 at its key from that file, once, cached a year (images never
change). Once such an image has been in S3 since an earlier publish and its
local copy is over 14 days old (DWP_IMAGE_KEEP_DAYS), publish deletes the
local copy. Wind forecasts (wind_forecast, from
forecast-ingest) publish the same way under wind_forecast/. publish only
reads the database.

The manifest, the database's publish_manifest table (schema.sql), records,
for every object publish has put in S3, the sha256 of its uncompressed CSV, its
gzipped size, the headers it was uploaded with, and a fingerprint of the database
rows it was made from (row count and the sum of the rows' hashes). A publish:

  1. fingerprints every track and every site-day of the last 14 days
     (DAYS; ./publish --all does every day, for a backfill of older ones)
     in one duckdb process, and picks the ones whose fingerprint differs
     from the manifest's: new runs, re-imported or edited ones, the day the
     last ingest added to, a day a backfill rewrote. A track's fingerprint
     is its dws rows, trim and synthesized points; the heatmaps' and each
     rider's lists' are made from those and the dwlist, riders and
     conditions rows they read, so a list is only exported when something
     it shows changed (a new run: its rider's lists and everyone's
     together.csv; a wind reading: runs.csv of riders who rode that day);
  2. exports just those, in one more duckdb process, into a temp dir;
  3. skips files whose bytes and headers S3 already has: a day whose cache
     lifetime goes from short to long is re-sent for its headers alone;
  4. gzips the rest, uploads them with rclone (no listing, no HEAD per
     object), tracks and conditions before the lists that point at them,
     and only then records them in the manifest.

So a failure anywhere leaves the manifest as it was, and the next publish
redoes the work. The temp dir goes away when the run ends. Nothing is ever
deleted from S3: a re-imported run's old track stays, unreferenced.

Cache lifetimes: lists and the newest two Hawaii days of conditions get five
minutes (today's, and yesterday's for a while after midnight: the 23:56
reading isn't out until about 00:35, and NDBC revises its newest spectrum
half an hour after first posting it). Older days get a year. Tracks get
S3's default. When an object that already had the year-long lifetime is
rewritten (a backfill), publish lists it at the end: those paths need a
CloudFront invalidation to show up promptly.

verify lists the bucket (a paginated LIST, no per-object requests) and
compares it with the manifest: keys missing from S3 or with the wrong size.
--fix forgets those and publishes, which exports and uploads them again.

The first publish, with no manifest yet, adopts the bucket the old upload
scripts filled: it exports everything, lists the bucket, and records the keys
S3 already has without uploading them, except the last 14 days of tracks and
conditions (the window the old scripts re-sent every time, so the newest
copies are the ones in doubt). Everything S3 lacks is uploaded, and so are
the lists. Try it with --dry-run first.

orphans reads the bucket inventory (s3.latest_files, about a day behind) and
lists objects under publish's prefixes that no run or site-day in the database
makes any more, such as the old track of a re-imported run. --delete
removes them from S3 (and the manifest), but refuses if they're over 5% of
the inventory, which smells like a database read gone wrong rather than real
orphans; --force overrides that. It also lists objects the manifest says were uploaded over two days
ago that the inventory doesn't have, a check verify --fix can then repair.

Run it as ./publish from db's nix dev shell (python3, duckdb, rclone), like
add-run. Python in db/ imports this module and calls publish.run() instead.
"""

import csv
import argparse
import fcntl
import gzip
import hashlib
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DB_DIR = os.path.dirname(os.path.abspath(__file__))
DWP_DB_DIR = os.environ.get("DWP_DB") or os.path.expanduser("~/.config/duckq/dwp")
# Every publish goes through the publish service (publishd), over the
# broker DWP_MQTT (default mqtt); publishd sets DWP_PUBLISH_LOCAL for the
# ./publish it runs, and ./publish --local runs here when it's down.
MQTT = os.environ.get("DWP_MQTT") or "mqtt"
LOCAL = bool(os.environ.get("DWP_PUBLISH_LOCAL"))
REQUEST_TOPIC = "dwp/publish/req"
REPLY_TOPIC = "dwp/publish/reply"
STATUS_TOPIC = "dwp/publish/status"
REQUEST_WAIT = 30 * 60
LOCK = os.path.join(os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"), "dwp-publish.lock")
DEST = (os.environ.get("DWP_DEST") or "s3:db.downwind.pro").rstrip("/") + "/"
RIDER = re.compile(r"[a-z][a-z0-9-]*")
LISTS = ["runs", "crashes", "run_buoy", "together"]
# export-lists.sql's .output lines write here; publish points them at its
# temp dir instead.
LISTS_DIR = "dwlists/"

GZ_CSV = ["Content-Encoding: gzip", "Content-Type: text/csv; charset=utf-8"]
SHORT = GZ_CSV + ["Cache-Control: public, max-age=300"]
LONG = GZ_CSV + ["Cache-Control: public, max-age=31536000"]
IMAGE = ["Content-Type: image/jpeg", "Cache-Control: public, max-age=31536000, immutable"]
# Local cam images already in S3 are deleted once this old (DWP_IMAGE_KEEP_DAYS).
IMAGE_KEEP_DAYS = float(os.environ.get("DWP_IMAGE_KEEP_DAYS") or 14)


# The trail heatmaps (see the heatmap table below) count runs per cell of
# one grid over the whole globe: cell (i, j) is the HEATMAP_CELL degrees
# (about 22 m) square whose southwest corner is at lon i * HEATMAP_CELL -
# 180, lat j * HEATMAP_CELL - 90. A rider's overview uses
# HEATMAP_OVERVIEW_CELL (about 400 m) the same way. The pages work out
# where the cells are from these (web/lib/components/trail-heatmap.js).
HEATMAP_CELL = 0.0002
HEATMAP_OVERVIEW_CELL = 0.004


def region_slug(region):
    """'Maui North Shore' -> 'maui-north-shore', like REGION_SLUG_SQL."""
    return re.sub(r"[^a-z0-9]+", "-", region.lower()).strip("-")


REGION_SLUG_SQL = "trim(regexp_replace(lower({}), '[^a-z0-9]+', '-', 'g'), '-')"
# Site-days of conditions fingerprinted on a plain publish: the last DAYS
# (Hawaii) days. Older days only change in a backfill; ./publish --all
# fingerprints them all.
DAYS = 14


class Table:
    """One table published as one CSV per key.

    frm is the FROM clause, with the table's rows as x. key names each row's
    object; cols is what goes in the file; order (columns of cols) sorts it,
    ties broken by the row's hash so the bytes don't change between exports;
    recent marks keys the first publish re-sends instead of adopting S3's copy.
    fp_sql(cutoff) is the query fingerprinting every key (or those from
    cutoff on), and filter(keys) a predicate on x narrowing an export to
    keys, pushed down to the table (an "in" on the key alone isn't).
    """

    def __init__(self, name, frm, key, cols, order, recent, day=None, headers=GZ_CSV):
        self.name, self.frm, self.key, self.cols = name, frm, key, cols
        self.order, self.recent, self.day, self.hdr = order, recent, day, headers

    def headers(self, key, today):
        if self.day is None:
            return self.hdr
        day = re.search(r"/day=([0-9-]+)/", key).group(1)
        return SHORT if day >= (today - timedelta(days=1)).isoformat() else LONG

    def fp_sql(self, cutoff):
        where = f"where ({self.day})::date >= DATE '{cutoff}'" if cutoff and self.day else ""
        return f"""select {self.key} as k,
                     count(*)::varchar || ':' || sum(hash(x))::varchar as fp,
                     {self.recent} as recent
              from {self.frm} {where} group by all"""

    def filter(self, keys):
        days = sorted(re.search(r"/day=([0-9-]+)/", k).group(1) for k in keys)
        return f"where ({self.day})::date between DATE '{days[0]}' and DATE '{days[-1]}'"


class Tracks(Table):
    """The tracks: fingerprinted from what makes them (each run's dws rows,
    trim and synthesized points, and its rider) rather than through
    run_points, whose window function would sort every point of every run;
    the rows also carry the run's rider, id, date and region for the lists'
    fingerprints."""

    def fp_sql(self, cutoff):
        return """
            with p as (select dwid, count(*) as n, sum(hash(d))::varchar as h, max(ts) as mx
                       from dws d group by dwid),
                 s as (select dwid, count(*)::varchar || ':' || sum(hash(s))::varchar as h
                       from synth_points s group by dwid),
                 t as (select dwid, hash(start_ts, end_ts)::varchar as h from run_trims)
            select 'runs/rider=' || l.rider || '/dwid=' || l.id || '/data.csv' as k,
                   p.n::varchar || ':' || p.h || ':' || coalesce(t.h, '') || ':' || coalesce(s.h, '') as fp,
                   p.mx > current_timestamp - interval 14 days as recent,
                   l.rider as rider, l.id::varchar as dwid, l.date::varchar as date, b.region as region
            from dwlist l
            join p on p.dwid = l.id
            left join t on t.dwid = l.id
            left join s on s.dwid = l.id
            left join beaches b on b.id = l.start_pos
            where l.rider is not null"""

    def filter(self, keys):
        ids = [re.search(r"/dwid=([^/]+)/", k).group(1) for k in keys]
        return "and x.dwid in (" + ", ".join(f"'{i}'::uuid" for i in ids) + ")"  # frm has a where


class Heatmap(Table):
    """The trail heatmaps: fingerprinted in Python from the tracks they're
    made of (see heatmap_fingerprints), so the query only runs to export a
    changed one."""

    def fp_sql(self, cutoff):
        return None

    def filter(self, keys):
        return ""


def conditions(table, day="x.day", cols="x.* exclude (site, day)", order="ts"):
    return Table(table, f"{table} x",
                 f"'{table}/site=' || x.site || '/day=' || ({day})::date || '/data.csv'",
                 cols, order,
                 f"max({day})::date > (current_timestamp at time zone 'Pacific/Honolulu')::date - 14",
                 day=day)


TABLES = [
    Tracks("tracks",
          # Only the points within the run's trim (run_points in schema.sql).
          "run_points x join dwlist l on x.dwid = l.id where l.rider is not null",
          # The rider is in the key, and so in the fingerprint.
          "'runs/rider=' || l.rider || '/dwid=' || x.dwid || '/data.csv'",
          "x.* exclude (dwid), ST_Distance_Sphere(ST_Point(x.lat, x.lon), "
          "ST_Point(x.nearest_land_lat, x.nearest_land_lon)) as distance_to_land",
          "tsi",
          "max(x.ts) > current_timestamp - interval 14 days"),
    conditions("wind"),
    conditions("swell"),
    conditions("swell_partition"),
    # The spectrum archive has no day column; derive the same Hawaii day
    # update.sql gives swell_partition.
    conditions("swell_spectrum",
               day="x.ts at time zone 'Pacific/Honolulu'",
               cols="x.* exclude (site)", order="ts, freq"),
    conditions("cam_motion"),
    conditions("wind_forecast", order="ts, model, issued, lead_days"),
    # file is where the image is on this machine; not published.
    conditions("cam_images", cols="x.* exclude (site, day, file)", order="ts, kind"),
    # Trail heatmaps: how many runs passed through each cell of the
    # HEATMAP_CELL grid. Each point and the midpoint back to the one before
    # it count, so a fast stretch doesn't skip cells. Runs with no region
    # (far from any beach) are left out.
    #   heatmap/region=<slug>/data.csv: every hub rider's runs in the region
    #     (the Maliko and Kihei pages, and "everyone's" on rider pages);
    #   runs/rider=<rider>/heatmap/region=<slug>/data.csv: the rider's;
    #   runs/rider=<rider>/heatmap/overview.csv: all the rider's runs, on
    #     the coarser HEATMAP_OVERVIEW_CELL grid.
    # The speed maps are the same three under heatmap/fastest/ (and
    # runs/rider=<rider>/heatmap/fastest/), counting only each run's
    # fastest 1 km: from each point to the first one at least 1000 m on,
    # the quickest of those, as findFastest1kSegment in
    # web/lib/components/map.js finds it.
    Heatmap("heatmap", f"""(
        with p as (
          select l.rider, coalesce(r.hub, true) as hub, {REGION_SLUG_SQL.format("l.region")} as region,
                 x.dwid, x.tsi, x.distance, x.lat, x.lon,
                 lag(x.lat) over w as plat, lag(x.lon) over w as plon, lag(x.tsi) over w as ptsi
          from run_points x
          join dwlist_resolved l on x.dwid = l.id
          left join riders r on r.rider = l.rider
          where regexp_full_match(l.rider, '{RIDER.pattern}') and l.region is not null
            and not x.synthetic and x.lat is not null
          window w as (partition by x.dwid order by x.ts)
        ),
        s as (
          select a.dwid, arg_min([a.tsi, b.tsi], b.tsi - a.tsi) as seg
          from p a asof join p b on a.dwid = b.dwid and b.distance >= a.distance + 1000
          group by a.dwid
        ),
        q as (
          select rider, hub, region, dwid,
                 unnest([lon, (lon + coalesce(plon, lon)) / 2]) as lon,
                 unnest([lat, (lat + coalesce(plat, lat)) / 2]) as lat,
                 unnest([fast, fast and ptsi >= seg[1]]) as fast
          from (select p.*, s.seg, coalesce(p.tsi between s.seg[1] and s.seg[2], false) as fast
                from p left join s using (dwid))
        ),
        c as (
          select *, floor((lon + 180) / {HEATMAP_CELL})::int as i, floor((lat + 90) / {HEATMAP_CELL})::int as j
          from q
        ),
        o as (
          select *, floor((lon + 180) / {HEATMAP_OVERVIEW_CELL})::int as i,
                 floor((lat + 90) / {HEATMAP_OVERVIEW_CELL})::int as j
          from q
        )
        select 'heatmap/region=' || region || '/data.csv' as k, i, j, count(distinct dwid) as runs
        from c where hub group by all
        union all
        select 'runs/rider=' || rider || '/heatmap/region=' || region || '/data.csv', i, j, count(distinct dwid)
        from c group by all
        union all
        select 'runs/rider=' || rider || '/heatmap/overview.csv', i, j, count(distinct dwid)
        from o group by all
        union all
        select 'heatmap/fastest/region=' || region || '/data.csv', i, j, count(distinct dwid)
        from c where hub and fast group by all
        union all
        select 'runs/rider=' || rider || '/heatmap/fastest/region=' || region || '/data.csv', i, j, count(distinct dwid)
        from c where fast group by all
        union all
        select 'runs/rider=' || rider || '/heatmap/fastest/overview.csv', i, j, count(distinct dwid)
        from o where fast group by all
    ) x""",
          "x.k", "x.i, x.j, x.runs", "j, i", "true", headers=SHORT),
]


def log(msg):
    print(f"publish: {msg}", file=sys.stderr, flush=True)


class PublishError(Exception):
    pass


def die(msg):
    raise PublishError(msg)


# Where the time goes: every duckdb and rclone call, and the Python work
# between them, as (phase, what, seconds). publish() prints the summary
# at the end (DWP_PUBLISH_TIMING=0 to leave it out).
TIMINGS = []
PHASE = ["manifest"]
STARTED = time.monotonic()  # when this process began, near enough


def note(what, t0):
    TIMINGS.append((PHASE[0], what, time.monotonic() - t0))


def report_timings(total):
    if os.environ.get("DWP_PUBLISH_TIMING", "1") == "0" or not TIMINGS:
        return
    log(f"timing: {total:.1f}s in all")
    phases = {}
    for phase, what, secs in TIMINGS:
        phases.setdefault(phase, [0, 0.0])
        phases[phase][0] += 1
        phases[phase][1] += secs
    accounted = sum(v[1] for v in phases.values())
    for phase, (n, secs) in phases.items():
        log(f"timing: {secs:6.1f}s  {phase} ({n} step{'s' if n != 1 else ''})")
    log(f"timing: {total - accounted:6.1f}s  (everything else: python, temp files, waiting)")
    for phase, what, secs in TIMINGS:
        if secs >= 0.5:
            log(f"timing:   {secs:6.1f}s  {phase}: {what}")


# The tracks export's ST_Point(lat, lon) is the pre-2.0 axis order, which
# DuckDB 2.0 makes ST_Distance_Sphere ask for.
XY = "load spatial;\nset geometry_always_xy = false;\n"


def duckdb(sql, json_out=False, cmd=None, what=None):
    """Run sql against the database; with json_out, return the last result's
    rows. what names the call in the timing summary (default: its first
    line). queries() runs several at once."""
    t0 = time.monotonic()
    args = ["duckdb", "-bail", "--init", "quack-init.sql"]
    if json_out:
        args.append("-json")
    if cmd:
        args += ["-cmd", cmd]
    r = subprocess.run(args, cwd=DWP_DB_DIR, input="use dwp;\n" + XY + sql,
                       capture_output=True, text=True)
    note("duckdb " + (what or " ".join(sql.split())[:60]), t0)
    if r.returncode != 0 or "Error:" in r.stderr:
        die(f"duckdb failed:\n{r.stderr}")
    if not json_out:
        return None
    out = r.stdout.strip()
    if json_out == "all":
        return out
    try:
        return last_json(out)
    except json.JSONDecodeError:
        die(f"duckdb printed something other than JSON:\n{out[:2000]}\n--- stderr:\n{r.stderr[:2000]}")


def queries(named, what):
    """Run the queries named (label -> select) in one duckdb process;
    label -> its rows. Each goes up as one row holding its rows as JSON,
    so the results come back apart however the CLI prints them."""
    sql = "".join(
        f"select {sql_str(k)} as q, coalesce(json_group_array(to_json(x)), '[]')::varchar as j "
        f"from ({v.strip().rstrip(';')}) x;\n" for k, v in named.items())
    out = {}
    for rows in all_json(duckdb(sql, json_out="all", what=what)):
        for r in rows:
            if isinstance(r, dict) and set(r) == {"q", "j"}:
                out[r["q"]] = json.loads(r["j"])
    missing = set(named) - set(out)
    if missing:
        die(f"duckdb gave no result for {', '.join(sorted(missing))}")
    return out


def all_json(out):
    """Every JSON array in duckdb's output, in order."""
    out = re.sub(r"WARNING:.*?\n\s*\n", "", out, flags=re.S)
    dec, i, found = json.JSONDecoder(), 0, []
    while (i := out.find("[", i)) >= 0:
        try:
            rows, i = dec.raw_decode(out, i)
            found.append(rows)
        except json.JSONDecodeError:
            i += 1
    return found


def last_json(out):
    """The last JSON array in duckdb's output: the init file's statements
    print their own result sets first, and DuckDB 2.0 may print warnings
    ahead of them, or even inside a result's opening bracket (a WARNING:
    block running to a blank line), so drop those and skip everything up
    to the final result."""
    out = re.sub(r"WARNING:.*?\n\s*\n", "", out, flags=re.S)
    dec, i, rows = json.JSONDecoder(), 0, None
    while (i := out.find("[", i)) >= 0:
        try:
            rows, i = dec.raw_decode(out, i)
        except json.JSONDecodeError:
            i += 1
    if rows is None and out:
        raise json.JSONDecodeError("no JSON array", out, 0)
    return rows or []


def sql_str(s):
    return "'" + s.replace("'", "''") + "'"


def sql_lit(v, typ):
    """v as a SQL literal of type typ."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)) and math.isfinite(v):
        return repr(v)
    return f"{sql_str(v if isinstance(v, str) else str(v))}::{typ}"


def temp_table(name, cols, rows, chunk=1000):
    """Statements making temp table name, columns cols ([(name, type)]),
    holding rows (tuples in cols' order), all as literals in the SQL.

    Through quack every statement runs on the database's host, so a
    read_csv() or read_json() of a local file reads that host's disk, not
    this one's. Sending the rows themselves works from anywhere."""
    out = [f"create or replace temp table {name} ("
           + ", ".join(f'"{c}" {t}' for c, t in cols) + ");"]
    for i in range(0, len(rows), chunk):
        out.append(f"insert into {name} values\n" + ",\n".join(
            "(" + ", ".join(sql_lit(v, t) for v, (_, t) in zip(r, cols)) + ")"
            for r in rows[i:i + chunk]) + ";")
    return "\n".join(out)


def stage_file(stage_dir, key, src):
    """Put src at stage_dir/key for upload(), as a hard link if it can."""
    dst = os.path.join(stage_dir, key)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.link(src, dst)  # rclone skips symlinks
    except OSError:
        shutil.copyfile(src, dst)
    return dst


def read_sql(name):
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name)) as fh:
        return fh.read()


def import_sql(env):
    """import.sql with run-stats.sql in place of its "-- @run-stats.sql"
    line, and each getenv('DWP_...') replaced by env's value as a literal:
    through quack, getenv() runs on the server, which doesn't have the
    importer's environment."""
    sql = read_sql("import.sql").replace("-- @run-stats.sql", read_sql("run-stats.sql"))
    sql = re.sub(r"getenv\('(DWP_\w+)'\)", lambda m: sql_str(env.get(m.group(1), "")), sql)
    # The filtered CSV goes in as rows too: read_csv_auto() would read the
    # database host's disk.
    csv_path = env.get("DWP_CSV")
    if csv_path:
        read = "FROM read_csv_auto(getvariable('csv_path'));"
        if read not in sql:
            raise PublishError("import.sql no longer reads csv_path the way import_sql expects")
        with open(csv_path, newline="") as fh:
            recs = list(csv.DictReader(fh))
        cols = [(c, "VARCHAR" if c == "time_utc" else "DOUBLE") for c in IMPORT_CSV_COLS]
        rows = [tuple((r.get(c) or None) for c in IMPORT_CSV_COLS) for r in recs]
        # Each point's nearest land, worked out here (nearest_land.py).
        import nearest_land  # only importers need it (and coastline.parquet)
        pos = [(float(r["lat_filtered"]) if r.get("lat_filtered") else None,
                float(r["lon_filtered"]) if r.get("lon_filtered") else None) for r in recs]
        near = nearest_land.nearest_land(pos)
        cols += [("nearest_land_lat", "DOUBLE"), ("nearest_land_lon", "DOUBLE")]
        rows = [row + near.get(p, (None, None)) for row, p in zip(rows, pos)]
        sql = sql.replace(read, "FROM activity_csv;")
        sql = temp_table("activity_csv", cols, rows) + "\n" + sql
    return sql


# The columns import.sql takes from gpx_filter.py's CSV.
IMPORT_CSV_COLS = ["time_utc", "lat_filtered", "lon_filtered", "hr",
                   "speed_final_kmh", "distance_cumulative_m"]


def run_stats_sql(dwids):
    """Statements recomputing the stats of runs dwids (run-stats.sql), to
    go inside a transaction on the database."""
    ids = ", ".join(f"({sql_str(d)}::uuid)" for d in dwids)
    return ("load spatial; set geometry_always_xy = false; "
            f"create temp table restat as select * from (values {ids}) v(dwid);\n"
            + read_sql("run-stats.sql"))


class Manifest:
    """What publish has put in S3: the database's publish_manifest table
    (schema.sql), so publish can run from any host."""

    SQL = "select key, sha256, size, headers, fingerprint, epoch(uploaded_at) as t from publish_manifest"

    @staticmethod
    def rows(rows):
        return {r["key"]: {"sha": r["sha256"], "size": r["size"], "headers": r["headers"],
                           "fp": r["fingerprint"], "uploaded_at": r["t"]} for r in rows}

    def all(self):
        return self.rows(duckdb(self.SQL + ";", json_out=True, what="read manifest"))

    def record(self, rows):
        """rows: (key, sha256, size, headers, fingerprint), in one transaction."""
        if not rows:
            return
        now = datetime.now(ZoneInfo("UTC")).isoformat()
        cols = [("key", "VARCHAR"), ("sha256", "VARCHAR"), ("size", "BIGINT"), ("headers", "VARCHAR"),
                ("fingerprint", "VARCHAR"), ("uploaded_at", "TIMESTAMPTZ")]
        duckdb(temp_table("recorded", cols, [r + (now,) for r in rows]) + f"""
            begin;
            delete from publish_manifest where key in (select key from recorded);
            insert into publish_manifest by name select * from recorded;
            commit;""", what=f"record {len(rows)} in manifest")

    def forget(self, keys):
        if not keys:
            return
        duckdb(temp_table("forgotten", [("key", "VARCHAR")], [(k,) for k in keys]) + f"""
            begin;
            delete from publish_manifest where key in (select key from forgotten);
            commit;""")


def fingerprint_rows(rows, name):
    """key -> (fingerprint, recent) from a fp_sql result."""
    out = {}
    for r in rows:
        if name == "tracks" and not RIDER.fullmatch(r["rider"] or ""):
            log(f"skipping {r['k']}: odd rider")
            continue
        out[r["k"]] = (r["fp"], bool(r["recent"]))
    return out


def digest(*parts):
    """A fingerprint of parts (strings, or lists of them, order ignored)."""
    h = hashlib.sha256()
    for p in parts:
        for x in (sorted(p) if isinstance(p, (list, set)) else [p]):
            h.update(str(x).encode() + b"\0")
    return h.hexdigest()[:32]


def heatmap_fingerprints(tracks, hub):
    """key -> (fingerprint, recent) for every heatmap (see the heatmap
    table), from the tracks' fingerprint rows of the runs it counts."""
    parts = {}
    for r in tracks:
        if not r["region"] or not RIDER.fullmatch(r["rider"] or ""):
            continue
        fp, region = f"{r['dwid']}:{r['fp']}", region_slug(r["region"])
        base = f"runs/rider={r['rider']}/heatmap"
        keys = [f"{base}/region={region}/data.csv", f"{base}/overview.csv"]
        if hub(r["rider"]):
            keys.append(f"heatmap/region={region}/data.csv")
        # The speed maps (heatmap/fastest/), from the same runs.
        keys += [k.replace("heatmap/", "heatmap/fastest/", 1) for k in keys]
        for k in keys:
            parts.setdefault(k, []).append(fp)
    return {k: (digest(fps), True) for k, fps in parts.items()}


def list_fingerprints(riders_rows, runs, tracks):
    """key -> fingerprint for every rider's lists and runs/riders.csv: the
    rider's runs (dwlist rows and tracks), and for together.csv and
    riders.csv everyone's runs and the riders table. A list also reads
    wind and buoy rows (export-lists.sql), but those don't change what it
    shows once the run is in; --all exports every list for the rare day
    they do."""
    riders_fp = digest([json.dumps(r, sort_keys=True) for r in riders_rows])
    all_runs = digest([r["h"] for r in runs])
    by_rider, tracks_by_rider = {}, {}
    for r in runs:
        by_rider.setdefault(r["rider"], []).append(r["h"])
    for r in tracks:
        tracks_by_rider.setdefault(r["rider"], []).append(f"{r['dwid']}:{r['fp']}")
    out = {"runs/riders.csv": digest(riders_fp, all_runs)}
    for rider, hs in by_rider.items():
        if not RIDER.fullmatch(rider):
            continue
        own = digest(hs, tracks_by_rider.get(rider, []))
        for n in LISTS:
            out[f"runs/rider={rider}/{n}.csv"] = digest(all_runs, riders_fp) if n == "together" else own
    return out


def gather(cutoff):
    """Everything a publish reads before exporting, in one duckdb process:
    the manifest (keys of site-days before cutoff left out), the local
    cam images, the riders and dwlist, and every table's
    fingerprints (the heatmaps' and lists' made here from the rest)."""
    q = {
        "manifest": Manifest.SQL + (
            f" where coalesce(nullif(regexp_extract(key, '/day=([0-9-]+)/', 1), ''), '9999') >= '{cutoff}'"
            if cutoff else ""),
        "manifest_count": "select count(*) as n from publish_manifest",
        "images": "select key, file from cam_images where file is not null",
        "riders": "select rider, name, hub, versus, compare, together from riders order by rider",
        "runs": """select l.rider, l.id::varchar as id, l.date::varchar as date, hash(l)::varchar as h,
                          b.region as region
                   from dwlist l left join beaches b on b.id = l.start_pos
                   where l.rider is not null""",
    }
    for t in TABLES:
        if (sql := t.fp_sql(cutoff)) is not None:
            q["fp " + t.name] = sql
    got = queries(q, what=f"manifest, {len(q) - 5} fingerprints")
    fps = {t.name: fingerprint_rows(got["fp " + t.name], t.name) for t in TABLES if "fp " + t.name in got}
    riders_rows = got["riders"]
    hub_of = {r["rider"]: r["hub"] for r in riders_rows}

    def hub(rider):
        return hub_of.get(rider) is not False

    fps["heatmap"] = heatmap_fingerprints(got["fp tracks"], hub)
    lists = list_fingerprints(riders_rows, got["runs"], got["fp tracks"])
    return (Manifest.rows(got["manifest"]), got["manifest_count"][0]["n"],
            {r["key"]: r["file"] for r in got["images"]}, fps, lists)


def fingerprints(t):
    """key -> (fingerprint, recent) for every object t makes (orphans)."""
    if t.fp_sql(None) is None:  # the heatmaps: every key gather() would make
        tracks = duckdb(TABLES[0].fp_sql(None) + ";", json_out=True, what="fingerprint tracks")
        hub_of = {r["rider"]: r["hub"] for r in duckdb("select rider, hub from riders;", json_out=True)}
        return heatmap_fingerprints(tracks, lambda rider: hub_of.get(rider) is not False)
    return fingerprint_rows(duckdb(t.fp_sql(None) + ";", json_out=True, what=f"fingerprint {t.name}"), t.name)


def to_csv(path):
    """CLI commands sending the next query's result to the local file path
    as CSV (header, NULL as empty), like COPY ... TO (format csv) would.
    Through quack, COPY writes on the database's host; the CLI's .output is
    this one. End the query with CSV_END."""
    if '"' in path or "\n" in path:
        die(f"odd export path {path!r}")
    return f'.mode csv\n.separator "," "\\n"\n.headers on\n.nullvalue ""\n.output "{path}"\n'


CSV_END = "\n.output\n.mode duckbox\n"


def export_sql(t, keys, big):
    """CLI script writing the rows of keys to the file big, one sorted
    file for all of them (a partitioned COPY doesn't keep the order
    within each file); split() then cuts it up by key."""
    dirty = f"dirty_{t.name}"
    return (temp_table(dirty, [("k", "VARCHAR")], [(k,) for k in keys]) + "\n" + to_csv(big) + f"""
            select * exclude (__h) from (
                select {t.key} as __k, {t.cols}, hash(x) as __h
                from {t.frm}
                {t.filter(keys)}
            ) where __k in (select k from {dirty})
            order by __k, {t.order}, __h;""" + CSV_END)


def split(big, tmp):
    """Split big by its first column, a key with no commas or quotes, into
    tmp/<key> without that column."""
    out, cur = None, None
    with open(big, newline="") as f:
        header = f.readline().partition(",")[2]
        for line in f:
            key, _, rest = line.partition(",")
            if key != cur:
                if out:
                    out.close()
                cur = key
                path = os.path.join(tmp, key)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                out = open(path, "w", newline="")
                out.write(header)
            out.write(rest)
    if out:
        out.close()
    size = os.path.getsize(big)
    os.unlink(big)
    return size


def lists_sql_parts():
    """export-lists.sql as (preamble, {list name: its statements}): each
    list sits between .output "dwlists/<name>.csv" and a bare .output."""
    sql = read_sql("export-lists.sql")
    mark = f'.output "{LISTS_DIR}'
    if mark not in sql:
        die(f"export-lists.sql no longer writes to {LISTS_DIR}")
    pre, *chunks = sql.split(mark)
    parts = {}
    for c in chunks:
        name, _, body = c.partition('.csv"\n')
        body, sep, _ = body.rpartition("\n.output")
        if not sep:
            die(f"export-lists.sql: no .output after {name}")
        parts[name] = body
    if set(parts) != set(LISTS):
        die(f"export-lists.sql makes {sorted(parts)}, not {LISTS}")
    return pre, parts


def lists_sql(wanted, outdir):
    """CLI script exporting the lists wanted ({rider: [names]}) to
    outdir/<rider>/<name>.csv."""
    pre, parts = lists_sql_parts()
    out = []
    for rider, names in wanted.items():
        d = os.path.join(outdir, rider)
        os.makedirs(d, exist_ok=True)
        if '"' in d or "\n" in d:
            die(f"odd export path {d!r}")
        out.append(f"set variable rider = {sql_str(rider)};\n")
        if len(out) == 1:
            out.append(pre)  # its rider check wants the variable set first
        for n in names:
            out.append(f'.output "{d}/{n}.csv"\n{parts[n]}\n.output\n')
    return "".join(out)


def export_lists(rider, outdir):
    """All of one rider's lists to outdir/<name>.csv (the bot's achievements
    read runs.csv this way)."""
    pre, parts = lists_sql_parts()
    os.makedirs(outdir, exist_ok=True)
    if '"' in outdir or "\n" in outdir:
        die(f"odd export path {outdir!r}")
    duckdb(f"set variable rider = {sql_str(rider)};\n" + pre
           + "".join(f'.output "{outdir.rstrip("/")}/{n}.csv"\n{parts[n]}\n.output\n' for n in LISTS),
           what=f"export lists for {rider}")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def stage(src, stage_dir, key):
    """gzip src to stage_dir/key, the same bytes every time (no name or
    mtime in the header); return the gzipped size."""
    dst = os.path.join(stage_dir, key)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(src, "rb") as i, open(dst, "wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", compresslevel=9, fileobj=raw, mtime=0) as o:
            for chunk in iter(lambda: i.read(1 << 20), b""):
                o.write(chunk)
    os.unlink(src)
    return os.path.getsize(dst)


def upload(stage_dir, keys, headers, dry_run):
    """PUT exactly these keys: no listing of the bucket, no HEAD per object."""
    if not keys:
        return
    if dry_run:
        for k in keys:
            log(f"would upload {k}")
        return
    lst = os.path.join(stage_dir, ".files")
    with open(lst, "w") as f:
        f.write("".join(k + "\n" for k in keys))
    args = ["rclone", "copy", stage_dir, DEST, "--files-from-raw", lst,
            "--no-traverse", "--no-check-dest"]
    for h in headers:
        args += ["--header-upload", h]
    t0 = time.monotonic()
    r = subprocess.run(args)
    note(f"rclone copy {len(keys)} ({sum(os.path.getsize(os.path.join(stage_dir, k)) for k in keys) >> 10} KB)", t0)
    os.unlink(lst)
    if r.returncode != 0:
        die(f"rclone failed (exit {r.returncode}); this batch isn't recorded, so rerun to retry")


def list_bucket():
    """key -> size for every object under the prefixes publish writes: one
    paginated LIST per prefix, no per-object requests."""
    out = {}
    for prefix in ["runs", "cams"] + [t.name for t in TABLES if t.name != "tracks"]:
        r = subprocess.run(["rclone", "lsjson", "-R", "--files-only", "--fast-list",
                            "--no-modtime", "--no-mimetype", DEST + prefix + "/"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            if "directory not found" in r.stderr:
                continue
            die(f"rclone lsjson failed:\n{r.stderr}")
        for o in json.loads(r.stdout or "[]"):
            out[f"{prefix}/{o['Path']}"] = o["Size"]
    return out


def riders_sql(path):
    """CLI script writing runs/riders.csv to path: every rider with runs,
    oldest first, with their riders row (blank where they have none)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return to_csv(path) + """
  select d.rider, r.name, r.hub, r.versus, r.compare, r.together
  from (select rider, min(ts) as first_ts from dwlist where rider is not null group by rider) d
  left join riders r using (rider)
  order by d.first_ts;""" + CSV_END


def riders():
    return sorted(r["rider"] for r in duckdb(
        "select distinct rider from dwlist where rider is not null;", json_out=True, what="riders")
        if RIDER.fullmatch(r["rider"]))


def publish(manifest, dry_run=False, everything=False):
    try:
        _publish(manifest, dry_run, everything)
    finally:
        report_timings(time.monotonic() - STARTED)


def _publish(manifest, dry_run, everything):
    today = datetime.now(ZoneInfo("Pacific/Honolulu")).date()
    cutoff = None if everything else (today - timedelta(days=DAYS)).isoformat()
    PHASE[0] = "fingerprints"
    have, total, images, fps, list_fps = gather(cutoff)
    seed = not total
    if seed:
        log("no manifest yet: adopting what's already in the bucket")
        if cutoff:
            everything, cutoff = True, None
            have, total, images, fps, list_fps = gather(cutoff)
    in_s3 = list_bucket() if seed else {}

    # key -> (fingerprint, headers, adopt): what to export this time.
    todo = {}
    for t in TABLES:
        dirty = {}
        for k, (fp, recent) in fps[t.name].items():
            hdr = t.headers(k, today)
            old = have.get(k)
            if seed or not old or old["fp"] != fp or old["headers"] != json.dumps(hdr):
                dirty[k] = (fp, hdr, seed and k in in_s3 and not recent)
        log(f"{t.name}: {len(fps[t.name])} in the database, {len(dirty)} to export")
        todo[t] = dirty
    wanted = {}  # rider -> list names to export
    for k, fp in list_fps.items():
        old = have.get(k)
        if everything or not old or old["fp"] != fp or old["headers"] != json.dumps(SHORT):
            m = re.fullmatch(r"runs/rider=([^/]+)/(\w+)\.csv", k)
            if m:
                wanted.setdefault(m.group(1), []).append(m.group(2))
            else:
                wanted[""] = ["riders"]
    log(f"lists: {len(list_fps)} in the database, {sum(map(len, wanted.values()))} to export")

    with tempfile.TemporaryDirectory(prefix="dwp-publish-") as tmp:
        raw, stage_dir = os.path.join(tmp, "raw"), os.path.join(tmp, "stage")
        os.makedirs(raw)
        os.makedirs(stage_dir)

        # One duckdb process exports every table's dirty keys and every
        # wanted list.
        PHASE[0] = "export"
        script, files, lists, bigs = [], [], [], []
        for t, dirty in todo.items():
            if dirty:
                big = os.path.join(tmp, t.name + ".csv")
                script.append(export_sql(t, list(dirty), big))
                bigs.append((t, big))
            files += [(k, os.path.join(raw, k), fp, hdr, adopt) for k, (fp, hdr, adopt) in dirty.items()]
        lists_dir = os.path.join(raw, "lists")
        if riders_lists := {r: ns for r, ns in wanted.items() if r}:
            script.append(lists_sql(riders_lists, lists_dir))
            lists += [(f"runs/rider={r}/{n}.csv", os.path.join(lists_dir, r, n + ".csv"), list_fps[f"runs/rider={r}/{n}.csv"], SHORT, False)
                      for r, ns in riders_lists.items() for n in ns]
        if "" in wanted:
            path = os.path.join(lists_dir, "riders.csv")
            script.append(riders_sql(path))
            lists.append(("runs/riders.csv", path, list_fps["runs/riders.csv"], SHORT, False))
        if script:
            duckdb("\n".join(script), what=f"export {len(files)} files, {len(lists)} lists")
        for t, big in bigs:
            t0 = time.monotonic()
            size = split(big, raw)
            note(f"split {t.name} ({size >> 10} KB)", t0)

        # Images first: the cam_images files point at them. They never
        # change, so one in the manifest is done.
        new, record = [], []
        PHASE[0] = "cam images"
        for k, src in sorted(images.items()):
            if k in have:
                continue
            if not os.path.exists(src):
                log(f"skipping {k}: no {src} here")
            elif k in in_s3:
                record.append((k, sha256(src), in_s3[k], json.dumps(IMAGE), None))
            else:
                dst = stage_file(stage_dir, k, src)
                new.append(k)
                record.append((k, sha256(dst), os.path.getsize(dst), json.dumps(IMAGE), None))
        if images:
            log(f"{len(images)} cam images, {len(new)} to upload")
        upload(stage_dir, new, IMAGE, dry_run)

        invalidate = []
        # Tracks and conditions first, then the lists that point at tracks;
        # all recorded together once everything is up.
        for batch in (files, lists):
            PHASE[0] = "upload lists" if batch is lists else "upload files"
            by_headers = {}
            t0 = time.monotonic()
            for key, path, fp, hdr, adopt in batch:
                if not os.path.exists(path):
                    log(f"nothing exported for {key} (no rows)")
                    continue
                sha, hjson, old = sha256(path), json.dumps(hdr), have.get(key)
                if adopt:  # first publish: S3's copy stands
                    record.append((key, sha, in_s3[key], hjson, fp))
                    os.unlink(path)
                elif old and old["sha"] == sha and old["headers"] == hjson:
                    record.append((key, sha, old["size"], hjson, fp))  # only the fingerprint moved
                    os.unlink(path)
                else:
                    size = stage(path, stage_dir, key)
                    by_headers.setdefault(hjson, []).append(key)
                    record.append((key, sha, size, hjson, fp))
                    if old and old["headers"] == hjson and hdr == LONG:
                        invalidate.append(key)
            n = sum(len(v) for v in by_headers.values())
            note(f"sha256 {len(batch)}, gzip {n}", t0)
            log(f"{len(batch)} {'lists' if batch is lists else 'files'} exported, {n} to upload")
            for hjson, keys in by_headers.items():
                upload(stage_dir, keys, json.loads(hjson), dry_run)
        PHASE[0] = "manifest"
        if not dry_run:
            manifest.record(record)
            prune_images(images, have)

    if invalidate:
        log(f"{len(invalidate)} long-cached objects changed; invalidate them in CloudFront:")
        for k in invalidate:
            print("/" + k)


def verify(manifest, fix):
    have = manifest.all()
    in_s3 = list_bucket()
    bad = []
    for k, v in sorted(have.items()):
        if k not in in_s3:
            print(f"missing from S3: {k}")
            bad.append(k)
        elif in_s3[k] != v["size"]:
            print(f"size differs: {k} (S3 {in_s3[k]}, manifest {v['size']})")
            bad.append(k)
    extra = len(set(in_s3) - set(have))
    log(f"{len(have)} objects in the manifest, {len(in_s3)} in S3 "
        f"({extra} publish didn't write), {len(bad)} wrong")
    if bad and fix:
        manifest.forget(bad)
        log("forgot them; publishing to put them back")
        publish(manifest)
        return 0
    return 1 if bad else 0


def orphans(manifest, delete=False, force=False, dry_run=False):
    bucket = DEST.split(":")[-1].strip("/").split("/")[0]
    prefixes = tuple(p + "/" for p in ["runs"] + [t.name for t in TABLES if t.name != "tracks"])
    inventory = set()
    for r in duckdb(f"select filename from s3.latest_files where bucket = {sql_str(bucket)};",
                    json_out=True):
        k = r["filename"].removeprefix(f"s3://{bucket}/").lstrip("/")
        if k.startswith(prefixes):
            inventory.add(k)

    expected = {f"runs/rider={r}/{n}.csv" for r in riders() for n in LISTS} | {"runs/riders.csv"}
    for t in TABLES:
        expected |= set(fingerprints(t))
    orphaned = sorted(inventory - expected)
    for k in orphaned:
        print(f"orphan: {k}")

    cutoff = time.time() - 2 * 86400
    missing = sorted(k for k, v in manifest.all().items()
                     if v["uploaded_at"] < cutoff and k not in inventory)
    for k in missing:
        print(f"not in inventory: {k}")
    log(f"{len(inventory)} objects in the inventory, {len(orphaned)} orphaned, "
        f"{len(missing)} uploaded over two days ago but missing")
    if delete and orphaned:
        if len(orphaned) > 0.05 * len(inventory) and not force:
            die(f"not deleting: {len(orphaned)} orphans is over 5% of the bucket; "
                "check the list, then rerun with --force")
        remove(orphaned, dry_run)
        if not dry_run:
            manifest.forget(orphaned)
    return 1 if missing else 0


def remove(keys, dry_run):
    """Delete exactly these keys from S3, without listing the bucket."""
    if dry_run:
        for k in keys:
            log(f"would delete {k}")
        return
    with tempfile.NamedTemporaryFile("w", prefix="dwp-orphans-") as f:
        f.write("".join(k + "\n" for k in keys))
        f.flush()
        r = subprocess.run(["rclone", "delete", DEST, "--files-from-raw", f.name, "--no-traverse"])
    if r.returncode != 0:
        die(f"rclone delete failed (exit {r.returncode})")
    log(f"deleted {len(keys)} orphans")


def prune_images(images, have):
    """Delete local cam images an earlier publish put in S3 (so they're in
    the manifest) once they're over IMAGE_KEEP_DAYS old. One that never made
    it to S3 stays, however old."""
    cutoff = time.time() - IMAGE_KEEP_DAYS * 86400
    gone = 0
    for k, src in images.items():
        try:
            if k in have and os.path.getmtime(src) < cutoff:
                os.unlink(src)
                gone += 1
        except FileNotFoundError:
            pass
    if gone:
        log(f"pruned {gone} uploaded cam images over {IMAGE_KEEP_DAYS:g} days old")


def locked():
    """Hold this host's publish lock, so add-run, the bot, drive-sync and
    the conditions job don't run two publishes here at once. Publishes on
    different hosts can overlap; that only costs a duplicate upload or a
    file a cycle stale, which the next publish's fingerprints catch."""
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    lock = open(LOCK, "w")
    fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


def request(argv=(), host=None):
    """Have publishd run ./publish with argv (on broker host, default
    DWP_MQTT or mqtt) and wait for it: (exit code, its output)."""
    import dwp_mqtt
    host = host or MQTT
    rid = f"{socket.gethostname()}-{time.time_ns()}"
    reply = f"{REPLY_TOPIC}/{rid}"
    try:
        with dwp_mqtt.Client(host, [reply], name="dwp-publish") as c:
            c.send(REQUEST_TOPIC, json.dumps({"id": rid, "from": socket.gethostname(), "args": list(argv)}))
            log(f"asked publishd on {host} ({rid}); waiting")
            for _, payload in c.messages(REQUEST_WAIT):
                r = json.loads(payload)
                return int(r.get("code", 0 if r.get("ok") else 1)), r.get("output") or ""
    except (OSError, ConnectionError, ValueError) as e:
        die(f"couldn't reach publishd on {host}: {e} (./publish --local runs it here)")
    die(f"no answer from publishd on {host} in {REQUEST_WAIT // 60} minutes")


def run(dry_run=False):
    """Publish whatever changed, through publishd; raises PublishError if
    it fails."""
    if LOCAL:
        with locked():
            publish(Manifest(), dry_run=dry_run)
        return
    code, out = request(["--dry-run"] if dry_run else [])
    sys.stderr.write(out)
    if code != 0:
        lines = [l for l in out.splitlines() if l.startswith("publish:")]
        die(lines[-1].removeprefix("publish: ") if lines else f"publishd: exit {code}")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="publish", choices=["publish", "verify", "orphans"])
    ap.add_argument("--dry-run", action="store_true", help="upload nothing, record nothing")
    ap.add_argument("--all", action="store_true",
                    help=f"check every conditions day and every list, not the last {DAYS} days' "
                         "(for a backfill, or a nightly pass)")
    ap.add_argument("--fix", action="store_true", help="verify: re-upload what's wrong")
    ap.add_argument("--delete", action="store_true", help="orphans: delete them from S3")
    ap.add_argument("--force", action="store_true", help="orphans --delete: even over 5%% of the bucket")
    ap.add_argument("--local", action="store_true",
                    help="run here instead of asking publishd (for when it's down)")
    args = ap.parse_args(argv)

    try:
        if not (LOCAL or args.local):
            code, out = request([a for a in argv if a != "--local"])
            sys.stdout.write(out)
            return code
        with locked():
            m = Manifest()
            if args.command == "publish":
                publish(m, dry_run=args.dry_run, everything=args.all)
                return 0
            if args.command == "verify":
                return verify(m, args.fix)
            return orphans(m, args.delete, args.force, args.dry_run)
    except PublishError as e:
        log(str(e))
        return 1
