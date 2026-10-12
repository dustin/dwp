"""When to tell the room a run is getting good, for matrix-bot.

Node-RED rates each side about every 10 minutes during the day (0-4: 0 not a
downwinder, 2 doable, 3 good, 4 really good; run-recs/node-red-rating.md)
and publishes it, retained, on conditions/rating. Alerts.see() takes each
rating and returns what to say, if anything, so the room hears about a run
as it shapes up and not on every reading:

  * a side "turns on" at GOOD (2.8) and only "turns off" below OFF (2.0),
    so a score wobbling around 3 says nothing new;
  * turning on says so once ("Kīhei is looking good (3.2/4)"); a side
    that turns on again within COOLDOWN of turning off does so quietly,
    so a flapping afternoon is one message, not five;
  * a side that's on and reaches REALLY (3.8) says so once more;
  * when every side that was on has turned off, one "dropping off".

Ratings older than STALE (a retained one after a restart, say) are only
used to catch up the state, never announced. The state is saved to a file,
so a restart doesn't announce the same session again.
"""

import json
import os
import time

GOOD, OFF, REALLY = 2.8, 2.0, 3.8
COOLDOWN = 60 * 60
STALE = 30 * 60
SIDES = {"kihei": "Kīhei", "ns": "North shore"}


class Alerts:
    def __init__(self, path):
        self.path = path
        try:
            with open(path) as fh:
                self.state = json.load(fh)
        except (FileNotFoundError, ValueError):
            self.state = {}
        self.state.setdefault("t", 0)
        for side in SIDES:
            self.state.setdefault(side, {"on": False, "really": False, "off_at": 0})

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.state, fh)
        os.replace(tmp, self.path)

    def see(self, rating, now=None):
        """[(kind, sides)] to announce for this rating: kind is "on",
        "really" or "off", sides the SIDES keys it's about."""
        now = time.time() if now is None else now
        if rating["t"] <= self.state["t"]:
            return []
        self.state["t"] = rating["t"]
        quiet = now - rating["t"] > STALE
        was_on = [s for s in SIDES if self.state[s]["on"]]
        on, really = [], []
        for side in SIDES:
            st, score = self.state[side], rating[side]
            if not st["on"] and score >= GOOD:
                st.update(on=True, really=score >= REALLY)
                if now - st["off_at"] >= COOLDOWN:  # else it's back on, quietly
                    on.append(side)
            elif st["on"] and score < OFF:
                st.update(on=False, really=False, off_at=now)
            elif st["on"] and score >= REALLY and not st["really"]:
                st["really"] = True
                really.append(side)
        self.save()
        if quiet:
            return []
        out = []
        if on:
            out.append(("on", on))
        if really:
            out.append(("really", really))
        if was_on and not any(self.state[s]["on"] for s in SIDES):
            out.append(("off", was_on))
        return out


def message(kind, sides, rating, wind_lines):
    """The announcement's text. wind_lines: side -> [line] of its stations."""
    names = " and ".join(SIDES[s] if i == 0 else SIDES[s].lower() for i, s in enumerate(sides))
    scores = ", ".join(f"{rating[s]:.1f}/4" for s in sides)
    if kind == "off":
        return (f"{names} {'is' if len(sides) == 1 else 'are'} dropping off ("
                + ", ".join(f"{SIDES[s]} {rating[s]:.1f}" for s in SIDES) + ").")
    verb = "is" if len(sides) == 1 else "are"
    head = (f"🤙 {names} {verb} looking good ({scores})" if kind == "on" else
            f"🔥 {names} {verb} really good now ({scores})")
    rec = rating["rec"]
    lines = [head + (f" · {rec}" if rec.startswith("either") else "")]
    for s in sides:
        lines += wind_lines.get(s, [])
    return "\n".join(lines)
