"""Shared by matrix-bot and its modules: running db/ commands, querying
the database, and the run summaries the bot replies with.

Only the Python standard library, like db/.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from zoneinfo import ZoneInfo

BOT_DIR = os.path.dirname(os.path.realpath(__file__))
DB_DIR = os.path.join(os.path.dirname(BOT_DIR), "db")  # add-run, publish, drive-sync
sys.dont_write_bytecode = True
sys.path.insert(0, DB_DIR)  # dwp_publish, shared with publish and add-run
import dwp_publish  # noqa: E402

DB_DIR = os.environ.get("DWP_DB") or os.path.expanduser("~/.config/duckq/dwp")


def log(msg):
    print(f"{time.strftime('%F %T')} {msg}", file=sys.stderr, flush=True)


def run(cmd, env=None, cwd=DB_DIR):
    """Run cmd (in db/ by default); (ok, combined output)."""
    log("+ " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, text=True)
    sys.stderr.write(r.stdout)
    return r.returncode == 0, r.stdout


def query(sql):
    """Rows of a query against the database, as dicts."""
    r = subprocess.run(["duckdb", "--init", "quack-init.sql", "-json", "-c", "use dwp; " + sql],
                       cwd=DB_DIR, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                       text=True)
    # The init file's statements print their own result sets first; the
    # query's rows are the last JSON array.
    dec, i, rows = json.JSONDecoder(), 0, []
    while (i := r.stdout.find("[", i)) >= 0:
        try:
            rows, i = dec.raw_decode(r.stdout, i)
        except json.JSONDecodeError:
            i += 1
    return rows


def runs(rider):
    """The rider's run ids."""
    return {row["id"] for row in query(
        f"select id::varchar as id from dwlist where rider = '{rider}'")}


DRY_LIMIT = 0.97  # dryLimit in web/lib/components/data.js


HST = ZoneInfo("Pacific/Honolulu")


def latest(rider, dwid=None):
    """A run's summary fields: dwid's, else the rider's latest."""
    which = f"id = '{dwid}'" if dwid else f"rider = '{rider}' order by ts desc limit 1"
    rows = query(
        "select id::varchar as id, ts, start_beach, end_beach, foil, board, distance_km, "
        "distance_on_foil, duration_on_foil, avg_foiling_hr, min_foiling_hr, max_speed_1k, "
        f"longest_segment_distance from dwlist_resolved where {which}")
    return rows[0] if rows else None


def dur(sec):
    h, m = divmod(round(sec / 60), 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def pace(kmh):
    m, s = divmod(round(3600 / kmh), 60)
    return f"{m}:{s:02d}/km"


def summary(r, rider):
    """(text, html) describing run r."""
    when = datetime.fromtimestamp(r["ts"], HST)
    # No beach name: the run was nowhere near a known beach (db/run-stats.sql).
    head = (f"{r['start_beach'] or 'Unknown'} → {r['end_beach'] or 'Unknown'} · "
            f"{when:%a %b} {when.day} {when:%H:%M}")
    lines = []
    foil_m, foil_s = r.get("distance_on_foil"), r.get("duration_on_foil")
    if foil_m and foil_s:
        lines.append(f"🏄 {foil_m / 1000:.1f} km on foil in {dur(foil_s)}")
        lines.append(f"⚡ {foil_m / foil_s * 3.6:.1f} km/h foiling"
                     + (f" · best km {pace(r['max_speed_1k'])}" if r.get("max_speed_1k") else ""))
    elif r.get("distance_km"):
        lines.append(f"📏 {r['distance_km']:.1f} km")
    if r.get("avg_foiling_hr"):
        lines.append(f"❤️ {r['avg_foiling_hr']:.0f} avg · {r['min_foiling_hr']:.0f} min bpm")
    if foil_m and r.get("longest_segment_distance") is not None:
        frac = r["longest_segment_distance"] / foil_m
        lines.append("★ dry!" if frac > DRY_LIMIT
                     else f"💦 not dry: longest flight {frac:.0%} of foiling")
    gear = " · ".join(r[k] for k in ("foil", "board") if r.get(k))
    if gear:
        lines.append(f"🪽 {gear}")
    url = f"https://{rider}.downwind.pro/run.html?id={r['id']}"
    text = "\n".join([head, *lines, url])
    html = "<br>".join([f'<a href="{url}"><b>{escape(head)}</b></a>',
                        *map(escape, lines)])
    return text, html


def achievements(rider, dwid):
    """Lines for the records run dwid set, from achievements.mjs (the web's
    own achievements code) over a fresh export of the rider's runs.csv."""
    try:
        with tempfile.TemporaryDirectory(prefix="dwp-ach-") as tmp:
            dwp_publish.export_lists(rider, tmp)
            r = subprocess.run(["node", os.path.join(BOT_DIR, "achievements.mjs"),
                                os.path.join(tmp, "runs.csv"), "--run", dwid],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               timeout=120)
        if r.returncode != 0:
            log(f"achievements.mjs failed:\n{r.stderr}")
            return []
        found = json.loads(r.stdout)
    except (dwp_publish.PublishError, OSError, subprocess.SubprocessError, ValueError) as e:
        log(f"achievements failed: {e}")
        return []
    lines = []
    for a in found[0]["records"] if found else []:
        if a["event"]:
            lines.append(f"🎉 {a['note'] or a['label']}")
            continue
        what = a["label"] + (f" ({a['group']})" if a["group"] else "")
        prev = a["prev"]
        on = prev and datetime.fromisoformat(prev["ts"].replace("Z", "+00:00")).astimezone(HST)
        if a["matched"]:
            lines.append(f"🤝 matched {what}: {a['display']} (from {on:%Y-%m-%d})")
        elif prev:
            lines.append(f"🏆 {what}: {a['display']} (was {prev['display']}, {on:%Y-%m-%d})")
        else:
            lines.append(f"🏆 {what}: {a['display']} (first)")
    return lines


# The init file's result sets (boxes and "N rows"), which crowd the real
# error out of a reply.
RESULT_BOX = re.compile(r"\s*([┌│├└].*|\d+ rows?)$")


def tail(out, n=15):
    lines = [ln for ln in out.rstrip().splitlines() if not RESULT_BOX.match(ln)]
    return "\n".join(lines[-n:])


def sql_str(v):
    return "'" + v.replace("'", "''") + "'"


RUN_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
