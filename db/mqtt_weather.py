"""Live wind from the weather/+ MQTT feed, for matrix-bot.

The lake's wind table is filled about every half hour; the station feed on
the LAN broker is a reading a minute or so. Weather.start() subscribes to
weather/+ in a background thread and keeps each station's last few hours,
so !conditions and the bot's status can say what it's doing right now.

A message looks like (avg/gust/lull in knots, stamp Hawaii local time):

    weather/kihei {"avg":9.56,"gust":13.9,"lull":5.21,"dir_card":"N",
                   "dir_deg":7,"stamp":"2026-10-11T19:52:35","label":"Kihei",
                   "aux1":"","aux2":"0952L0.6~1524H1.7","shortLabel":"kihei"}

A bare MQTT 3.1.1 client (QoS 0, subscribe only), since db/ sticks to the
Python standard library.
"""

import json
import queue
import re
import socket
import struct
import sys
import threading
import time
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

HST = ZoneInfo("Pacific/Honolulu")
KEEP = 24 * 3600  # seconds of readings kept per station (the live object's span)
KEEPALIVE = 60
TIDE = re.compile(r"(\d{2})(\d{2})([HL])(-?[\d.]+)")


def log(msg):
    print(f"{time.strftime('%F %T')} mqtt: {msg}", file=sys.stderr, flush=True)


def _str(s):
    b = s.encode()
    return struct.pack(">H", len(b)) + b


def _packet(kind, body):
    n, length = len(body), b""
    while True:
        n, digit = divmod(n, 128)
        length += bytes([digit | (0x80 if n else 0)])
        if not n:
            return bytes([kind]) + length + body


def _read(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("broker closed the connection")
        buf += chunk
    return buf


def _next(sock):
    """(packet type byte, body) of the next packet."""
    kind = _read(sock, 1)[0]
    n, shift = 0, 0
    while True:
        digit = _read(sock, 1)[0]
        n += (digit & 0x7F) << shift
        shift += 7
        if not digit & 0x80:
            return kind, _read(sock, n)


def tides(aux):
    """[(epoch, 'H' or 'L', feet)] from an aux string like 0952L0.6~1524H1.7,
    each time today in Hawaii."""
    today = datetime.now(HST).date()
    out = []
    for hh, mm, hl, ft in TIDE.findall(aux or ""):
        t = datetime(today.year, today.month, today.day, int(hh), int(mm), tzinfo=HST)
        out.append((t.timestamp(), hl, float(ft)))
    return out


# Node-RED's run rating (run-recs/node-red-rating.md), retained:
# {"stamp": ISO UTC, "rec": "Kīhei" | "north shore" | "either; ..." | "no can",
#  "kihei": 0-4, "ns": 0-4}. Under weather/ too, in case it moves there.
RATING_TOPICS = ("conditions/rating", "weather/conditions/rating")


class Weather:
    def __init__(self, host, port=1883, topics=("weather/+",) + RATING_TOPICS):
        self.host, self.port, self.topics = host, port, topics
        self.ratings = queue.Queue()  # rating dicts, for the bot's main loop
        self.lock = threading.Lock()
        self.readings = {}  # site -> deque of reading dicts, oldest first
        self.extra = {}  # site -> the latest message's label, aux1, aux2
        self.changed = threading.Event()  # set by each new reading or rating
        self.rating = None  # the latest rating message, as published

    def start(self):
        threading.Thread(target=self.run, name="mqtt", daemon=True).start()
        return self

    def run(self):
        backoff = 5
        while True:
            began = time.time()
            try:
                self.listen()
            except (OSError, ConnectionError, ValueError) as e:
                if time.time() - began > 300:
                    backoff = 5  # it was working: retry soon
                log(f"{self.host}:{self.port}: {e}; retrying in {backoff}s")
            time.sleep(backoff)
            backoff = min(backoff * 2, 300)

    def listen(self):
        with socket.create_connection((self.host, self.port), timeout=KEEPALIVE / 2) as s:
            client = f"dwp-matrix-bot-{int(time.time())}"
            s.sendall(_packet(0x10, _str("MQTT") + bytes([4, 0x02]) +
                              struct.pack(">H", KEEPALIVE) + _str(client)))
            kind, body = _next(s)
            if kind >> 4 != 2 or body[1] != 0:
                raise ConnectionError(f"connect refused ({body[1:2].hex()})")
            s.sendall(_packet(0x82, struct.pack(">H", 1) +
                              b"".join(_str(t) + b"\0" for t in self.topics)))
            log(f"subscribed to {', '.join(self.topics)} on {self.host}")
            heard = time.time()
            while True:
                try:
                    kind, body = _next(s)
                    heard = time.time()
                except socket.timeout:
                    if time.time() - heard > 2 * KEEPALIVE:
                        raise ConnectionError("broker stopped answering")
                    s.sendall(b"\xc0\0")  # PINGREQ, answered with PINGRESP
                    continue
                if kind >> 4 == 3:
                    n = struct.unpack(">H", body[:2])[0]
                    topic = body[2:2 + n].decode()
                    rest = body[2 + n + (2 if kind & 0x06 else 0):]
                    self.take(topic, rest)

    def take(self, topic, payload):
        if topic in RATING_TOPICS:
            try:
                m = json.loads(payload)
                r = {"t": datetime.fromisoformat(m["stamp"].replace("Z", "+00:00")).timestamp(),
                     "rec": str(m["rec"]), "kihei": float(m["kihei"]), "ns": float(m["ns"])}
            except (ValueError, KeyError, TypeError) as e:
                log(f"skipping {topic}: {e}")
                return
            self.ratings.put(r)
            with self.lock:
                if self.rating is None or r["t"] > self.rating["t"]:
                    self.rating = r
            self.changed.set()
            return
        try:
            m = json.loads(payload)
            site = m.get("shortLabel") or topic.rsplit("/", 1)[-1]
            t = datetime.fromisoformat(m["stamp"]).replace(tzinfo=HST).timestamp()
            r = {"t": t, "wavg": float(m["avg"]), "wgust": float(m["gust"]),
                 "wlull": None if m.get("lull") is None else float(m["lull"]),  # Wailea has none
                 "wdir": float(m["dir_deg"]), "live": True}
        except (ValueError, KeyError, TypeError) as e:
            log(f"skipping {topic}: {e}")
            return
        with self.lock:
            q = self.readings.setdefault(site, deque())
            if q and q[-1]["t"] >= t:
                return
            q.append(r)
            while q and q[0]["t"] < t - KEEP:
                q.popleft()
            self.extra[site] = {k: m.get(k, "") for k in ("label", "aux1", "aux2")}
        self.changed.set()

    def seed(self, site, rows):
        """Older readings (from the lake) under whatever the feed has."""
        cutoff = time.time() - KEEP
        with self.lock:
            q = self.readings.setdefault(site, deque())
            first = q[0]["t"] if q else float("inf")
            q.extendleft(reversed([r for r in rows if cutoff <= r["t"] < first]))

    def recent(self):
        """site -> list of readings, oldest first."""
        with self.lock:
            return {site: list(q) for site, q in self.readings.items()}

    def snapshot(self):
        """The live object: every station's last 24 hours, compactly, and
        Node-RED's latest run rating (or None)."""
        with self.lock:
            stations = {
                site: {"label": self.extra.get(site, {}).get("label") or site,
                       "cols": ["ts", "avg", "gust", "lull", "dir"],
                       "readings": [[datetime.fromtimestamp(r["t"], HST).isoformat(timespec="seconds"),
                                     r["wavg"], r["wgust"], r["wlull"], round(r["wdir"])] for r in q]}
                for site, q in self.readings.items() if q}
            aux = {site: e for site, e in self.extra.items()}
            r = self.rating
        rating = r and {"stamp": datetime.fromtimestamp(r["t"], HST).isoformat(timespec="seconds"),
                        "rec": r["rec"], "kihei": r["kihei"], "ns": r["ns"]}
        newest = max((q["readings"][-1][0] for q in stations.values()), default=None)
        return {"updated": newest, "stations": stations, "rating": rating,
                "tides": {site: e["aux2"] for site, e in aux.items() if tides(e.get("aux2"))}}

    def info(self, site):
        with self.lock:
            return dict(self.extra.get(site, {}))
