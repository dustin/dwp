"""Placemarks from a KML file as WKT, for update-beaches and strava/triage.py.

Coordinates stay lon/lat as the KML has them; a Placemark's folder is the
name of the innermost Folder it's in.
"""

import xml.etree.ElementTree as ET


def local(tag):
    return tag.rsplit("}", 1)[-1]


def child(el, name):
    return next((c for c in el if local(c.tag) == name), None)


def coords(el):
    """'lon lat, lon lat, ...' from a <coordinates> under el."""
    c = next((c for c in el.iter() if local(c.tag) == "coordinates"), None)
    if c is None or not (c.text or "").strip():
        raise ValueError("no coordinates")
    pts = []
    for t in c.text.split():
        lon, lat = t.split(",")[:2]
        pts.append(f"{float(lon)!r} {float(lat)!r}")
    return ", ".join(pts)


def wkt(g):
    """WKT for a KML geometry element."""
    kind = local(g.tag)
    if kind == "Point":
        return f"POINT ({coords(g)})"
    if kind == "LineString":
        return f"LINESTRING ({coords(g)})"
    if kind == "Polygon":
        rings = [f"({coords(b)})" for t in ("outerBoundaryIs", "innerBoundaryIs")
                 for b in g if local(b.tag) == t]
        return f"POLYGON ({', '.join(rings)})"
    if kind == "MultiGeometry":
        parts = [wkt(c) for c in g if local(c.tag) in GEOMS]
        if not parts:
            raise ValueError("empty MultiGeometry")
        return f"GEOMETRYCOLLECTION ({', '.join(parts)})"
    raise ValueError(f"unsupported geometry {kind}")


GEOMS = {"Point", "LineString", "Polygon", "MultiGeometry"}


def placemarks(path):
    """[(name, folder, wkt)] for every Placemark in the KML."""
    out = []

    def walk(el, folder):
        for c in el:
            t = local(c.tag)
            if t == "Folder":
                n = child(c, "name")
                walk(c, (n.text or "").strip() if n is not None else folder)
            elif t == "Placemark":
                n = child(c, "name")
                name = (n.text or "").strip() if n is not None else ""
                g = next((g for g in c if local(g.tag) in GEOMS), None)
                if not name or g is None:
                    raise ValueError(f"a Placemark with no {'name' if not name else 'geometry'}"
                                     f"{' (' + name + ')' if name else ''}")
                try:
                    out.append((name, folder, wkt(g)))
                except ValueError as e:
                    raise ValueError(f"{name}: {e}") from None
            else:
                walk(c, folder)

    walk(ET.parse(path).getroot(), None)
    dups = sorted({n for n, _, _ in out if sum(1 for m, _, _ in out if m == n) > 1})
    if dups:
        raise ValueError(f"names used more than once: {', '.join(dups)}")
    return out
