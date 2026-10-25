"""Publish runs and conditions to the CDN, uploading only what changed.

    ./publish             export and upload whatever changed
    ./publish --dry-run   say what would be uploaded; upload and record nothing
    ./publish verify      check the bucket against the manifest
    ./publish verify --fix   ...and re-upload whatever is missing or wrong
    ./publish orphans     list objects the lake no longer makes (from the S3
                          inventory in the lake, so about a day behind)
    ./publish orphans --delete   ...and delete them from S3

Everything under s3:db.downwind.pro/ that comes from the lake goes through
here: each run's track and each rider's lists under runs/, and one file per
site and day under wind/, swell/, swell_partition/ and swell_spectrum/.

Cam readings and images (cam_motion and cam_images, which cam-ingest
fills) publish per site and day like the conditions, under cam_motion/ and
cam_images/. Before them, every image cam_images lists that the manifest
doesn't have goes to S3 at its key from the local file it names, once,
cached a year (images never change). Once an image has been in S3 since an
earlier publish and its local copy is over 14 days old (DWP_IMAGE_KEEP_DAYS),
publish deletes the local copy. Wind forecasts (wind_forecast, from
forecast-ingest) publish the same way under wind_forecast/. publish only
reads the lake.

A local manifest (--manifest, default ~/stuff/dwp-manifest.sqlite) records,
for every object it has put in S3, the sha256 of its uncompressed CSV, its
gzipped size, the headers it was uploaded with, and a fingerprint of the lake
rows it was made from (row count and the sum of the rows' hashes). A publish:

  1. fingerprints every track and every site-day in one query per table, and
     picks the ones whose fingerprint differs from the manifest's: new runs,
     re-imported or edited ones, the day the last ingest added to, a day a
     backfill rewrote;
  2. exports just those, plus every rider's four lists and riders.csv
     (small, and the lists depend on wind and buoy data as well as runs),
     into a temp dir;
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
lists objects under publish's prefixes that no run or site-day in the lake
makes any more, such as the old track of a re-imported run. --delete
removes them from S3 (and the manifest), but refuses if they're over 5% of
the inventory, which smells like a lake read gone wrong rather than real
orphans; --force overrides that. It also lists objects the manifest says were uploaded over two days
ago that the inventory doesn't have, a check verify --fix can then repair.

Run it as ./publish from db's nix dev shell (python3, duckdb, rclone), like
add-run. Python in db/ imports this module and calls publish.run() instead.
"""

import argparse
import fcntl
import gzip
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

DB_DIR = os.path.dirname(os.path.abspath(__file__))
LAKE_DIR = os.environ.get("LAKE") or os.path.expanduser("~/stuff/duck")
MANIFEST = os.environ.get("DWP_MANIFEST") or os.path.expanduser("~/stuff/dwp-manifest.sqlite")
DEST = (os.environ.get("DWP_DEST") or "s3:db.downwind.pro").rstrip("/") + "/"
RIDER = re.compile(r"[a-z][a-z0-9-]*")
LISTS = ["runs", "crashes", "run_buoy", "together"]
# export-lists.sql writes here; publish points it at its temp dir instead.
LISTS_DIR = "/Users/dustin/stuff/dwlists/"

GZ_CSV = ["Content-Encoding: gzip", "Content-Type: text/csv; charset=utf-8"]
SHORT = GZ_CSV + ["Cache-Control: public, max-age=300"]
LONG = GZ_CSV + ["Cache-Control: public, max-age=31536000"]
IMAGE = ["Content-Type: image/jpeg", "Cache-Control: public, max-age=31536000, immutable"]
# Local cam images already in S3 are deleted once this old (DWP_IMAGE_KEEP_DAYS).
IMAGE_KEEP_DAYS = float(os.environ.get("DWP_IMAGE_KEEP_DAYS") or 14)


class Table:
    """One lake table published as one CSV per key.

    frm is the FROM clause, with the table's rows as x. key names each row's
    object; cols is what goes in the file; order (columns of cols) sorts it,
    ties broken by the row's hash so the bytes don't change between exports;
    recent marks keys the first publish re-sends instead of adopting S3's copy.
    """

    def __init__(self, name, frm, key, cols, order, recent, day=None):
        self.name, self.frm, self.key, self.cols = name, frm, key, cols
        self.order, self.recent, self.day = order, recent, day

    def headers(self, key, today):
        if self.day is None:
            return GZ_CSV
        day = re.search(r"/day=([0-9-]+)/", key).group(1)
        return SHORT if day >= (today - timedelta(days=1)).isoformat() else LONG


def conditions(table, day="x.day", cols="x.* exclude (site, day)", order="ts"):
    return Table(table, f"{table} x",
                 f"'{table}/site=' || x.site || '/day=' || ({day})::date || '/data.csv'",
                 cols, order,
                 f"max({day})::date > (current_timestamp at time zone 'Pacific/Honolulu')::date - 14",
                 day=day)


TABLES = [
    Table("tracks",
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
]


def log(msg):
    print(f"publish: {msg}", file=sys.stderr, flush=True)


class PublishError(Exception):
    pass


def die(msg):
    raise PublishError(msg)


# The tracks export's ST_Point(lat, lon) is the pre-2.0 axis order, which
# DuckDB 2.0 makes ST_Distance_Sphere ask for.
XY = "load spatial;\nset geometry_always_xy = false;\n"


def duckdb(sql, json_out=False, cmd=None):
    """Run sql against the lake; with json_out, return the result's rows."""
    args = ["duckdb", "-bail", "--init", "quack-init.sql"]
    if json_out:
        args.append("-json")
    if cmd:
        args += ["-cmd", cmd]
    r = subprocess.run(args, cwd=LAKE_DIR, input="use lake;\n" + XY + sql,
                       capture_output=True, text=True)
    if r.returncode != 0 or "Error:" in r.stderr:
        die(f"duckdb failed:\n{r.stderr}")
    if not json_out:
        return None
    out = r.stdout.strip()
    try:
        return last_json(out)
    except json.JSONDecodeError:
        die(f"duckdb printed something other than JSON:\n{out[:2000]}\n--- stderr:\n{r.stderr[:2000]}")


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


def read_sql(name):
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name)) as fh:
        return fh.read()


def import_sql(env):
    """import.sql with run-stats.sql in place of its "-- @run-stats.sql"
    line, and each getenv('DWP_...') replaced by env's value as a literal:
    through quack, getenv() runs on the server, which doesn't have the
    importer's environment."""
    sql = read_sql("import.sql").replace("-- @run-stats.sql", read_sql("run-stats.sql"))
    return re.sub(r"getenv\('(DWP_\w+)'\)", lambda m: sql_str(env.get(m.group(1), "")), sql)


def run_stats_sql(dwids):
    """Statements recomputing the stats of runs dwids (run-stats.sql), to
    go inside a transaction on the lake."""
    ids = ", ".join(f"({sql_str(d)}::uuid)" for d in dwids)
    return ("load spatial; set geometry_always_xy = false; "
            f"create temp table restat as select * from (values {ids}) v(dwid);\n"
            + read_sql("run-stats.sql"))


class Manifest:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute("""create table if not exists objects (
            key text primary key,      -- path under the bucket
            sha256 text not null,      -- of the uncompressed CSV
            size integer not null,     -- of the object in S3
            headers text not null,     -- JSON list it was uploaded with
            fingerprint text,          -- of the lake rows; null for lists
            uploaded_at real not null)""")
        self.db.commit()

    def all(self):
        return {k: {"sha": s, "size": z, "headers": h, "fp": f, "uploaded_at": u}
                for k, s, z, h, f, u in self.db.execute(
                    "select key, sha256, size, headers, fingerprint, uploaded_at from objects")}

    def record(self, rows):
        """rows: (key, sha256, size, headers, fingerprint), in one transaction."""
        now = time.time()
        with self.db:
            self.db.executemany("insert or replace into objects values (?, ?, ?, ?, ?, ?)",
                                [r + (now,) for r in rows])

    def forget(self, keys):
        with self.db:
            self.db.executemany("delete from objects where key = ?", [(k,) for k in keys])


def has_table(name):
    return bool(duckdb("select 1 from information_schema.tables where table_catalog = 'lake' "
                       f"and table_name = {sql_str(name)};", json_out=True))


def fingerprints(t):
    """key -> (fingerprint, recent) for every object t makes."""
    if t.name.startswith("cam_") and not has_table(t.name):
        return {}  # cam-ingest hasn't run on this lake yet
    rows = duckdb(f"""
        select {t.key} as k,
               count(*)::varchar || ':' || sum(hash(x))::varchar as fp,
               {t.recent} as recent
        from {t.frm}
        group by all;
    """, json_out=True)
    out = {}
    for r in rows:
        if t.name == "tracks" and not RIDER.fullmatch(r["k"].split("/")[1][len("rider="):]):
            log(f"skipping {r['k']}: odd rider")
            continue
        out[r["k"]] = (r["fp"], bool(r["recent"]))
    return out


def export(t, keys, tmp):
    """Write tmp/<key> (uncompressed) for each of keys, in one pass over t."""
    if not keys:
        return
    dirty, big = os.path.join(tmp, t.name + ".keys"), os.path.join(tmp, t.name + ".csv")
    with open(dirty, "w") as f:
        f.write("k\n" + "".join(k + "\n" for k in keys))
    # One sorted file for all of them, then split by its first column: a
    # partitioned COPY doesn't keep the order within each file.
    duckdb(f"""
        create temp table dirty as
            select * from read_csv({sql_str(dirty)}, header = true, columns = {{'k': 'VARCHAR'}});
        copy (
            select * exclude (__h) from (
                select {t.key} as __k, {t.cols}, hash(x) as __h
                from {t.frm}
            ) where __k in (select k from dirty)
            order by __k, {t.order}, __h
        ) to {sql_str(big)} (format csv, header true);
    """)
    split(big, tmp)


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
    os.unlink(big)


def export_lists(rider, outdir):
    with open(os.path.join(DB_DIR, "export-lists.sql")) as f:
        sql = f.read()
    if LISTS_DIR not in sql:
        die(f"export-lists.sql no longer writes to {LISTS_DIR}")
    os.makedirs(outdir, exist_ok=True)
    duckdb(sql.replace(LISTS_DIR, outdir.rstrip("/") + "/"),
           cmd=f"set variable rider = {sql_str(rider)};")


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
    r = subprocess.run(args)
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


def export_riders(path):
    """runs/riders.csv: every rider with runs, oldest first, with their
    riders row (blank where they have none)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    duckdb(f"""copy (
  select d.rider, r.name, r.hub, r.versus, r.compare, r.together
  from (select rider, min(ts) as first_ts from dwlist where rider is not null group by rider) d
  left join riders r using (rider)
  order by d.first_ts
) to {sql_str(path)};""")


def riders():
    return sorted(r["rider"] for r in duckdb(
        "select distinct rider from dwlist where rider is not null;", json_out=True)
        if RIDER.fullmatch(r["rider"]))


def publish(manifest, dry_run=False):
    have = manifest.all()
    seed = not have
    if seed:
        log("no manifest yet: adopting what's already in the bucket")
    in_s3 = list_bucket() if seed else {}
    today = datetime.now(ZoneInfo("Pacific/Honolulu")).date()
    images = {r["key"]: r["file"] for r in duckdb(
        "select key, file from cam_images;", json_out=True)} if has_table("cam_images") else {}

    # key -> (fingerprint, headers, adopt): what to export this time.
    todo = {}
    for t in TABLES:
        fps = fingerprints(t)
        dirty = {}
        for k, (fp, recent) in fps.items():
            hdr = t.headers(k, today)
            old = have.get(k)
            if seed or not old or old["fp"] != fp or old["headers"] != json.dumps(hdr):
                dirty[k] = (fp, hdr, seed and k in in_s3 and not recent)
        log(f"{t.name}: {len(fps)} in the lake, {len(dirty)} to export")
        todo[t] = dirty

    with tempfile.TemporaryDirectory(prefix="dwp-publish-") as tmp:
        raw, stage_dir = os.path.join(tmp, "raw"), os.path.join(tmp, "stage")
        os.makedirs(raw)
        os.makedirs(stage_dir)

        files = []  # (key, path, fingerprint, headers, adopt)
        for t, dirty in todo.items():
            export(t, list(dirty), raw)
            files += [(k, os.path.join(raw, k), fp, hdr, adopt)
                      for k, (fp, hdr, adopt) in dirty.items()]
        lists = []
        for rider in riders():
            d = os.path.join(raw, "lists", rider)
            export_lists(rider, d)
            lists += [(f"runs/rider={rider}/{n}.csv", os.path.join(d, n + ".csv"), None, SHORT, False)
                      for n in LISTS]
        export_riders(os.path.join(raw, "lists", "riders.csv"))
        lists.append(("runs/riders.csv", os.path.join(raw, "lists", "riders.csv"), None, SHORT, False))

        # Images first: the cam_images files point at them. They never
        # change, so one in the manifest is done.
        new, record = [], []
        for k, src in sorted(images.items()):
            if k in have:
                continue
            if not os.path.exists(src):
                log(f"skipping {k}: no {src} here")
            elif k in in_s3:
                record.append((k, sha256(src), in_s3[k], json.dumps(IMAGE), None))
            else:
                dst = os.path.join(stage_dir, k)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                try:
                    os.link(src, dst)  # rclone skips symlinks
                except OSError:
                    shutil.copyfile(src, dst)
                new.append(k)
                record.append((k, sha256(dst), os.path.getsize(dst), json.dumps(IMAGE), None))
        log(f"{len(images)} cam images, {len(new)} to upload")
        upload(stage_dir, new, IMAGE, dry_run)
        if not dry_run:
            manifest.record(record)
            prune_images(images, have)

        invalidate = []
        # Tracks and conditions first, then the lists that point at tracks.
        for batch in (files, lists):
            by_headers, record = {}, []
            for key, path, fp, hdr, adopt in batch:
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
            log(f"{len(batch)} {'lists' if batch is lists else 'files'} exported, {n} to upload")
            for hjson, keys in by_headers.items():
                upload(stage_dir, keys, json.loads(hjson), dry_run)
            if not dry_run:
                manifest.record(record)

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


def locked(path):
    """Hold the publish lock, so add-run, the bot, drive-sync and the
    conditions job don't race on the manifest."""
    lock = open(path + ".lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


def run(dry_run=False, manifest=MANIFEST):
    """Publish whatever changed; raises PublishError if anything fails."""
    with locked(manifest):
        publish(Manifest(manifest), dry_run=dry_run)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="publish", choices=["publish", "verify", "orphans"])
    ap.add_argument("--dry-run", action="store_true", help="upload nothing, record nothing")
    ap.add_argument("--fix", action="store_true", help="verify: re-upload what's wrong")
    ap.add_argument("--delete", action="store_true", help="orphans: delete them from S3")
    ap.add_argument("--force", action="store_true", help="orphans --delete: even over 5%% of the bucket")
    ap.add_argument("--manifest", default=MANIFEST)
    args = ap.parse_args(argv)

    try:
        if args.command == "publish":
            run(args.dry_run, args.manifest)
            return 0
        with locked(args.manifest):
            m = Manifest(args.manifest)
            if args.command == "verify":
                return verify(m, args.fix)
            return orphans(m, args.delete, args.force, args.dry_run)
    except PublishError as e:
        log(str(e))
        return 1
