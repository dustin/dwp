"""When to tell the rooms a data source has gone quiet, and when it's back,
for matrix-bot.

Each source has a newest-reading time (the bot works it out: the live feed
for wind, the run rating and the cams, the lake for buoys), how old that can
get before the source counts as offline, and the HST hours when it's
expected to be reporting, so nights and the cams' dark hours aren't outages.
Watch.see() takes {key: newest epoch, or None for nothing at all, or a
missing key for "couldn't tell"} and returns what to say: a source is
announced once when it goes offline (only inside its hours) and once when it
comes back (any time) with BACK_AFTER new readings, so one stray reading
from a failing station isn't "back". The state is saved, so a restart doesn't repeat it.
"""

import json
import os
import time

BACK_AFTER = 2  # new readings that make a source back online (the buoy's are hourly: 1)

# key: (name, stale after seconds, watched from HST hour, to HST hour, note)
SOURCES = {
    "pauwela": ("Pauwela buoy", 3 * 3600, 0, 24, ""),
    "kihei": ("Kīhei wind", 30 * 60, 7, 18, ""),
    "hookipa": ("Hoʻokipa wind", 60 * 60, 7, 18, ""),
    "kanaha": ("Kanaha wind", 30 * 60, 7, 18, ""),
    "wailea": ("Wailea wind", 30 * 60, 7.5, 17.5, ""),
    # The cams are measured every 10 min from 05:30 to 19:00, light wind
    # included (it publishes a skip), so a gap means the cam or its reader.
    "cam:wailea": ("Wailea cam", 40 * 60, 6.25, 18.75, ""),
    "cam:ulua": ("Ulua cam", 40 * 60, 6.25, 18.75, ""),
    "cam:poolenalena": ("Poʻolenalena cam", 40 * 60, 6.25, 18.75, ""),
    # Rated about every 10 min from 07:00 to 17:00.
    "rating": ("The run rating", 30 * 60, 7.5, 17, " No run alerts until it's back."),
}


class Watch:
    def __init__(self, path):
        self.path = path
        try:
            with open(path) as fh:
                # key -> {"t": newest epoch when it went down (or None),
                #         "seen": newer readings' epochs since}
                self.down = {k: v if isinstance(v, dict) else {"t": v, "seen": []}
                             for k, v in json.load(fh).items()}
        except (FileNotFoundError, ValueError):
            self.down = {}

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.down, fh)
        os.replace(tmp, self.path)

    def see(self, newest, hst_hour, now=None):
        """[(kind, key, epoch)] for newest ({key: epoch or None}) at hst_hour
        (a float): kind "down" (epoch the last reading, or None) or "back"
        (epoch the new reading)."""
        now = time.time() if now is None else now
        out, changed = [], False
        for key, (_, stale, start, end, _) in SOURCES.items():
            if key not in newest:
                continue
            t = newest[key]
            fresh = t is not None and now - t <= stale
            down = self.down.get(key)
            if down and fresh:
                if t not in down["seen"] and t > (down["t"] or 0):
                    down["seen"].append(t)
                    changed = True
                if len(down["seen"]) >= (1 if key == "pauwela" else BACK_AFTER):
                    del self.down[key]
                    out.append(("back", key, t))
            elif not down and not fresh and start <= hst_hour < end:
                self.down[key] = {"t": t, "seen": []}
                out.append(("down", key, t))
            elif down and not fresh and down["seen"]:
                down["seen"] = []  # a stray reading that went stale again
                changed = True
        if out or changed:
            self.save()
        return out


def message(kind, key, t, when, reading=None):
    """The announcement; when formats an epoch as the bot does, reading is
    what a source that's back just read ("18g24 @75")."""
    name, *_, note = SOURCES[key]
    if kind == "back":
        return f"✅ {name} is back online: {reading or 'new readings'} at {when(t)}."
    since = f"nothing new since {when(t)}" if t else "no recent readings"
    return f"⚠️ {name} is offline: {since}.{note}"
