"""Each trackpoint's average speed over the kilometre before it, for
dws.avg_speed_1k: the mean speed of the run's points whose distance is
within 1000 m back from (and up to) this one's, like the correlated
subquery import.sql used to run, which compared every point with every
other (tens of millions of comparisons on a long run). dwp_publish.import_sql
sends the answers with the trackpoints.
"""

import bisect
import math


def avg_speed_1k(points, window=1000.0):
    """[avg] for each (distance, speed) in points: the mean of the non-null
    speeds of the points with window back <= distance <= this distance
    (None when this distance is missing or no such point has a speed)."""
    have = sorted(((d, s) for d, s in points if d is not None), key=lambda p: p[0])
    ds = [d for d, _ in have]
    out = []
    for d, _ in points:
        if d is None:
            out.append(None)
            continue
        lo = bisect.bisect_left(ds, d - window)
        hi = bisect.bisect_right(ds, d)
        speeds = [s for _, s in have[lo:hi] if s is not None]
        out.append(math.fsum(speeds) / len(speeds) if speeds else None)
    return out
