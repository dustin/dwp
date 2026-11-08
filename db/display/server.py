"""The e-paper display server: TRMNL's BYOS API for devices anywhere, with
the page in the URL.

A device's server URL names the page it shows, and the firmware adds the
API paths to it:

    https://api.downwind.pro/trmnl/kihei          -> .../kihei/api/display

Pages (PAGES below): kihei, maliko (live in the go window, the outlook
outside it), kihei-forecast, maliko-forecast (always the outlook),
buoy-<site>, tide-<spot>. The image's size is the device's Width and Height
headers; a Format: bmp header asks for a 4-grey BMP (the MagTag), anything
else gets a 2-bit PNG.

There's no browser here. Each page and size a device asks for goes on the
wanted list, and a renderer elsewhere (db/display's sync on pitrick) reads
it, renders what's due and PUTs the images back:

    GET  /internal/wanted                     [{key, page, size, format, url, updated}]
    PUT  /internal/image/<page>/<WxH>.<ext>   the image

Only /trmnl/ is meant to be public (nginx proxies just that); /internal/ is
reached over the tailnet. An entry no device has asked for in a few days
is dropped.

usage: server.py STATE_DIR [--port 8893] [--public https://api.downwind.pro]
"""

import argparse
import hashlib
import json
import math
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SITE = "https://downwind.pro"

# Page name -> (render URL, schedule, sun spot). Schedules: "go" wakes for
# each render in the go window and sleeps from the outlook to the next
# morning (as reterminal.md's GO_START/GO_END); "day" wakes for each render
# outside QUIET.
KIHEI = (20.785, -156.466)
HOOKIPA = (20.933, -156.357)
FIXED = {
    "kihei": (f"{SITE}/reterminal.html?site=kihei", "go", KIHEI),
    "maliko": (f"{SITE}/reterminal.html?site=maliko", "go", HOOKIPA),
    "kihei-forecast": (f"{SITE}/reterminal.html?site=kihei&view=outlook", "day", KIHEI),
    "maliko-forecast": (f"{SITE}/reterminal.html?site=maliko&view=outlook", "day", HOOKIPA),
}
PATTERNS = [
    (re.compile(r"buoy-([a-z_]+)"), lambda m: (f"{SITE}/magtag.html?site={m[1]}", "day", KIHEI)),
    (re.compile(r"tide-([a-z0-9_-]+)"), lambda m: (f"{SITE}/magtag.html?card=tide&spot={m[1]}", "day", KIHEI)),
]


def page_info(name):
    if name in FIXED:
        return FIXED[name]
    for pat, f in PATTERNS:
        if m := pat.fullmatch(name):
            return f(m)
    return None


# ---- schedule ----
# The renderer runs at :13 and :43 (just after publish at :10/:40), 05-20 HST.
PERIOD = 30 * 60
OFFSET = 13 * 60
MARGIN = 60                      # wake this long after the expected upload
FIRST_TRY = 120                  # no image yet: ask again this soon
QUIET = (21 * 3600, 5 * 3600 + 45 * 60)   # local quiet hours, seconds since midnight
GO_START = 9 * 3600
GO_END_BEFORE_SUNSET = 3600
TZ = -10 * 3600                  # HST, no DST
DAY = 86400
MIN_SLEEP = 60
FORGET = 3 * DAY                 # drop a wanted entry nobody's asked for in this long


def local_s(t):
    return (t + TZ) % DAY


def local_midnight(t):
    return t - local_s(t)


def next_slot(t):
    """The next render after t, plus margin."""
    return (math.floor((t - OFFSET) / PERIOD) + 1) * PERIOD + OFFSET + MARGIN


def in_quiet(t):
    m, (s, e) = local_s(t), QUIET
    return (s <= m < e) if s <= e else (m >= s or m < e)


def quiet_end(t):
    end = local_midnight(t) + QUIET[1]
    return end if end > t else end + DAY


def sunset(t, spot):
    """Sunset on the local day holding t (the sunrise equation, as in
    forecast.js sunTimes; good to a minute or two)."""
    lat, lon = spot
    rad = math.pi / 180
    noon = local_midnight(t) + 12 * 3600
    n = round(noon / DAY + 2440587.5 - 2451545 + lon / 360)
    j = n - lon / 360
    m = (357.5291 + 0.98560028 * j) % 360
    c = 1.9148 * math.sin(m * rad) + 0.02 * math.sin(2 * m * rad) + 0.0003 * math.sin(3 * m * rad)
    lam = (m + c + 180 + 102.9372) % 360
    transit = 2451545 + j + 0.0053 * math.sin(m * rad) - 0.0069 * math.sin(2 * lam * rad)
    decl = math.asin(math.sin(lam * rad) * math.sin(23.4397 * rad))
    w = math.acos((math.sin(-0.833 * rad) - math.sin(lat * rad) * math.sin(decl))
                  / (math.cos(lat * rad) * math.cos(decl))) / rad
    return (transit + w / 360 - 2440587.5) * DAY


def next_wake(now, updated, schedule, spot):
    if updated is None:
        return now + FIRST_TRY
    nxt = updated + PERIOD + MARGIN
    if nxt <= now + 30:
        nxt = next_slot(now)
    if schedule == "go":
        go_start = local_midnight(now) + GO_START
        go_end = sunset(now, spot) - GO_END_BEFORE_SUNSET
        first = next_slot(go_start - 1)            # first render after go_start, plus margin
        if now < go_start:
            nxt = first                            # morning: wait for the first live render
        elif updated >= go_end:
            nxt = first + DAY                      # showing the outlook: sleep till tomorrow
        elif now >= go_end + PERIOD + MARGIN:
            nxt = first + DAY                      # renders stopped; don't keep waking
    elif in_quiet(nxt):
        nxt = quiet_end(nxt)
    return nxt


# ---- state ----
class State:
    """The wanted list, persisted as wanted.json, and the images beside it."""

    def __init__(self, root):
        self.root = root
        self.path = os.path.join(root, "wanted.json")
        self.lock = threading.Lock()
        try:
            with open(self.path) as f:
                self.wanted = json.load(f)
        except (OSError, ValueError):
            self.wanted = {}

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.wanted, f, indent=1)
        os.replace(tmp, self.path)

    def image_path(self, key):
        return os.path.join(self.root, "images", key.replace("/", "_"))

    def ask(self, page, size, fmt):
        """A device wants this; returns its entry (a copy)."""
        key = f"{page}/{size}.{fmt}"
        now = time.time()
        with self.lock:
            e = self.wanted.get(key)
            if e is None:
                e = self.wanted[key] = {"page": page, "size": size, "format": fmt, "updated": None, "hash": None}
            # Write the asked time at most hourly; it only matters for FORGET.
            changed = e.get("asked", 0) < now - 3600
            e["asked"] = now if changed else e["asked"]
            if changed:
                self.save()
            return dict(e, key=key)

    def put(self, key, data):
        with self.lock:
            e = self.wanted.get(key)
            if e is None:
                return False
            os.makedirs(os.path.join(self.root, "images"), exist_ok=True)
            tmp = self.image_path(key) + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, self.image_path(key))
            e["updated"] = time.time()
            e["hash"] = hashlib.sha1(data).hexdigest()[:8]
            self.save()
            return True

    def list(self):
        now = time.time()
        with self.lock:
            stale = [k for k, e in self.wanted.items() if e.get("asked", 0) < now - FORGET]
            for k in stale:
                del self.wanted[k]
                try:
                    os.remove(self.image_path(k))
                except OSError:
                    pass
            if stale:
                self.save()
            return [dict(e, key=k, url=page_info(e["page"])[0]) for k, e in self.wanted.items()]


SIZE = re.compile(r"[1-9][0-9]{1,3}x[1-9][0-9]{1,3}")


def make_handler(state, public):
    class Handler(BaseHTTPRequestHandler):
        def send(self, code, body=b"", ctype="application/json", headers=()):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for h in headers:
                self.send_header(*h)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = urlsplit(self.path).path
            parts = [p for p in path.split("/") if p]
            if parts == ["internal", "wanted"]:
                return self.send(200, state.list())
            if len(parts) < 3 or parts[0] != "trmnl":
                return self.send(404, {"error": "not found"})
            page, rest = parts[1], parts[2:]
            info = page_info(page)
            if info is None:
                return self.send(404, {"status": 404, "error": f"no page {page!r}"})
            if rest == ["api", "setup"]:
                dev = (self.headers.get("ID") or "trmnl").replace(":", "")[-6:].upper()
                return self.send(200, {"status": 200, "api_key": "dwp", "friendly_id": dev,
                                       "image_url": None, "message": f"downwind.pro {page}"})
            if rest == ["api", "display"]:
                return self.display(page, info)
            if len(rest) == 1:                     # <WxH>-<hash>.<ext>
                m = re.fullmatch(r"(\d+x\d+)(?:-[0-9a-f]+)?\.(png|bmp)", rest[0])
                if m:
                    key = f"{page}/{m[1]}.{m[2]}"
                    try:
                        with open(state.image_path(key), "rb") as f:
                            data = f.read()
                    except OSError:
                        return self.send(404, {"error": "no image yet"})
                    return self.send(200, data, f"image/{m[2]}", [("Cache-Control", "no-cache")])
            return self.send(404, {"error": "not found"})

        def display(self, page, info):
            w, h = self.headers.get("Width"), self.headers.get("Height")
            size = f"{w}x{h}"
            if not SIZE.fullmatch(size):
                return self.send(400, {"status": 400, "error": "send the panel size in Width and Height headers"})
            fmt = "bmp" if (self.headers.get("Format") or "").lower() == "bmp" else "png"
            e = state.ask(page, size, fmt)
            now = time.time()
            nxt = next_wake(now, e["updated"], info[1], info[2])
            body = {
                "status": 0,
                "refresh_rate": max(MIN_SLEEP, round(nxt - now)),
                "next_wake": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(nxt + TZ)),
            }
            if e["updated"] is not None:
                body["image_url"] = f"{public}/trmnl/{page}/{size}-{e['hash']}.{fmt}"
                body["filename"] = f"{page}-{e['hash']}"
            return self.send(200, body)

        def do_POST(self):
            # TRMNL firmware POSTs its logs to .../api/log; nothing keeps them.
            self.rfile.read(int(self.headers.get("Content-Length") or 0))
            self.send(204)

        def do_PUT(self):
            parts = [p for p in urlsplit(self.path).path.split("/") if p]
            if len(parts) == 4 and parts[:2] == ["internal", "image"]:
                data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if not data:
                    return self.send(400, {"error": "empty image"})
                if state.put(f"{parts[2]}/{parts[3]}", data):
                    return self.send(204)
            return self.send(404, {"error": "not on the wanted list"})

        def log_message(self, fmt, *args):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("state_dir")
    ap.add_argument("--port", type=int, default=8893)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--public", default="https://api.downwind.pro")
    a = ap.parse_args()
    os.makedirs(a.state_dir, exist_ok=True)
    srv = ThreadingHTTPServer((a.bind, a.port), make_handler(State(a.state_dir), a.public.rstrip("/")))
    srv.serve_forever()


if __name__ == "__main__":
    main()
