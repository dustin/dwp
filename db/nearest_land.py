"""Each trackpoint's nearest point on land, for dws.nearest_land_lat/lon.

This used to be a LATERAL join of every point against coastline_swapped
with ST_ShortestLine in import.sql. Under DuckDB 2.0.1's spatial extension
that ran the database server out of memory on an ordinary run (2026-11-22),
so the importer works it out here instead, in plain Python, from
coastline.parquet (the same island polygons, lon/lat), and import.sql
takes the answers with the trackpoints (dwp_publish.import_sql).

Like ST_ShortestLine, a point on land is its own nearest land.
"""

import math
import os
import struct
import subprocess

DB_DIR = os.path.dirname(os.path.abspath(__file__))
COASTLINE = "coastline.parquet"

# Hawaii-sized, so a flat projection centred on 21N is plenty: metres.
COS_LAT = math.cos(math.radians(21))
KX = 111320.0 * COS_LAT
KY = 110574.0
CELL = 1000.0     # grid cell, metres
MAX_RINGS = 150   # past ~150 km from any coast, fall back to a coarse scan


def wkb_rings(buf):
    """The rings of a little- or big-endian 2D WKB (Multi)Polygon, as
    lists of (lon, lat)."""
    rings = []

    def geom(off):
        bo = "<" if buf[off] == 1 else ">"
        (typ,) = struct.unpack_from(bo + "I", buf, off + 1)
        off += 5
        if typ == 3:
            (nr,) = struct.unpack_from(bo + "I", buf, off)
            off += 4
            for _ in range(nr):
                (n,) = struct.unpack_from(bo + "I", buf, off)
                off += 4
                xs = struct.unpack_from(bo + f"{2 * n}d", buf, off)
                off += 16 * n
                rings.append(list(zip(xs[0::2], xs[1::2])))
            return off
        if typ == 6:
            (ng,) = struct.unpack_from(bo + "I", buf, off)
            off += 4
            for _ in range(ng):
                off = geom(off)
            return off
        raise ValueError(f"coastline: WKB type {typ}, expected (Multi)Polygon")

    geom(0)
    return rings


def load_rings(path=None):
    """coastline.parquet's rings via the duckdb CLI (no spatial needed)."""
    path = path or os.path.join(DB_DIR, COASTLINE)
    q = f"select hex(geom::blob) from read_parquet('{path}')"
    out = subprocess.run(["duckdb", "-noheader", "-csv", "-c", q], check=True,
                         capture_output=True, text=True).stdout
    rings = []
    for line in out.split():
        rings += wkb_rings(bytes.fromhex(line.strip().strip('"')))
    return rings


class Coast:
    def __init__(self, rings):
        self.edges = []          # (ax, ay, bx, by) in metres
        self.grid = {}           # (i, j) -> edge indexes whose bbox touches the cell
        self.rows = {}           # j -> edge indexes spanning that row, for inside tests
        for ring in rings:
            pts = [(lon * KX, lat * KY) for lon, lat in ring]
            for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
                if (ax, ay) == (bx, by):
                    continue
                k = len(self.edges)
                self.edges.append((ax, ay, bx, by))
                i0, i1 = sorted((int(ax // CELL), int(bx // CELL)))
                j0, j1 = sorted((int(ay // CELL), int(by // CELL)))
                for j in range(j0, j1 + 1):
                    self.rows.setdefault(j, []).append(k)
                    for i in range(i0, i1 + 1):
                        self.grid.setdefault((i, j), []).append(k)
        self.sparse = self.edges[::25]

    def inside(self, x, y):
        """Even-odd ray cast east over every ring: holes count, and the
        islands don't overlap."""
        n = 0
        for k in self.rows.get(int(y // CELL), ()):
            ax, ay, bx, by = self.edges[k]
            if (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay):
                n += 1
        return n % 2 == 1

    @staticmethod
    def closest(x, y, e):
        ax, ay, bx, by = e
        dx, dy = bx - ax, by - ay
        t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)
        t = 0.0 if t < 0 else 1.0 if t > 1 else t
        px, py = ax + t * dx, ay + t * dy
        return (px - x) ** 2 + (py - y) ** 2, px, py

    def nearest(self, lat, lon):
        """(lat, lon) of the nearest land, the point itself on land."""
        x, y = lon * KX, lat * KY
        if self.inside(x, y):
            return lat, lon
        ci, cj = int(x // CELL), int(y // CELL)
        best, seen = None, set()
        for r in range(MAX_RINGS + 1):
            # Every cell in ring r is at least (r - 1) cells away.
            if best is not None and best[0] <= ((r - 1) * CELL) ** 2:
                break
            for i in range(ci - r, ci + r + 1):
                for j in (range(cj - r, cj + r + 1) if i in (ci - r, ci + r)
                          else (cj - r, cj + r)):
                    for k in self.grid.get((i, j), ()):
                        if k in seen:
                            continue
                        seen.add(k)
                        c = self.closest(x, y, self.edges[k])
                        if best is None or c[0] < best[0]:
                            best = c
        if best is None:  # far from Hawaii (e.g. Hood River): roughly is enough
            best = min(self.closest(x, y, e) for e in self.sparse)
        return best[2] / KY, best[1] / KX


_coast = None


def nearest_land(points):
    """{(lat, lon): (nearest_lat, nearest_lon)} for each (lat, lon) in points;
    points with a missing coordinate are left out."""
    global _coast
    if _coast is None:
        _coast = Coast(load_rings())
    out = {}
    for lat, lon in points:
        if lat is None or lon is None or (lat, lon) in out:
            continue
        out[(lat, lon)] = _coast.nearest(lat, lon)
    return out
