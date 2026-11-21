"""matrix-bot's imports: GPX files and zips sent to the room (or fetched
from a link) become runs through db/add-run, then a publish, and the
summaries of new runs a sync brings in.

Only the Python standard library, like db/.
"""

import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from common import achievements, escape, latest, run, runs, summary, tail
import dwp_publish  # db/, which common puts on the path
from run_edits import resolve_gear


def split_caption(text):
    """(foil, board) from a caption or answer like "585 board gator"; the
    board is None when it names none, the foil "-" when only a board."""
    m = re.match(r"(.*?)\s*\bboard\s+(.+)$", text, re.I)
    if not m:
        return text, None
    return m.group(1).strip() or "-", m.group(2).strip()


def add_run_cmd(path, foil, board, rider, publish=True):
    """./add-run for path with a caption's foil ("-" or "" for the one from
    that beach, "new <name>" for a new one) and board (None: the latest)."""
    cmd = ["./add-run", path, "--rider", rider] + (["--board", board] if board else [])
    new_foil = re.match(r"new\s+(.+)", foil, re.I)
    if new_foil:
        cmd[2:2] = [new_foil.group(1), "--new-foil"]
    elif foil and foil != "-":
        cmd.insert(2, foil)
    return cmd + ([] if publish else ["--no-publish"])


COMMITTED = re.compile(r"add-run: committed parse=([\d.]+)s db=([\d.]+)s")


def import_times(out):
    """(parse, db) seconds from add-run's output, (0, 0) if it didn't say."""
    m = COMMITTED.search(out)
    return (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)


def secs(t):
    """A duration for people: 0.4s, 12s, 3m05s."""
    return f"{t:.1f}s" if t < 10 else f"{t:.0f}s" if t < 60 else f"{int(t // 60)}m{int(t % 60):02d}s"


ADMIN_ROOM = None  # the first --room: import timings go there (see profile)


def profile(mx, text):
    """Post timing details to the admin room, not the room the import was in."""
    if ADMIN_ROOM:
        mx.notice(ADMIN_ROOM, "⏱ " + text)


def publish_timed():
    """Run publish; (seconds it took, None or why it failed)."""
    t = time.monotonic()
    try:
        dwp_publish.run()
        return time.monotonic() - t, None
    except dwp_publish.PublishError as e:
        return time.monotonic() - t, str(e)


def foil_lookup_failed(out):
    """The line saying add-run's foil lookup failed, if that's why it did."""
    return next((ln for ln in reversed(out.splitlines())
                 if "foil matches" in ln or "foil from" in ln), None)


ZIP_MAX_FILES = 500  # more GPX than this in one zip is a mistake


ZIP_MAX_BYTES = 2 << 30  # the same, unpacked


def download_url(url, path):
    """Save url to path, at most ZIP_MAX_BYTES; (filename, seconds)."""
    t = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": "dwp-matrix-bot"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as out:
        got = 0
        while chunk := r.read(1 << 20):
            got += len(chunk)
            if got > ZIP_MAX_BYTES:
                raise OSError(f"more than {ZIP_MAX_BYTES >> 20} MB")
            out.write(chunk)
        name = os.path.basename(urllib.parse.urlparse(r.geturl()).path) or "download"
    return name, time.monotonic() - t


def import_zip(mx, room, event_id, path, caption, rider, tmp, name="", fetched=None):
    """Import every GPX in the zip (or the one GPX) at path as rider's runs
    (caption: foil and board, as for one GPX), publish once, then describe
    them. fetched: seconds the download took, for the timings."""
    foil, board = split_caption(caption or "-")
    if board:
        board, why = resolve_gear(rider, "board", board)
        if why:
            mx.notice(room, f"🤔 {why}\nTry again with another foil and board.",
                      reply_to=event_id)
            return
    if not zipfile.is_zipfile(path):
        with open(path, "rb") as fh:
            if b"<gpx" not in fh.read(4096):
                mx.notice(room, "❌ that isn't a zip or a GPX file.", reply_to=event_id)
                return
        files = [(name or "download.gpx", path)]
    else:
        files = unzip_gpx(mx, room, event_id, path, tmp)
        if not files:
            return
    import_files(mx, room, event_id, files, foil, board, rider, fetched)


def unzip_gpx(mx, room, event_id, path, tmp):
    """[(name, path)] of the GPX files in the zip at path, unpacked in tmp;
    None (having said why) if there are none or too many."""
    try:
        with zipfile.ZipFile(path) as z:
            members = [m for m in z.infolist() if not m.is_dir()
                       and m.filename.lower().endswith(".gpx")
                       and not os.path.basename(m.filename).startswith("._")]
            if not members:
                mx.notice(room, "❌ there are no .gpx files in that zip.", reply_to=event_id)
                return None
            if len(members) > ZIP_MAX_FILES or sum(m.file_size for m in members) > ZIP_MAX_BYTES:
                mx.notice(room, f"❌ that zip is too big ({len(members)} GPX files); "
                                f"send at most {ZIP_MAX_FILES} at a time.", reply_to=event_id)
                return None
            files = []
            for i, m in enumerate(sorted(members, key=lambda m: m.filename)):
                out = os.path.join(tmp, f"{i:04d}.gpx")  # never the member's own path
                with z.open(m) as src, open(out, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                files.append((os.path.basename(m.filename), out))
    except (zipfile.BadZipFile, OSError) as e:
        mx.notice(room, f"❌ couldn't read that zip: {e}", reply_to=event_id)
        return None
    return files


def import_files(mx, room, event_id, files, foil, board, rider, fetched=None):
    """Import files [(name, gpx path)] as rider's runs, publish once, and
    say how it went (see import_zip)."""
    head = f"Importing {len(files)} GPX files as {rider}'s runs"
    status = mx.notice(room, head + "…", reply_to=event_id)
    progress = (lambda text: mx.edit(room, status, text)) if status else (lambda text: None)
    failed, unknown, parse, db = [], 0, 0.0, 0.0
    waited = time.monotonic()
    with SYNC_LOCK:
        start = time.monotonic()
        if start - waited > 5:
            progress(f"{head}… (waited for a sync to finish)")
        before = runs(rider)
        shown = start
        for i, (name, f) in enumerate(files, 1):
            ok, out = run(add_run_cmd(f, foil, board, rider, publish=False))
            if not ok and foil == "-" and foil_lookup_failed(out):
                # nothing ridden from that beach yet: fix the foil later
                p, l = import_times(out)
                parse, db = parse + p, db + l
                ok, out = run(add_run_cmd(f, "new unknown", board, rider, publish=False))
                unknown += ok
            p, l = import_times(out)
            parse, db = parse + p, db + l
            if not ok:
                failed.append((name, tail(out, 1)))
            if time.monotonic() - shown > 15 and i < len(files):  # edits are cheap, not free
                shown = time.monotonic()
                progress(f"{head}… {i}/{len(files)}"
                         + (f", {len(failed)} failed" if failed else ""))
        new = runs(rider) - before
        done = len(files) - len(failed)
        took = time.monotonic() - start
        published = pub_time = None
        if done:
            progress(f"💾 {rider}: {done} of {len(files)} runs saved to the database. "
                     "Publishing…")
            pub_time, published = publish_timed()
            progress(f"💾 {rider}: {done} of {len(files)} runs saved to the database. "
                     + ("❌ publish failed." if published else "📤 published."))
        else:
            progress(f"❌ {rider}: nothing saved to the database")
    lines = [f"{'✅' if done else '❌'} {rider}: imported {done} of {len(files)} GPX files"]
    profile(mx, f"{rider}: {done} of {len(files)} GPX files in "
                f"{secs(took + (pub_time or 0) + (fetched or 0))}: "
                + (f"download {secs(fetched)} · " if fetched is not None else "")
                + f"parse {secs(parse)} · db {secs(db)} (import {secs(took)} wall)"
                + (f" · publish {secs(pub_time)}" if pub_time is not None else "")
                + (f" · waited {secs(start - waited)} for a sync" if start - waited > 1 else ""))
    if unknown:
        lines.append(f"{unknown} with foil unknown (no earlier foil from that beach)")
    if failed:
        lines.append(f"{len(failed)} failed:")
        lines += [f"  {n}: {why}" for n, why in failed[:10]]
        if len(failed) > 10:
            lines.append(f"  … and {len(failed) - 10} more (see the bot's log)")
    if published:
        lines.append(f"❌ publish failed: {published}")
    mx.notice(room, "\n".join(lines), reply_to=event_id)
    announce(mx, room, event_id, rider, new)


def import_gpx(mx, room, event_id, path, foil, rider):
    foil, board = split_caption(foil)
    if board:
        board, why = resolve_gear(rider, "board", board)
        if why:  # the file waits for another answer
            mx.notice(room, f"🤔 {why}\nWhich foil and board? e.g. 585 board gator, or "
                            "\"board new <full name>\" for a board nobody has ridden yet.",
                      reply_to=event_id)
            return False
    mx.react(room, event_id, "👀")
    before = runs(rider)
    ok, out = run(add_run_cmd(path, foil, board, rider, publish=False))
    if not ok:
        why = foil_lookup_failed(out)
        if why:  # the foil lookup failed: ask again, the file waits
            why = why.split("Error: ")[-1].strip()
            mx.notice(room, f"🤔 {why}\nWhich foil? If it's one you haven't ridden "
                            "before, send its full name after \"new\", e.g. "
                            "new Axis Spitfire 1180.", reply_to=event_id)
        else:
            again = "\nSend !retry to try this file again."
            mx.notice(room, f"❌ add-run failed:\n{tail(out)}{again}", reply_to=event_id,
                      html=f"❌ add-run failed:<pre><code>{escape(tail(out))}</code></pre>"
                           f"{escape(again)}")
        return False
    parse, db = import_times(out)
    # The summary comes from the database, so it goes out before the
    # publish rather than waiting on it.
    new = runs(rider) - before
    r = latest(rider, new.pop()) if len(new) == 1 else None
    if r:
        text, html = summary(r, rider)
        recs = achievements(rider, r["id"])
        if recs:
            text += "\n" + "\n".join(recs)
            html += "<br>" + "<br>".join(map(escape, recs))
        mx.notice(room, "✅ " + text, reply_to=event_id, html="✅ " + html)
    else:
        mx.notice(room, "✅ imported (couldn't tell which run it is)", reply_to=event_id)
    status = mx.notice(room, "💾 saved to the database. Publishing…", reply_to=event_id)
    pub_time, failed = publish_timed()
    profile(mx, f"{rider}: 1 GPX: parse {secs(parse)} · db {secs(db)} · "
                f"publish {secs(pub_time)}")
    done = (f"❌ publish failed: {failed}\nThe run is in the database; !publish tries again."
            if failed else "💾 saved to the database · 📤 published")
    if status:
        mx.edit(room, status, done)
    elif failed:
        mx.notice(room, done, reply_to=event_id)
    return True


SYNC_SUMMARIES = 5  # a first sync can bring in dozens; describe only the latest


SYNC_LOCK = threading.Lock()  # one drive-sync at a time, asked for or scheduled


def announce(mx, room, event_id, rider, dwids):
    """A summary plus records for each newly imported run, oldest first."""
    for text, html in new_runs(rider, dwids):
        mx.notice(room, text, reply_to=event_id, html=html)


def new_runs(rider, dwids):
    """(text, html) messages describing newly imported runs (see announce)."""
    rows = sorted(filter(None, (latest(rider, d) for d in dwids)), key=lambda r: r["ts"])
    msgs = []
    if len(rows) > SYNC_SUMMARIES:
        msgs.append((f"{rider}: {len(rows)} runs imported, describing the latest "
                     f"{SYNC_SUMMARIES}", None))
    for r in rows[-SYNC_SUMMARIES:]:
        text, html = summary(r, rider)
        text, html = f"{rider.title()}: {text}", f"{escape(rider.title())}: {html}"
        recs = achievements(rider, r["id"])
        if recs:
            text += "\n" + "\n".join(recs)
            html += "<br>" + "<br>".join(map(escape, recs))
        msgs.append((text, html))
    return msgs
