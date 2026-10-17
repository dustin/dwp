"""Forecast run picks for matrix-bot's !forecast: the same blend the site's
forecast cards use (web/lib/components/forecast.js, numbers in
web/lib/data/wind-forecast.json), classed with web/lib/data/wind-quality.json,
turned into rideable windows per spot and day.

rows are wind_forecast rows as dicts {site, model, issued, t, wavg, wdir}
(issued and t epochs); obs are a station's recent readings {t, wavg},
oldest first, for the nowcast nudge.
"""

import json
import math
import os
from datetime import datetime, timedelta, timezone

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "lib", "data")
HST = timezone(timedelta(hours=-10))
HOUR = 3600
RIDEABLE = {"magic", "good", "hard"}
# Where each forecast station's run goes, for the message, and where the
# sun's worked out from.
SPOTS = {"kihei": ("Kīhei", (20.785, -156.466)), "hookipa": ("Maliko", (20.933, -156.357))}
# A class's worth in knots over the floor when picking the best window, so
# 14 kn of magic beats 15 of harder but not 20 of good.
CLASS_BONUS = {"magic": 3, "good": 0, "hard": -3}


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def config():
    return load("wind-forecast.json")["stations"], load("wind-quality.json")


def wind_class(quality, site, wavg, wdir):
    q = quality["stations"].get(site)
    if not q or wdir is None:
        return None
    deg = round(wdir) % 360
    hit = next((r for r in q["ranges"]
                if (r["from"] <= deg <= r["to"] if r["from"] <= r["to"] else deg >= r["from"] or deg <= r["to"])),
               None)
    if not hit:
        return "nogo"
    return "light" if wavg < q["floor"] else hit["class"]


def hst_day(t):
    return datetime.fromtimestamp(t, HST).date().isoformat()


def hst_hour(t):
    return datetime.fromtimestamp(t, HST).hour


def sun_times(day, spot):
    """(sunrise, sunset) epochs for a Hawaii day ('YYYY-MM-DD')."""
    lat, lon = spot
    rad = math.pi / 180
    noon = datetime.fromisoformat(f"{day}T22:00:00+00:00").timestamp()
    n = round(noon / 86400 + 2440587.5 - 2451545 + lon / 360)
    j = n - lon / 360
    m = (357.5291 + 0.98560028 * j) % 360
    c = 1.9148 * math.sin(m * rad) + 0.02 * math.sin(2 * m * rad) + 0.0003 * math.sin(3 * m * rad)
    lam = (m + c + 180 + 102.9372) % 360
    transit = 2451545 + j + 0.0053 * math.sin(m * rad) - 0.0069 * math.sin(2 * lam * rad)
    decl = math.asin(math.sin(lam * rad) * math.sin(23.4397 * rad))
    w = math.acos((math.sin(-0.833 * rad) - math.sin(lat * rad) * math.sin(decl))
                  / (math.cos(lat * rad) * math.cos(decl))) / rad
    epoch = lambda jd: (jd - 2440587.5) * 86400
    return epoch(transit - w / 360), epoch(transit + w / 360)


def mean_dir(ds):
    s = sum(math.sin(d * math.pi / 180) for d in ds) / len(ds)
    c = sum(math.cos(d * math.pi / 180) for d in ds) / len(ds)
    return (math.atan2(s, c) * 180 / math.pi + 360) % 360


def hourly(site, rows, obs, cfg, now):
    """The calibrated hourly blend from each model's newest run, nudged by
    the station's current error: [{t, wavg, wdir}]."""
    c = cfg[site]
    rows = [r for r in rows if r["site"] == site and r["issued"]]
    newest = {}
    for r in rows:
        newest[r["model"]] = max(newest.get(r["model"], 0), r["issued"])
    by_t = {}
    for r in rows:
        if r["issued"] == newest[r["model"]]:
            by_t.setdefault(r["t"], {})[r["model"]] = r
    hours = []
    for t in sorted(by_t):
        ms = by_t[t]
        if not all(m in ms for m in c["models"]):
            continue
        avg = sum(ms[m]["wavg"] for m in c["models"]) / len(c["models"])
        wdir = ms[c["directionModel"]]["wdir"] if c["directionModel"] else mean_dir([ms[m]["wdir"] for m in c["models"]])
        k = c["hourly"][str(min(18, max(7, hst_hour(t))))]
        hours.append({"t": t, "wavg": k["a"] + k["b"] * avg, "wdir": wdir})
    offset = 0
    if obs and hours and now - obs[-1]["t"] < HOUR:
        last = obs[-1]["t"]
        recent = [o["wavg"] for o in obs if last - o["t"] <= HOUR / 2]
        at = min(hours, key=lambda h: abs(h["t"] - last))
        if abs(at["t"] - last) <= HOUR:
            offset = sum(recent) / len(recent) - at["wavg"]
    for h in hours:
        ahead = (h["t"] - now) / HOUR
        if ahead > -1:
            h["wavg"] = max(0, h["wavg"] + offset * math.exp(-max(0, ahead) / c["nowcastHours"]))
    return hours, offset


def windows(site, hours, quality, now):
    """Rideable daylight stretches (2+ hours, or the one left today) from
    now on: [{site, day, start, end, peak, wavg, wdir, cls, score}], where
    cls is the stretch's commonest class and score how good it is."""
    floor = quality["stations"][site]["floor"]
    spot = SPOTS[site][1]
    out, run = [], []

    def close():
        if not run:
            return
        if len(run) >= 2 or (hst_day(run[0]["t"]) == hst_day(now) and run[-1]["t"] >= now):
            cls = max(RIDEABLE, key=lambda k: (sum(h["cls"] == k for h in run), CLASS_BONUS[k]))
            peak = max(run, key=lambda h: h["wavg"])
            score = sum(h["wavg"] - floor + CLASS_BONUS[h["cls"]] for h in run) / len(run)
            out.append({"site": site, "day": hst_day(run[0]["t"]), "start": run[0]["t"], "end": run[-1]["t"],
                        "peak": peak, "wavg": sum(h["wavg"] for h in run) / len(run),
                        "wdir": mean_dir([h["wdir"] for h in run]), "cls": cls,
                        "score": score, "hours": len(run)})
        run.clear()

    day = None
    for h in hours:
        if h["t"] < now - HOUR / 2:
            continue
        d = hst_day(h["t"])
        rise, set_ = sun_times(d, spot)
        h["cls"] = wind_class(quality, site, h["wavg"], h["wdir"])
        if d != day or h["cls"] not in RIDEABLE or not rise - HOUR / 2 <= h["t"] <= set_:
            close()
        day = d
        if h["cls"] in RIDEABLE and rise - HOUR / 2 <= h["t"] <= set_:
            run.append(h)
    close()
    return out


def days_ahead(site, hours, quality, now):
    """Per coming day, the 12-16 average and its class: {day: (wavg, wdir, cls)}."""
    by = {}
    for h in hours:
        if 12 <= hst_hour(h["t"]) <= 16 and h["t"] >= now - HOUR / 2:
            by.setdefault(hst_day(h["t"]), []).append(h)
    return {d: (w := sum(h["wavg"] for h in hs) / len(hs), dr := mean_dir([h["wdir"] for h in hs]),
                wind_class(quality, site, w, dr))
            for d, hs in by.items() if len(hs) >= 3}


def picks(rows, obs, now, cfg=None, quality=None):
    """Everything !forecast says: {site: {hours, windows, days, offset}}."""
    if cfg is None:
        cfg, quality = config()
    out = {}
    for site in SPOTS:
        hs, offset = hourly(site, rows, obs.get(site, []), cfg, now)
        out[site] = {"hours": hs, "offset": offset, "windows": windows(site, [dict(h) for h in hs], quality, now),
                     "days": days_ahead(site, hs, quality, now)}
    return out, quality


def clock(t):
    return datetime.fromtimestamp(t, HST).strftime("%H:%M")


def day_label(day, now):
    today = datetime.fromtimestamp(now, HST).date()
    d = datetime.fromisoformat(day).date()
    name = "today" if d == today else "tomorrow" if d == today + timedelta(days=1) else f"{d:%a}"
    return f"{name} {day}"


def win_text(w, quality, now, with_day=True):
    label = quality["classes"][w["cls"]]["label"]
    span = f"{clock(w['start'])}–{clock(w['end'])}"
    return (f"{day_label(w['day'], now) + ' ' if with_day else ''}{span} ~{w['peak']['wavg']:.0f} kn "
            f"@{w['wdir']:.0f} {label}")


def message(p, quality, now, rating=None, days=3):
    """The !forecast reply as lines (emoji, text). rating is the live
    rating line for "now", if there's a fresh one."""
    lines = []
    all_w = [w for s in p.values() for w in s["windows"]]
    today = hst_day(now)
    # Best now: a window that holds this hour, else the live rating says it.
    live = [w for w in all_w if w["start"] - HOUR / 2 <= now <= w["end"] + HOUR / 2]
    if live:
        w = max(live, key=lambda w: w["score"])
        lines.append(("🏄 ", f"Now: {SPOTS[w['site']][0]} until {clock(w['end'])} "
                             f"~{w['peak']['wavg']:.0f} kn @{w['wdir']:.0f} {quality['classes'][w['cls']]['label']}"
                      + (f" · {rating}" if rating else "")))
    else:
        lines.append(("🏄 ", f"Now: nothing rideable forecast" + (f" · {rating}" if rating else "")))
    if all_w:
        w = max(all_w, key=lambda w: w["score"])
        lines.append(("⭐ ", f"Best: {SPOTS[w['site']][0]} {win_text(w, quality, now)}"))
    for site, (name, _) in SPOTS.items():
        ws = p[site]["windows"]
        tw = [w for w in ws if w["day"] == today]
        best = max(ws, key=lambda w: w["score"]) if ws else None
        parts = [f"today {win_text(max(tw, key=lambda w: w['score']), quality, now, False)}" if tw
                 else "nothing today"]
        if best and best["day"] != today:
            parts.append(f"best {win_text(best, quality, now)}")
        elif not best:
            parts.append("nothing rideable in the forecast")
        lines.append(("📍 ", f"{name}: " + " · ".join(parts)))
    coming = sorted({d for s in p.values() for d in s["days"] if d > today})[:days]
    for d in coming:
        bits = []
        for site, (name, _) in SPOTS.items():
            v = p[site]["days"].get(d)
            if v:
                bits.append(f"{name} {v[0]:.0f} kn @{v[1]:.0f} {quality['classes'][v[2]]['label'] if v[2] else ''}".rstrip())
        lines.append(("📅 ", f"{day_label(d, now)}: " + " · ".join(bits)))
    return lines
