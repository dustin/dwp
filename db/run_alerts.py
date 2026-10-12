"""When to tell the room a run is getting good, for matrix-bot.

Node-RED rates each side about every 10 minutes during the day (0-4: 0 not a
downwinder, 2 doable, 3 good, 4 really good; run-recs/node-red-rating.md)
and publishes it, retained, on conditions/rating. Alerts.see() takes each
rating and returns what to say, if anything (scores shown out of 10), so the
room hears about a run
as it shapes up and not on every reading:

  * each side climbs through levels: "worth considering" at CONSIDER
    (1.5, about doable), "looking good" at GOOD (2.8) and "really good" at
    REALLY (3.8), and the room hears once per level it reaches;
  * levels drop back with some slack (below 1.0, 2.0 and 3.0), so a score
    wobbling around a threshold says nothing new;
  * a side that comes back within COOLDOWN of dropping to nothing does so
    quietly, so a flapping afternoon is one message, not five;
  * when every side that was announced has dropped to nothing, one
    "dropping off".

Ratings older than STALE (a retained one after a restart, say) are only
used to catch up the state, never announced. The state is saved to a file,
so a restart doesn't announce the same session again.
"""

import json
import os
import time

CONSIDER, GOOD, REALLY = 1.5, 2.8, 3.8
UP = (CONSIDER, GOOD, REALLY)  # score to reach level 1, 2, 3
DOWN = (1.0, 2.0, 3.0)  # below these, level 1, 2, 3 drops a level
KINDS = (None, "consider", "on", "really")
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
            st = self.state.setdefault(side, {})
            st.pop("on", None), st.pop("really", None)  # the pre-levels state
            st.setdefault("level", 0)  # 0 nothing, 1 consider, 2 good, 3 really
            st.setdefault("said", 0)  # highest level announced since it was 0
            st.setdefault("off_at", 0)

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.state, fh)
        os.replace(tmp, self.path)

    def see(self, rating, now=None):
        """[(kind, sides)] to announce for this rating: kind is "consider",
        "on", "really" or "off", sides the SIDES keys it's about."""
        now = time.time() if now is None else now
        if rating["t"] <= self.state["t"]:
            return []
        self.state["t"] = rating["t"]
        quiet = now - rating["t"] > STALE
        # Sides the room has heard about (not ones that came back quietly).
        was_on = [s for s in SIDES if self.state[s]["said"] and not self.state[s].get("hushed")]
        rose = {}  # kind -> sides
        for side in SIDES:
            st, score = self.state[side], rating[side]
            up = sum(score >= u for u in UP)
            if up > st["level"]:
                st["level"] = up
            else:
                while st["level"] and score < DOWN[st["level"] - 1]:
                    st["level"] -= 1
            if st["level"] > st["said"]:
                back = not st["said"] and now - st["off_at"] < COOLDOWN
                st["said"] = st["level"]
                st["hushed"] = back
                if not back:  # else it's back on, quietly
                    rose.setdefault(KINDS[st["level"]], []).append(side)
            elif not st["level"] and st["said"]:
                st.update(said=0, off_at=now, hushed=False)
        self.save()
        if quiet:
            return []
        out = [(k, rose[k]) for k in KINDS[1:] if k in rose]
        if was_on and not any(self.state[s]["said"] for s in SIDES):
            out.append(("off", was_on))
        return out


def out_of_10(score):
    """Node-RED's 0-4 score as Dustin reads it: out of 10."""
    return f"{score * 2.5:.0f}/10"


def message(kind, sides, rating, wind_lines):
    """The announcement's text. wind_lines: side -> [line] of its stations."""
    names = " and ".join(SIDES[s] if i == 0 else SIDES[s].lower() for i, s in enumerate(sides))
    scores = ", ".join(out_of_10(rating[s]) for s in sides)
    if kind == "off":
        return (f"{names} {'is' if len(sides) == 1 else 'are'} dropping off ("
                + ", ".join(f"{SIDES[s]} {out_of_10(rating[s])}" for s in SIDES) + ").")
    verb = "is" if len(sides) == 1 else "are"
    head = {"consider": f"🤔 {names} {verb} worth considering ({scores})",
            "on": f"🤙 {names} {verb} looking good ({scores})",
            "really": f"🔥 {names} {verb} really good now ({scores})"}[kind]
    rec = rating["rec"]
    lines = [head + (f" · {rec}" if rec.startswith("either") else "")]
    for s in sides:
        lines += wind_lines.get(s, [])
    return "\n".join(lines)
