"""Measure the Wailea cam's water motion now and publish it over MQTT.

Grabs the latest few seconds of the Ozolio HLS stream, runs water_motion's
optical flow on it, and publishes (retained) to weather/conditions/wailea_motion:

    {"stamp": ISO UTC, "dx": px/s, "dy": px/s, "left": share, "right": share,
     "pairs": n, "seconds": clip length}

dx < 0 is right to left in the picture (energy running down the coast toward
Makena); dy > 0 is toward the beach. With --log DIR it also appends each reading
to DIR/motion.jsonl and keeps an arrow overlay per reading, for calibration.
Run it every 10 min in daylight (launchd/cron); the stream is up 05:00-19:30 HST.

    python3 wailea_motion.py --mqtt bee1 [--log ~/wailea-motion] [--segments 3]

Needs opencv-python-headless and numpy.
"""
import argparse, json, os, re, socket, struct, sys, tempfile, time, urllib.parse, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import water_motion  # noqa: E402

RELAY = "https://relay.ozolio.com/ses.api"
UA = "Mozilla/5.0"  # init 403s without a browser-ish agent
INIT = {"cmd": "init", "oid": "CID_XWEE00001592", "ver": "5", "channel": "0", "control": "1",
        "document": "https://www.ozolio.com/explore/XWEE00001592", "directory": "DIR_0DEF00000001"}
TOPIC = "weather/conditions/wailea_motion"


def get(url, params=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def clip(n):
    """The latest n HLS segments joined into one .ts file; (path, seconds)."""
    sid = json.loads(get(RELAY, INIT))["session"]["id"]
    try:
        src = json.loads(get(RELAY, {"cmd": "open", "oid": sid, "output": "1",
                                     "format": "M3U8", "profile": "AUTO"}))["output"]["source"]
        playlist = get(src).decode()
        # A master playlist names its chunklist; a media playlist names segments.
        sub = [l for l in playlist.splitlines() if l and not l.startswith("#")]
        if sub and ".m3u8" in sub[0]:
            src = urllib.parse.urljoin(src, sub[-1])
            playlist = get(src).decode()
        lines = playlist.splitlines()
        segs = [(float(re.match(r"#EXTINF:([\d.]+)", lines[i]).group(1)), urllib.parse.urljoin(src, lines[i + 1]))
                for i in range(len(lines) - 1) if lines[i].startswith("#EXTINF")][-n:]
        fd, path = tempfile.mkstemp(suffix=".ts")
        with os.fdopen(fd, "wb") as f:
            for _, url in segs:
                f.write(get(url))
        return path, sum(d for d, _ in segs)
    finally:
        try:
            get(RELAY, {"cmd": "close", "oid": sid})
        except OSError:
            pass


def publish(host, topic, payload, port=1883):
    """One retained QoS 0 publish, stdlib only."""
    def utf(s):
        b = s.encode()
        return struct.pack(">H", len(b)) + b

    def packet(kind, body):
        n, rem = len(body), b""
        while True:
            n, d = n >> 7, n & 0x7F
            rem += bytes([d | (0x80 if n else 0)])
            if not n:
                return bytes([kind]) + rem + body

    with socket.create_connection((host, port), timeout=10) as s:
        s.sendall(packet(0x10, utf("MQTT") + bytes([4, 2]) + struct.pack(">H", 30)
                         + utf(f"wailea-motion-{os.getpid()}")))
        if s.recv(4)[:1] != b"\x20":
            raise OSError("MQTT connect refused")
        s.sendall(packet(0x31, utf(topic) + payload.encode()))  # PUBLISH, retain
        s.sendall(b"\xe0\x00")  # DISCONNECT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mqtt", help="broker host; without it, just print")
    ap.add_argument("--log", help="directory for motion.jsonl and overlays")
    ap.add_argument("--segments", type=int, default=3)
    ap.add_argument("--any-time", action="store_true", help="run outside 05:30-19:00 HST too")
    a = ap.parse_args()
    hst = datetime.fromtimestamp(time.time() - 10 * 3600, timezone.utc)
    if not a.any_time and not 5.5 <= hst.hour + hst.minute / 60 < 19:
        return  # the stream is dark or down; launchd can fire every 10 min all day
    path, seconds = clip(a.segments)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    overlay = None
    if a.log:
        os.makedirs(os.path.expanduser(a.log), exist_ok=True)
        overlay = os.path.join(os.path.expanduser(a.log), stamp.replace(":", "") + ".jpg")
    try:
        m = water_motion.measure(path, overlay) or {"dx": 0.0, "dy": 0.0, "left": 0.0, "right": 0.0, "pairs": 0}
    finally:
        os.unlink(path)
    m = {"stamp": stamp, **m, "seconds": round(seconds, 1)}
    line = json.dumps(m)
    print(line)
    if a.log:
        with open(os.path.join(os.path.expanduser(a.log), "motion.jsonl"), "a") as f:
            f.write(line + "\n")
    if a.mqtt:
        publish(a.mqtt, TOPIC, line)


if __name__ == "__main__":
    main()
