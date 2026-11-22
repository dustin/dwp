"""Geometry the importer and run-stats need, without DuckDB's spatial
extension.

nearest_land(): each trackpoint's nearest point on land, for
dws.nearest_land_lat/lon. This used to be a LATERAL join of every point
against coastline_swapped with ST_ShortestLine in import.sql; under DuckDB
2.0.1's spatial extension that ran the database server out of memory on an
ordinary run (2026-11-22), so the importer works it out here instead, from
coastline.parquet (the same island polygons, lon/lat), and import.sql takes
the answers with the trackpoints (dwp_publish.import_sql).

It gives what the SQL gave: for each island, the planar nearest point in
(lat, lon) degrees, as ST_ShortestLine finds it (the point itself when it's
on that island); then the island whose nearest point is closest by
haversine(), spatial's ST_Distance_Sphere.

wkb_parts() reads WKB, which dwp_publish also uses for the beaches
(beach_edges for run-stats.sql).
"""

import math
import os
import struct
import subprocess

DB_DIR = os.path.dirname(os.path.abspath(__file__))
COASTLINE = "coastline.parquet"

CELL = 0.01       # grid cell, degrees (about 1 km)
MAX_RINGS = 150   # past ~150 km from any coast, fall back to scanning every edge
# A planar distance of p degrees is at least this many metres on the sphere
# anywhere near Hawaii (cos 30N, with room to spare), for stopping the search.
M_PER_DEG_MIN = 6371000.0 * math.pi / 180.0 * 0.86


def haversine(lat1, lon1, lat2, lon2):
    """Metres, exactly as DuckDB spatial's ST_Distance_Sphere (sgl.hpp
    haversine_distance) computes it, with points as ST_Point(lat, lon) and
    geometry_always_xy = false."""
    R = 6371000.0
    PI = 3.14159265358979323846
    lat1, lon1 = lat1 * PI / 180.0, lon1 * PI / 180.0
    lat2, lon2 = lat2 * PI / 180.0, lon2 * PI / 180.0
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.pow(math.sin(dlat / 2.0), 2.0) + \
        math.cos(lat1) * math.cos(lat2) * math.pow(math.sin(dlon / 2.0), 2.0)
    return R * (2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a)))


def wkb_parts(buf):
    """A WKB geometry's simple parts, coordinates as stored (x, y):
    ('point', [(x, y)]), ('line', [(x, y), ...]) or ('polygon', [ring, ...]),
    with multi-geometries and collections flattened."""
    parts = []

    def coords(bo, off):
        (n,) = struct.unpack_from(bo + "I", buf, off)
        xs = struct.unpack_from(bo + f"{2 * n}d", buf, off + 4)
        return list(zip(xs[0::2], xs[1::2])), off + 4 + 16 * n

    def geom(off):
        bo = "<" if buf[off] == 1 else ">"
        (typ,) = struct.unpack_from(bo + "I", buf, off + 1)
        off += 5
        if typ == 1:
            x, y = struct.unpack_from(bo + "2d", buf, off)
            if not (math.isnan(x) or math.isnan(y)):
                parts.append(("point", [(x, y)]))
            return off + 16
        if typ == 2:
            pts, off = coords(bo, off)
            parts.append(("line", pts))
            return off
        if typ == 3:
            (nr,) = struct.unpack_from(bo + "I", buf, off)
            off += 4
            rings = []
            for _ in range(nr):
                ring, off = coords(bo, off)
                rings.append(ring)
            parts.append(("polygon", rings))
            return off
        if typ in (4, 5, 6, 7):
            (ng,) = struct.unpack_from(bo + "I", buf, off)
            off += 4
            for _ in range(ng):
                off = geom(off)
            return off
        raise ValueError(f"WKB type {typ} isn't a 2D geometry this reads")

    geom(0)
    return parts


def load_islands(path=None):
    """coastline.parquet's polygons as lists of rings of (lat, lon), via the
    duckdb CLI (no spatial needed)."""
    path = path or os.path.join(DB_DIR, COASTLINE)
    q = f"select hex(geom::blob) from read_parquet('{path}')"
    out = subprocess.run(["duckdb", "-noheader", "-csv", "-c", q], check=True,
                         capture_output=True, text=True).stdout
    islands = []
    for line in out.split():
        for kind, rings in wkb_parts(bytes.fromhex(line.strip().strip('"'))):
            if kind == "polygon":
                islands.append([[(lat, lon) for lon, lat in r] for r in rings])
    return islands


def closest(x, y, ax, ay, bx, by):
    """(squared planar distance, px, py): the nearest point to (x, y) on the
    segment a-b."""
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else ((x - ax) * dx + (y - ay) * dy) / L
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    px, py = ax + t * dx, ay + t * dy
    return (px - x) ** 2 + (py - y) ** 2, px, py


def crosses(x, y, ax, ay, bx, by):
    """Whether the segment crosses the ray from (x, y) toward +x (even-odd)."""
    return (ay > y) != (by > y) and x < ax + (y - ay) * (bx - ax) / (by - ay)


class Coast:
    """The islands' edges in (lat, lon) degrees, with a grid for searching."""

    def __init__(self, islands):
        self.edges = []    # (island, ax, ay, bx, by)
        self.grid = {}     # (i, j) -> edge indexes whose bbox touches the cell
        self.rows = {}     # j -> edge indexes spanning that row, for inside tests
        self.n = len(islands)
        for isl, rings in enumerate(islands):
            for ring in rings:
                for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
                    k = len(self.edges)
                    self.edges.append((isl, ax, ay, bx, by))
                    i0, i1 = sorted((int(ax // CELL), int(bx // CELL)))
                    j0, j1 = sorted((int(ay // CELL), int(by // CELL)))
                    for j in range(j0, j1 + 1):
                        self.rows.setdefault(j, []).append(k)
                        for i in range(i0, i1 + 1):
                            self.grid.setdefault((i, j), []).append(k)

    def inside(self, x, y):
        """Whether (x, y) is on an island: even-odd per island, so holes count."""
        n = [0] * self.n
        for k in self.rows.get(int(y // CELL), ()):
            isl, ax, ay, bx, by = self.edges[k]
            if crosses(x, y, ax, ay, bx, by):
                n[isl] += 1
        return any(c % 2 for c in n)

    def nearest(self, lat, lon):
        """(lat, lon) of the nearest land, the point itself on land."""
        x, y = lat, lon
        if self.inside(x, y):
            return lat, lon
        best = {}   # island -> (planar d2, px, py), over the edges seen so far
        ci, cj = int(x // CELL), int(y // CELL)
        seen = set()
        win = None  # (metres, px, py)
        for r in range(MAX_RINGS + 2):
            # An island none of whose edges are seen yet is at least r - 1
            # cells away in the plane, so at least this far on the sphere.
            if win is not None and win[0] < (r - 1) * CELL * M_PER_DEG_MIN:
                return win[1], win[2]
            if r > MAX_RINGS:
                break
            for i in range(ci - r, ci + r + 1):
                for j in (range(cj - r, cj + r + 1) if i in (ci - r, ci + r)
                          else (cj - r, cj + r)):
                    for k in self.grid.get((i, j), ()):
                        if k in seen:
                            continue
                        seen.add(k)
                        isl, *seg = self.edges[k]
                        c = closest(x, y, *seg)
                        if isl not in best or c[0] < best[isl][0]:
                            best[isl] = c
            # An island's planar nearest is final once its nearest edge is
            # seen; one that isn't can't beat the bound above anyway.
            for _, px, py in best.values():
                m = haversine(x, y, px, py)
                if win is None or m < win[0]:
                    win = (m, px, py)
        # Far from Hawaii (e.g. Hood River): every edge, per island.
        for isl, *seg in self.edges:
            c = closest(x, y, *seg)
            if isl not in best or c[0] < best[isl][0]:
                best[isl] = c
        win = min((haversine(x, y, px, py), px, py) for _, px, py in best.values())
        return win[1], win[2]


_coast = None


def nearest_land(points):
    """{(lat, lon): (nearest_lat, nearest_lon)} for each (lat, lon) in points;
    points with a missing coordinate are left out."""
    global _coast
    if _coast is None:
        _coast = Coast(load_islands())
    out = {}
    for lat, lon in points:
        if lat is None or lon is None or (lat, lon) in out:
            continue
        out[(lat, lon)] = _coast.nearest(lat, lon)
    return out
