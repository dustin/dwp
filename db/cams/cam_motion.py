"""Measure each cam's water motion now and publish it over MQTT.

For each cam in cams.py, in turn (one stream session at a time, closed before
the next), grabs the latest few seconds of its HLS stream, runs water_motion's
optical flow on it, and publishes (retained) to weather/conditions/<cam>_motion:

    {"stamp": ISO UTC, "dx": px/s, "dy": px/s, "left": share, "right": share,
     "pairs": n, "seconds": clip length, "whitecaps": patches (whitecaps.py)}

dx < 0 is right to left in the picture (energy running down the coast toward
Makena); dy > 0 is toward the beach. With --log DIR (where {cam} becomes the
cam's name) it also appends each reading (skips included) to DIR/motion.jsonl
and keeps an arrow overlay per reading as DIR/<stamp>-flow.jpg; db/cam-ingest
puts both in the lake, db/publish the images in S3.
It skips a cam's video (publishing {"stamp", "skipped": "<station> light"})
while the station that cam watches for (its "gate" in cams.py, weather/<gate>)
reads under 9 kn. An AlertWest panorama cam ("alertwest" in cams.py) has no
motion and no gate: each round just keeps the crops of its latest panorama
in its --log dir as <stamp>-<kind>.jpg. Run it every 10 min in daylight
(launchd/cron); the streams are up 05:00-19:30 HST.

    cam-motion --mqtt bee1 [--cam wailea --cam ulua] [--log ~/.cache/{cam}-motion] [--segments 3]

Packaged with OpenCV and numpy in default.nix (`cam-motion`); hm-module.nix runs it.
"""
import argparse, json, os, re, socket, ssl, struct, sys, tempfile, time, urllib.parse, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import water_motion  # noqa: E402
import whitecaps  # noqa: E402
from cams import CAMS  # noqa: E402

RELAY = "https://relay.ozolio.com/ses.api"
ALERTWEST = "https://alertwest.live/api/panorama/list/byCamId"
ALERTWEST_IMG = "https://img.cdn.prod.alertwest.com/data/img"
PANO_STALE = 3600  # s; an older panorama means the camera is down
UA = "Mozilla/5.0"  # init 403s without a browser-ish agent
LIGHT_MIN = 9  # kn; under this a side is LIGHT in the run rating (floor 12 - 3)


def get(url, params=None, ctx=None, referer=None):
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {"User-Agent": UA}
    if referer:
        headers["Referer"] = referer
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30, context=ctx) as r:
        return r.read()


def tls(cam):
    """An SSL context for cam: the usual roots, plus cam["intermediate"]
    (a PEM in this directory) for a server that leaves it out of its chain."""
    if not cam.get("intermediate"):
        return None
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(os.path.join(os.path.dirname(os.path.abspath(__file__)), cam["intermediate"]))
    return ctx


def segments(src, n, get):
    """The last n segments of an HLS playlist, following a master playlist to
    its (last) media playlist: [(seconds, url)]."""
    playlist = get(src).decode()
    sub = [l for l in playlist.splitlines() if l and not l.startswith("#")]
    if sub and ".m3u8" in sub[0]:
        src = urllib.parse.urljoin(src, sub[-1])
        playlist = get(src).decode()
    lines = playlist.splitlines()
    return [(float(re.match(r"#EXTINF:([\d.]+)", lines[i]).group(1)), urllib.parse.urljoin(src, lines[i + 1]))
            for i in range(len(lines) - 1) if lines[i].startswith("#EXTINF")][-n:]


def join(segs, get):
    """Download segs into one .ts file; (path, seconds)."""
    fd, path = tempfile.mkstemp(suffix=".ts")
    with os.fdopen(fd, "wb") as f:
        for _, url in segs:
            f.write(get(url))
    return path, sum(d for d, _ in segs)


def init(cam):
    """The Ozolio ses.api init parameters for a cams.py entry."""
    p = {"cmd": "init", "oid": cam["oid"], "ver": "5", "channel": "0", "control": "1",
         "document": "https://www.ozolio.com/explore/" + cam["oid"].removeprefix("CID_")}
    if cam.get("directory"):
        p["directory"] = cam["directory"]
    return p


def clip(cam, n):
    """The latest n HLS segments of cam joined into one .ts file; (path, seconds).
    A cam with "hls" is a plain HLS URL; otherwise it's an Ozolio camera,
    opened (and closed again) through its session API."""
    if cam.get("hls"):
        ctx = tls(cam)
        g = lambda url: get(url, ctx=ctx, referer=cam.get("referer"))  # noqa: E731
        return join(segments(cam["hls"], n, g), g)
    sid = json.loads(get(RELAY, init(cam)))["session"]["id"]
    try:
        src = json.loads(get(RELAY, {"cmd": "open", "oid": sid, "output": "1",
                                     "format": "M3U8", "profile": "AUTO"}))["output"]["source"]
        return join(segments(src, n, get), get)
    finally:
        try:
            get(RELAY, {"cmd": "close", "oid": sid})
        except OSError:
            pass


def caps(path, cam, n=5):
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
            counts.append(whitecaps.measure(f, cam["caps"], cam["caps_mask"])[1])
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
                     + utf(f"cam-motion-{os.getpid()}")))
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


def light(host, station):
    """True when the station's latest reading (weather/<station>) is under
    LIGHT_MIN kn: no run worth watching for, so no point measuring. Any
    trouble reading it counts as not light, so the measurement still runs."""
    try:
        m = json.loads(retained(host, f"weather/{station}") or b"{}")
        return float(m["avg"]) < LIGHT_MIN
    except (OSError, ValueError, KeyError, TypeError):
        return False


def log(d, line):
    d = os.path.expanduser(d)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "motion.jsonl"), "a") as f:
        f.write(line + "\n")


def measure(name, a):
    """Measure one cam and publish/log the reading."""
    cam, topic = CAMS[name], f"weather/conditions/{name}_motion"
    d = os.path.expanduser(a.log.format(cam=name)) if a.log else None
    path, seconds = clip(cam, a.segments)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    overlay = None
    if d:
        os.makedirs(d, exist_ok=True)
        overlay = os.path.join(d, stamp.replace(":", "") + "-flow.jpg")
    try:
        m = (water_motion.measure(path, overlay, cam["water"], cam["land"])
             or {"dx": 0.0, "dy": 0.0, "left": 0.0, "right": 0.0, "pairs": 0})
        m["whitecaps"] = caps(path, cam)
    finally:
        os.unlink(path)
    line = json.dumps({"stamp": stamp, **m, "seconds": round(seconds, 1)})
    print(name, line)
    if d:
        log(d, line)
    if a.mqtt:
        publish(a.mqtt, topic, line)


def pano(name, a):
    """Keep the crops of an AlertWest cam's latest panorama (cams.py "crops")
    as <stamp>-<kind>.jpg in its --log dir, stamped when the panorama was
    taken. Without --log, just say which panorama it would crop."""
    import cv2
    import numpy as np
    cam = CAMS[name]
    cid = str(cam["alertwest"])
    cur = json.loads(get(ALERTWEST, {"camId": cid, "timestamp": ""}))["data"][cid]["cur"]
    taken = datetime.fromtimestamp(int(cur["cmlg_timestamp"]), timezone.utc)
    if time.time() - taken.timestamp() > PANO_STALE:
        raise OSError(f"latest panorama is from {taken:%Y-%m-%d %H:%M}Z")
    stamp = taken.strftime("%Y-%m-%dT%H%M%SZ")
    url = f"{ALERTWEST_IMG}/{cid}/{taken:%Y/%m/%d}/{cur['cmlg_img_name']}"
    print(name, stamp, url)
    if not a.log:
        return
    d = os.path.expanduser(a.log.format(cam=name))
    os.makedirs(d, exist_ok=True)
    paths = {k: os.path.join(d, f"{stamp}-{k}.jpg") for k in cam["crops"]}
    if all(os.path.exists(p) for p in paths.values()):
        return  # no new panorama since last round
    img = cv2.imdecode(np.frombuffer(get(url), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise OSError(f"can't decode {url}")
    for k, (x, y, w, h) in cam["crops"].items():
        cv2.imwrite(paths[k], img[y:y + h, x:x + w], [cv2.IMWRITE_JPEG_QUALITY, 90])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mqtt", help="broker host; without it, just print")
    ap.add_argument("--cam", action="append", choices=sorted(CAMS),
                    help="cam to measure (repeatable; default all)")
    ap.add_argument("--log", help="directory for motion.jsonl and overlays; {cam} is the cam's name")
    ap.add_argument("--segments", type=int, default=3)
    ap.add_argument("--any-time", action="store_true", help="run outside 05:30-19:00 HST too")
    a = ap.parse_args()
    names = a.cam or sorted(CAMS)
    if a.log and len(names) > 1 and "{cam}" not in a.log:
        ap.error("--log needs {cam} in it when measuring more than one cam")
    hst = datetime.fromtimestamp(time.time() - 10 * 3600, timezone.utc)
    if not a.any_time and not 5.5 <= hst.hour + hst.minute / 60 < 19:
        return  # the streams are dark or down; launchd can fire every 10 min all day
    lights = {}  # station -> light?, read once per round
    failed = False
    for name in names:  # one at a time: never two stream sessions open at once
        if CAMS[name].get("alertwest"):
            try:
                pano(name, a)
            except Exception as e:
                print(f"{name}: {e!r}", file=sys.stderr)
                failed = True
            continue
        gate = CAMS[name].get("gate", "kihei")
        if a.mqtt and not a.any_time:
            if gate not in lights:
                lights[gate] = light(a.mqtt, gate)
            if lights[gate]:
                # No run worth watching for; say so rather than leave an older
                # reading standing. (The vision read isn't used: it calls
                # small, clearly moving water "glassy".)
                line = json.dumps({"stamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                   "skipped": f"{gate} light"})
                publish(a.mqtt, f"weather/conditions/{name}_motion", line)
                if a.log:
                    log(a.log.format(cam=name), line)
                continue
        try:
            measure(name, a)
        except Exception as e:  # one cam being down shouldn't stop the others
            print(f"{name}: {e!r}", file=sys.stderr)
            failed = True
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
