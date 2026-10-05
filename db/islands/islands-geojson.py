#!/usr/bin/env python3
"""Writes web/src/data/islands.json: the island outlines from
db/coastline.parquet, simplified (Douglas-Peucker, ~30 m) so they're small
enough to ship to the browser. The run page uses them to bow an
approximate route (a run with no GPS track) out to sea rather than over
land; see approximateRoute in web/src/components/data.js.

usage: db/islands/islands-geojson.py   (needs the duckdb Python package)
"""
import json
import os
import re

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'coastline.parquet')
OUT = os.path.join(HERE, '..', '..', 'web', 'src', 'data', 'islands.json')
TOLERANCE = 0.0003  # degrees, about 30 m
MIN_SQMI = 1  # skip islets and ponds


def simplify(points, tol):
    """Douglas-Peucker, iterative (coastlines run to tens of thousands of points)."""
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5
        best, idx = 0, None
        for i in range(a + 1, b):
            px, py = points[i]
            if norm:
                d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
            else:
                d = ((px - x1) ** 2 + (py - y1) ** 2) ** 0.5
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def rings(wkt):
    # POLYGON ((x y, x y, ...), (hole...)) -- outer ring only.
    outer = re.match(r'POLYGON \(\((.*?)\)', wkt).group(1)
    return [[round(float(v), 5) for v in p.split()] for p in outer.split(', ')]


features = []
con = duckdb.connect()
for isle, wkt in con.sql(
    f"select isle, ST_AsText(geom) from '{SRC}' where water = 0 and sqmi >= {MIN_SQMI} order by isle"
).fetchall():
    ring = rings(wkt)
    # A closed ring starts and ends on the same point, which leaves
    # Douglas-Peucker no baseline; simplify it as two halves.
    half = len(ring) // 2
    simple = simplify(ring[: half + 1], TOLERANCE)[:-1] + simplify(ring[half:], TOLERANCE)
    features.append({
        'type': 'Feature',
        'properties': {'isle': isle},
        'geometry': {'type': 'Polygon', 'coordinates': [simple]},
    })
    print(f'{isle}: {len(ring)} -> {len(simple)} points')

with open(OUT, 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': features}, f, separators=(',', ':'))
print(f'wrote {OUT} ({os.path.getsize(OUT)} bytes)')
