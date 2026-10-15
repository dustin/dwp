"""Measure the Wailea cam's water motion now and publish it over MQTT.

Grabs the latest few seconds of the Ozolio HLS stream, runs water_motion's
optical flow on it, and publishes (retained) to weather/conditions/wailea_motion:

    {"stamp": ISO UTC, "dx": px/s, "dy": px/s, "left": share, "right": share,
     "pairs": n, "seconds": clip length, "whitecaps": patches (whitecaps.py)}

dx < 0 is right to left in the picture (energy running down the coast toward
Makena); dy > 0 is toward the beach. With --log DIR it also appends each reading
(skips included) to DIR/motion.jsonl and keeps an arrow overlay per reading as
DIR/<stamp>-flow.jpg; db/cam-ingest puts both in the lake, db/publish the images in S3.
It skips the video (publishing {"stamp", "skipped": "kihei light"}) while the
Kihei station (weather/kihei) reads under 9 kn. Run it every 10 min in daylight (launchd/cron); the stream is up 05:00-19:30 HST.

    wailea-motion --mqtt bee1 [--log ~/wailea-motion] [--segments 3]

Packaged with OpenCV and numpy in default.nix (`wailea-motion`); hm-module.nix runs it.
"""
import argparse, json, os, re, socket, struct, sys, tempfile, time, urllib.parse, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import water_motion  # noqa: E402
import whitecaps  # noqa: E402

RELAY = "https://relay.ozolio.com/ses.api"
UA = "Mozilla/5.0"  # init 403s without a browser-ish agent
INIT = {"cmd": "init", "oid": "CID_XWEE00001592", "ver": "5", "channel": "0", "control": "1",
        "document": "https://www.ozolio.com/explore/XWEE00001592", "directory": "DIR_0DEF00000001"}
TOPIC = "weather/conditions/wailea_motion"
KIHEI_TOPIC = "weather/kihei"
KIHEI_MIN = 9  # kn; under this Kihei is LIGHT in the run rating (floor 12 - 3)


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


def caps(path, n=5):
    """Whitecap patches (whitecaps.py) in the clip: the median over n frames
    spread through it, so one passing boat or glint doesn't count."""
    import cv2
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    counts = []
    for i in range(n):
        if total:
            cap.set(cv2.CAP_PROP_POS_FRAMES, (i + 0.5) * total / n)
        ok, f = cap.read()
        if ok:
            counts.append(whitecaps.measure(f)[1])
    return sorted(counts)[len(counts) // 2] if counts else None


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


def connect(host, port=1883):
    s = socket.create_connection((host, port), timeout=10)
    s.sendall(packet(0x10, utf("MQTT") + bytes([4, 2]) + struct.pack(">H", 30)
                     + utf(f"wailea-motion-{os.getpid()}")))
    if s.recv(4)[:1] != b"\x20":
        raise OSError("MQTT connect refused")
    return s


def publish(host, topic, payload):
    """One retained QoS 0 publish, stdlib only."""
    with connect(host) as s:
        s.sendall(packet(0x31, utf(topic) + payload.encode()))  # PUBLISH, retain
        s.sendall(b"\xe0\x00")  # DISCONNECT


def retained(host, topic, wait=3):
    """The retained message on topic, as bytes, or None."""
    with connect(host) as s:
        s.sendall(packet(0x82, struct.pack(">H", 1) + utf(topic) + b"\x00"))  # SUBSCRIBE
        s.settimeout(wait)
        buf, end = b"", time.time() + wait
        try:
            while time.time() < end:
                chunk = s.recv(65536)
                if not chunk:
                    break
                buf += chunk
                while len(buf) >= 2:  # walk whole packets
                    n, mult, i = 0, 1, 1
                    while buf[i] & 0x80:
                        n += (buf[i] & 0x7F) * mult
                        mult, i = mult * 128, i + 1
                        if i >= len(buf):
                            break
                    else:
                        n += buf[i] * mult
                        if len(buf) < i + 1 + n:
                            break
                        body, kind, buf = buf[i + 1:i + 1 + n], buf[0], buf[i + 1 + n:]
                        if kind >> 4 == 3:  # PUBLISH (QoS 0: no packet id)
                            tl = struct.unpack(">H", body[:2])[0]
                            return body[2 + tl:]
                        continue
                    break
        except socket.timeout:
            pass
        return None


def kihei_light(host):
    """True when the Kihei station's latest reading (weather/kihei) is under
    KIHEI_MIN kn: no north run to finish, so no point measuring. Any trouble
    reading it counts as not light, so the measurement still runs."""
    try:
        m = json.loads(retained(host, KIHEI_TOPIC) or b"{}")
        return float(m["avg"]) < KIHEI_MIN
    except (OSError, ValueError, KeyError, TypeError):
        return False


def log(d, line):
    d = os.path.expanduser(d)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "motion.jsonl"), "a") as f:
        f.write(line + "\n")


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
    if a.mqtt and not a.any_time and kihei_light(a.mqtt):
        # No north run worth finishing; say so rather than leave an older
        # reading standing. (The cam's vision read isn't used: it calls
        # small, clearly moving water "glassy".)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        line = json.dumps({"stamp": stamp, "skipped": "kihei light"})
        publish(a.mqtt, TOPIC, line)
        if a.log:
            log(a.log, line)
        return
    path, seconds = clip(a.segments)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    overlay = None
    if a.log:
        os.makedirs(os.path.expanduser(a.log), exist_ok=True)
        overlay = os.path.join(os.path.expanduser(a.log), stamp.replace(":", "") + "-flow.jpg")
    try:
        m = water_motion.measure(path, overlay) or {"dx": 0.0, "dy": 0.0, "left": 0.0, "right": 0.0, "pairs": 0}
        m["whitecaps"] = caps(path)
    finally:
        os.unlink(path)
    m = {"stamp": stamp, **m, "seconds": round(seconds, 1)}
    line = json.dumps(m)
    print(line)
    if a.log:
        log(a.log, line)
    if a.mqtt:
        publish(a.mqtt, TOPIC, line)


if __name__ == "__main__":
    main()
