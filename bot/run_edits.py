"""matrix-bot's changes to a run already in the database: !foil and !board,
!glitch, !trim, !split / !unsplit and !delete. Each is one transaction,
then a publish.

Only the Python standard library, like db/.
"""

import re
import uuid
from datetime import datetime

from common import HST, DWP_DB_DIR, escape, latest, query, run, sql_str, summary, tail
import dwp_publish  # db/, which common puts on the path


GEAR = ("foil", "board")  # dwlist columns !foil and !board set


NEW_EXAMPLE = {"foil": "Axis Spitfire 1180", "board": "Kalama Gator 95"}


def resolve_gear(rider, kind, name):
    """(name, None) for the one known foil or board (kind) name names, else
    (None, why).

    Matches like import.sql: a case-insensitive piece of the name, an exact
    name always winning; the rider's own first, then everyone's (a rider
    whose runs say "unknown" may share a foil with someone else)."""
    assert kind in GEAR
    new = re.match(r"new\s+(.+)", name, re.I)
    if new:
        return new.group(1).strip(), None
    for where in (f"rider = '{rider}' and ", ""):
        known = [row[kind] for row in query(
            f"select distinct {kind} from dwlist where {where}{kind} is not null")]
        exact = [f for f in known if f.lower() == name.lower()]
        hits = exact or [f for f in known if name.lower() in f.lower()]
        if len(hits) == 1:
            return hits[0], None
        if len(hits) > 1:
            return None, f"'{name}' matches more than one {kind}: {', '.join(sorted(hits))}"
    return None, f"no {kind} matches '{name}'"


def set_gear(mx, room, event_id, rider, kind, name, dwid=None):
    """Record foil or board (kind) name on run dwid, else the rider's latest
    run, then re-export."""
    r = latest(rider, dwid)
    if not r:
        mx.notice(room, f"No runs for {rider}.", reply_to=event_id)
        return
    value, why = resolve_gear(rider, kind, name)
    if why:
        mx.notice(room, f"🤔 {why}. If it's a {kind} nobody has ridden yet, send its "
                        f"full name after \"new\", e.g. !{kind} new {NEW_EXAMPLE[kind]}.",
                  reply_to=event_id)
        return
    mx.react(room, event_id, "👀")
    sql = ("use dwp; begin; "
           f"update dwlist set {kind} = {sql_str(value)} where id = '{r['id']}'; commit;")
    ok, out = run(["duckdb", "--init", "quack-init.sql", "-c", sql], cwd=DWP_DB_DIR)
    if ok:
        try:
            dwp_publish.run()
        except dwp_publish.PublishError as e:
            ok, out = False, str(e)
    if not ok:
        mx.notice(room, f"❌ couldn't change the {kind}:\n{tail(out)}", reply_to=event_id,
                  html=f"❌ couldn't change the {kind}:<pre><code>{escape(tail(out))}</code></pre>")
        return
    text, html = summary(latest(rider, r["id"]), rider)
    was = r.get(kind) or "none"
    mx.notice(room, f"✅ {kind} was {was}\n{text}", reply_to=event_id,
              html=f"✅ {kind} was {escape(was)}<br>{html}")


def top_speed(dwid):
    rows = query(f"select max_speed_kmh from run_top_speed where dwid = '{dwid}'")
    return rows[0]["max_speed_kmh"] if rows else None


def glitch(mx, room, event_id, dwid, rider, sender, undo=False):
    """Exclude run dwid's top-speed point from its top speed (or, with undo,
    put back every point excluded from it), recompute, then re-export. The
    trackpoints themselves are left alone (speed_exclusions in schema.sql)."""
    mx.react(room, event_id, "👀")
    was = top_speed(dwid)
    if was is None:
        mx.notice(room, "That run has no track to take a speed from.", reply_to=event_id)
        return
    if undo:
        change = f"delete from speed_exclusions where dwid = '{dwid}'; "
    else:
        change = ("insert into speed_exclusions "
                  f"select dwid, ts, speed, {sql_str('!glitch by ' + sender)}, now() "
                  f"from dws d where dwid = '{dwid}' and speed = "
                  f"(select max_speed_kmh from run_top_speed where dwid = '{dwid}') "
                  "and not exists (select 1 from speed_exclusions e "
                  "where e.dwid = d.dwid and e.ts = d.ts) order by ts limit 1; ")
    sql = ("use dwp; begin; "
           + change +
           "update dwlist as l set max_speed_kmh = t.max_speed_kmh from run_top_speed t "
           f"where l.id = t.dwid and l.id = '{dwid}'; commit;")
    ok, out = run(["duckdb", "--init", "quack-init.sql", "-c", sql], cwd=DWP_DB_DIR)
    if ok:
        try:
            dwp_publish.run()
        except dwp_publish.PublishError as e:
            ok, out = False, str(e)
    if not ok:
        mx.notice(room, f"❌ couldn't change the top speed:\n{tail(out)}", reply_to=event_id,
                  html=f"❌ couldn't change the top speed:<pre><code>{escape(tail(out))}</code></pre>")
        return
    now = top_speed(dwid)
    url = f"https://{rider}.downwind.pro/run.html?id={dwid}"
    what = "put back every dropped reading" if undo else f"dropped the {was:.1f} km/h reading"
    mx.notice(room, f"✅ {what}: top speed {was:.1f} → {now:.1f} km/h\n{url}",
              reply_to=event_id,
              html=f'✅ {escape(what)}: top speed {was:.1f} → {now:.1f} km/h '
                   f'(<a href="{url}">run</a>)')


# Where a !trim puts a run's start or end: a Hawaii time on the run's day
# (10:42), or minutes in from the track's own start or end (20m, +20m).
TRIM_AT = re.compile(r"(?:(\d{1,2}):(\d{2})|\+?(\d+)m(?:in)?)$")


def trim_at(spec, t0, t1, is_end):
    """Epoch seconds of trim point spec on a track from t0 to t1, or None
    if spec isn't one."""
    m = TRIM_AT.match(spec)
    if not m:
        return None
    if m.group(3):
        return t1 - 60 * int(m.group(3)) if is_end else t0 + 60 * int(m.group(3))
    day = datetime.fromtimestamp(t0, HST)
    return day.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0).timestamp()


def hm(t):
    return f"{datetime.fromtimestamp(t, HST):%H:%M}"


def trim(mx, room, event_id, dwid, rider, sender, start=None, end=None, undo=False):
    """Trim run dwid to its trackpoints from start to end (trim points as
    TRIM_AT takes them; a missing one keeps the run's current trim there),
    or with undo, untrim it; then recompute its stats and re-export. The
    trackpoints themselves are left alone (run_trims in schema.sql)."""
    raw = query(f"select epoch(min(ts)) as t0, epoch(max(ts)) as t1 from dws where dwid = '{dwid}'")
    if not raw or raw[0]["t0"] is None:
        mx.notice(room, "That run has no track to trim.", reply_to=event_id)
        return
    t0, t1 = raw[0]["t0"], raw[0]["t1"]
    cur = query("select epoch(start_ts) as s, epoch(end_ts) as e from run_trims "
                f"where dwid = '{dwid}'")
    cur = cur[0] if cur else {"s": None, "e": None}
    if not (start or end or undo):
        url = f"https://{rider}.downwind.pro/run.html?id={dwid}"
        now = (f"trimmed to {hm(cur['s'] or t0)}–{hm(cur['e'] or t1)} "
               f"of {hm(t0)}–{hm(t1)}" if cur["s"] or cur["e"] else
               f"not trimmed ({hm(t0)}–{hm(t1)})")
        mx.notice(room, f"That run is {now}. !trim start 10:42 (or start 20m) and "
                        f"!trim end 12:05 (or end 5m) trim it, !trim undo puts it back.\n{url}",
                  reply_to=event_id)
        return
    s, e = None, None
    if not undo:
        s = trim_at(start, t0, t1, False) if start else cur["s"]
        e = trim_at(end, t0, t1, True) if end else cur["e"]
        if (start and s is None) or (end and e is None):
            mx.notice(room, "A trim point is a time like 10:42 or minutes like 20m.",
                      reply_to=event_id)
            return
        s = None if s is not None and s <= t0 else s
        e = None if e is not None and e >= t1 else e
        if (e or t1) - (s or t0) < 60:
            mx.notice(room, f"That leaves nothing of the run ({hm(t0)}–{hm(t1)}).",
                      reply_to=event_id)
            return
    mx.react(room, event_id, "👀")
    was = latest(rider, dwid)
    ts = lambda t: "null" if t is None else f"to_timestamp({t})"  # noqa: E731
    change = f"delete from run_trims where dwid = '{dwid}'; "
    if s is not None or e is not None:
        change += (f"insert into run_trims values ('{dwid}', {ts(s)}, {ts(e)}, "
                   f"{sql_str('!trim by ' + sender)}, now()); ")
    ok, out = db_change("trim", dwid, change, [dwid])
    if not ok:
        mx.notice(room, f"❌ couldn't trim the run:\n{tail(out)}", reply_to=event_id,
                  html=f"❌ couldn't trim the run:<pre><code>{escape(tail(out))}</code></pre>")
        return
    what = (f"trimmed to {hm(s or t0)}–{hm(e or t1)} of {hm(t0)}–{hm(t1)}"
            if s is not None or e is not None else f"untrimmed ({hm(t0)}–{hm(t1)})")
    what += f", was {was['distance_km']:.1f} km" if was and was.get("distance_km") else ""
    text, html = summary(latest(rider, dwid), rider)
    mx.notice(room, f"✅ {what}\n{text}", reply_to=event_id,
              html=f"✅ {escape(what)}<br>{html}")


def db_change(what, dwid, change, dwids):
    """Run change on the database, recompute runs dwids' stats in the same
    transaction, then re-export; (ok, output)."""
    sql = ("use dwp; begin; "
           + change + dwp_publish.run_stats_sql(dwids) + "\ncommit;")
    ok, out = run(["duckdb", "-bail", "--init", "quack-init.sql", "-c", sql], cwd=DWP_DB_DIR)
    if ok:
        try:
            dwp_publish.run()
        except dwp_publish.PublishError as err:
            ok, out = False, str(err)
    return ok, out


def raw_span(dwid):
    """(first, last) epoch seconds of run dwid's trackpoints, untrimmed, or None."""
    rows = query(f"select epoch(min(ts)) as t0, epoch(max(ts)) as t1 from dws where dwid = '{dwid}'")
    return (rows[0]["t0"], rows[0]["t1"]) if rows and rows[0]["t0"] is not None else None


def split(mx, room, event_id, dwid, rider, sender, at):
    """Split run dwid at trim point at (TRIM_AT): a copy of its dwlist row
    becomes a new run, its trackpoints from there on move to it (with their
    speed exclusions and the run's end trim), and both are recomputed and
    re-exported. !unsplit puts them back together."""
    span = raw_span(dwid)
    if not span:
        mx.notice(room, "That run has no track to split.", reply_to=event_id)
        return
    t0, t1 = span
    trim = query("select epoch(start_ts) as s, epoch(end_ts) as e from run_trims "
                 f"where dwid = '{dwid}'")
    lo = (trim and trim[0]["s"]) or t0
    hi = (trim and trim[0]["e"]) or t1
    t = trim_at(at, t0, t1, False)
    if t is None:
        mx.notice(room, "!split takes a time like 12:45 or minutes in like 40m.",
                  reply_to=event_id)
        return
    if not lo + 60 <= t <= hi - 60:
        mx.notice(room, f"Split somewhere within the run ({hm(lo)}–{hm(hi)}).",
                  reply_to=event_id)
        return
    mx.react(room, event_id, "👀")
    new = str(uuid.uuid4())
    change = (
        f"insert into dwlist select * replace ('{new}'::uuid as id) from dwlist where id = '{dwid}'; "
        f"update dws set dwid = '{new}' where dwid = '{dwid}' and ts >= to_timestamp({t}); "
        f"update speed_exclusions set dwid = '{new}' where dwid = '{dwid}' and ts >= to_timestamp({t}); "
        f"insert into run_trims select '{new}', null, end_ts, reason, added_at from run_trims "
        f"where dwid = '{dwid}' and end_ts is not null; "
        f"update run_trims set end_ts = null where dwid = '{dwid}'; "
        f"delete from run_trims where dwid = '{dwid}' and start_ts is null; ")
    ok, out = db_change("split", dwid, change, [dwid, new])
    if not ok:
        mx.notice(room, f"❌ couldn't split the run:\n{tail(out)}", reply_to=event_id,
                  html=f"❌ couldn't split the run:<pre><code>{escape(tail(out))}</code></pre>")
        return
    a, ah = summary(latest(rider, dwid), rider)
    b, bh = summary(latest(rider, new), rider)
    url = f"https://{rider}.downwind.pro/run.html?id="
    mx.notice(room, f"✅ split at {hm(t)} (!unsplit {url}{dwid} puts it back)\n{a}\n\n{b}",
              reply_to=event_id,
              html=f'✅ split at {hm(t)} (<code>!unsplit</code> the <a href="{url}{dwid}">first '
                   f'half</a> puts it back)<br>{ah}<br><br>{bh}')


def unsplit(mx, room, event_id, dwid, rider, sender):
    """Join run dwid with the run split off it: the rider's run whose track
    starts within a minute of dwid's end (separate runs are always further
    apart). Its trackpoints move back, it is deleted, dwid keeps its own
    start trim and takes the other's end trim, and dwid is recomputed."""
    span = raw_span(dwid)
    if not span:
        mx.notice(room, "That run has no track.", reply_to=event_id)
        return
    nxt = query(f"select dwid::varchar as id from dws where dwid in "
                f"(select id from dwlist where rider = {sql_str(rider)} and id <> '{dwid}') "
                f"group by dwid having min(ts) > to_timestamp({span[1]}) "
                f"and min(ts) <= to_timestamp({span[1]}) + interval 60 second")
    if len(nxt) != 1:
        mx.notice(room, "No run starts right where that one ends, so it wasn't split "
                        "(or give the first half).", reply_to=event_id)
        return
    nxt = nxt[0]["id"]
    mx.react(room, event_id, "👀")
    change = (
        f"create temp table joined as select "
        f"(select start_ts from run_trims where dwid = '{dwid}') as s, "
        f"(select end_ts from run_trims where dwid = '{nxt}') as e; "
        f"delete from run_trims where dwid in ('{dwid}', '{nxt}'); "
        f"insert into run_trims select '{dwid}', s, e, {sql_str('!unsplit by ' + sender)}, now() "
        "from joined where s is not null or e is not null; drop table joined; "
        f"update dws set dwid = '{dwid}' where dwid = '{nxt}'; "
        f"update speed_exclusions set dwid = '{dwid}' where dwid = '{nxt}'; "
        f"delete from dwlist where id = '{nxt}'; ")
    ok, out = db_change("unsplit", dwid, change, [dwid])
    if not ok:
        mx.notice(room, f"❌ couldn't unsplit the run:\n{tail(out)}", reply_to=event_id,
                  html=f"❌ couldn't unsplit the run:<pre><code>{escape(tail(out))}</code></pre>")
        return
    text, html = summary(latest(rider, dwid), rider)
    mx.notice(room, f"✅ joined back up\n{text}", reply_to=event_id,
              html=f"✅ joined back up<br>{html}")


def delete_run(mx, room, event_id, dwid, rider, sender):
    """Delete run dwid from the database: its dwlist row, trackpoints, trims and
    speed exclusions in one commit, then re-publish (the lists drop it; its
    track file in S3 is left for !publish orphans --delete)."""
    mx.react(room, event_id, "👀")
    sql = ("use dwp; begin; "
           f"delete from speed_exclusions where dwid = '{dwid}'; "
           f"delete from run_trims where dwid = '{dwid}'; "
           f"delete from dws where dwid = '{dwid}'; "
           f"delete from dwlist where id = '{dwid}'; commit;")
    ok, out = run(["duckdb", "-bail", "--init", "quack-init.sql", "-c", sql], cwd=DWP_DB_DIR)
    if ok:
        try:
            dwp_publish.run()
        except dwp_publish.PublishError as err:
            ok, out = False, f"deleted, but publishing failed: {err}"
    if not ok:
        mx.notice(room, f"❌ couldn't delete the run:\n{tail(out)}", reply_to=event_id,
                  html=f"❌ couldn't delete the run:<pre><code>{escape(tail(out))}</code></pre>")
        return
    mx.react(room, event_id, "🗑️")  # no reply: the question already shows the run
