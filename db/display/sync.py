"""Render what the display server's devices want (see server.py), and PUT
the images back. Run it every minute: it renders a new entry straight
away and the rest once per render slot (:13 and :43, 05:00-20:59 HST, just
after publish), so it costs one GET when there's nothing to do.

usage: sync.py SERVER RENDER     e.g. sync.py http://aws1:8893 dwp-display-render
"""

import json
import subprocess
import sys
import time
import urllib.request

PERIOD = 30 * 60
OFFSET = 13 * 60
TZ = -10 * 3600
HOURS = range(5, 21)          # HST hours with render slots


def last_slot(now):
    return (now - OFFSET) // PERIOD * PERIOD + OFFSET


def due(e, now):
    if e.get("updated") is None:
        return True
    if e.get("static"):                       # the same image every time: once is enough
        return False
    slot = last_slot(now)
    return ((slot + TZ) % 86400) // 3600 in HOURS and e["updated"] < slot


def main():
    server, render = sys.argv[1].rstrip("/"), sys.argv[2]
    with urllib.request.urlopen(f"{server}/internal/wanted", timeout=30) as r:
        wanted = json.load(r)
    now = int(time.time())
    status = 0
    for e in wanted:
        if not due(e, now):
            continue
        put = f"{server}/internal/image/{e['page']}/{e['size']}.{e['format']}"
        print(f"{e['key']}: {e['url']}", flush=True)
        status |= subprocess.call([render, e["size"], e["url"], put])
    sys.exit(1 if status else 0)


if __name__ == "__main__":
    main()
