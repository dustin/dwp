"""A buoy reading's spectrum as an image, for matrix-bot's !conditions.

The web's spectrum histogram (web/lib/components/spectrum.js) redrawn as a
plain SVG: energy by period between each NDBC bin's real edges, colored by
the direction it comes from (the same sinebow), the reading six hours
earlier dashed over it, and the web's mini rose, bigger, beside it.
avatar_svg() is that rose alone, for the room's avatar. to_png() turns
either into a PNG with rsvg-convert (librsvg, in db-env.nix).

Only the Python standard library, like the rest of db/.
"""

import math
import subprocess
from xml.sax.saxutils import escape

COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
FMIN, FMAX = 0.04, 0.35  # FREQ_DOMAIN in spectrum.js: 25 s to ~2.9 s
PERIODS = [20, 15, 12, 10, 8, 7, 6, 5, 4, 3]
FONT = "DejaVu Sans, Helvetica, Arial, sans-serif"


def compass(deg):
    return COMPASS[round((deg % 360) / 22.5) % 16]


def sinebow(deg):
    """d3.interpolateSinebow at deg/360, as directionColor in spectrum.js."""
    if deg is None:
        return "#999"
    t = 0.5 - (deg % 360) / 360
    return "#%02x%02x%02x" % tuple(
        round(255 * math.sin(math.pi * (t + k / 3)) ** 2) for k in range(3))


def edges(rows):
    """[(lo, hi, energy, direction)]: each bin between its neighbors' midpoints."""
    fs = [f for f, _, _ in rows]
    out = []
    for i, (f, e, d) in enumerate(rows):
        lo = (fs[i - 1] + f) / 2 if i else f - (fs[1] - f) / 2 if len(fs) > 1 else f
        hi = (f + fs[i + 1]) / 2 if i + 1 < len(fs) else f + (f - fs[i - 1]) / 2 if i else f
        out.append((lo, hi, e, d))
    return out


def sectors(bins):
    """Energy summed into 16 sectors by the direction it comes from."""
    tot = [0.0] * 16
    for lo, hi, e, d in bins:
        if d is not None and hi > FMIN and lo < FMAX:
            tot[round((d % 360) / 22.5) % 16] += e * (hi - lo)
    return tot


def wedges(tot, cx, cy, r):
    """Each sector a wedge, its length the square root of its share
    (renderMiniRose), colored by its direction."""
    step, mx = 22.5, max(tot) or 1
    out = []
    for k, v in enumerate(tot):
        if not v:
            continue
        rr = r * math.sqrt(v / mx)
        a0, a1 = math.radians(k * step - step / 2), math.radians(k * step + step / 2)
        out.append(f'<path d="M{cx},{cy} L{cx + rr * math.sin(a0):.1f},{cy - rr * math.cos(a0):.1f} '
                   f'A{rr:.1f},{rr:.1f} 0 0 1 {cx + rr * math.sin(a1):.1f},{cy - rr * math.cos(a1):.1f} Z" '
                   f'fill="{sinebow(k * step)}"/>')
    return out


def rose(bins, cx, cy, r):
    out = [f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="#fff" stroke="#ccc"/>',
           f'<circle cx="{cx}" cy="{cy}" r="{r / 2}" fill="none" stroke="#eee"/>']
    for a in range(0, 360, 45):
        out.append(f'<line x1="{cx}" y1="{cy}" x2="{cx + r * math.sin(math.radians(a)):.1f}" '
                   f'y2="{cy - r * math.cos(math.radians(a)):.1f}" stroke="#eee"/>')
    for a, t in ((0, "N"), (90, "E"), (180, "S"), (270, "W")):
        out.append(f'<text x="{cx + (r + 11) * math.sin(math.radians(a)):.1f}" '
                   f'y="{cy - (r + 11) * math.cos(math.radians(a)) + 4:.1f}" '
                   f'text-anchor="middle" fill="#777">{t}</text>')
    return "\n".join(out + wedges(sectors(bins), cx, cy, r))


def avatar_svg(rows, n=256):
    """Just the rose, filling an n-pixel square, for the room's avatar:
    clients crop it to a circle and show it 24-64 px across, so no labels."""
    c, r = n / 2, n / 2 - 6
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{n}" height="{n}">',
           f'<rect width="{n}" height="{n}" fill="#fff"/>',
           f'<circle cx="{c}" cy="{c}" r="{r / 2}" fill="none" stroke="#e4e4e4" stroke-width="2"/>']
    for a in range(0, 360, 90):
        out.append(f'<line x1="{c}" y1="{c}" x2="{c + r * math.sin(math.radians(a)):.1f}" '
                   f'y2="{c - r * math.cos(math.radians(a)):.1f}" stroke="#e4e4e4" stroke-width="2"/>')
    out += wedges(sectors(edges(rows)), c, c, r)
    return "\n".join(out + ["</svg>"])


def spectrum_svg(rows, title, earlier=None, earlier_label=""):
    """rows, earlier: [(freq Hz, energy m²/Hz, direction °)] for one reading each."""
    W, H, L, R, T, B = 900, 380, 56, 16, 44, 74
    RW = 280  # the rose panel, right of the chart
    pw, ph = W - L - R - RW, H - T - B
    rows = sorted((f, e or 0, d) for f, e, d in rows)
    earlier = sorted((f, e or 0, d) for f, e, d in earlier or [])
    emax = max([e for _, e, _ in rows + earlier if FMIN <= _ <= FMAX] or [0]) or 1
    x = lambda f: L + (f - FMIN) / (FMAX - FMIN) * pw  # noqa: E731
    y = lambda e: T + ph - min(e, emax) / emax * ph  # noqa: E731
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'font-family="{FONT}" font-size="12">',
           f'<rect width="{W}" height="{H}" fill="#fff"/>',
           f'<text x="{L}" y="24" font-size="16" font-weight="bold">{escape(title)}</text>']
    bins = edges(rows)
    for lo, hi, e, d in bins:
        lo, hi = max(lo, FMIN), min(hi, FMAX)
        if hi > lo:
            out.append(f'<rect x="{x(lo):.1f}" y="{y(e):.1f}" width="{x(hi) - x(lo):.1f}" '
                       f'height="{T + ph - y(e):.1f}" fill="{sinebow(d)}" stroke="#fff" stroke-width="0.5"/>')
    if earlier:
        pts = " ".join(f"{x(f):.1f},{y(e):.1f}" for f, e, _ in earlier if FMIN <= f <= FMAX)
        out.append(f'<polyline points="{pts}" fill="none" stroke="#333" '
                   'stroke-width="1.5" stroke-dasharray="4 3"/>')
    out.append(f'<line x1="{L}" y1="{T + ph}" x2="{L + pw}" y2="{T + ph}" stroke="#333"/>')
    for p in PERIODS:
        out.append(f'<line x1="{x(1 / p):.1f}" y1="{T + ph}" x2="{x(1 / p):.1f}" y2="{T + ph + 4}" stroke="#333"/>'
                   f'<text x="{x(1 / p):.1f}" y="{T + ph + 17}" text-anchor="middle">{p}</text>')
    out.append(f'<text x="{L + pw / 2}" y="{T + ph + 33}" text-anchor="middle" fill="#555">period (s)</text>')
    out.append(f'<text x="14" y="{T + ph / 2}" transform="rotate(-90 14 {T + ph / 2})" '
               'text-anchor="middle" fill="#555">energy (m²/Hz)</text>')
    for v in (0, emax / 2, emax):
        out.append(f'<text x="{L - 6}" y="{y(v) + 4:.1f}" text-anchor="end">{v:.1f}</text>')
    kx = L  # the direction key, then the earlier reading's
    for d in range(0, 360, 45):
        out.append(f'<rect x="{kx}" y="{H - 18}" width="12" height="12" fill="{sinebow(d)}"/>'
                   f'<text x="{kx + 16}" y="{H - 8}">{compass(d)}</text>')
        kx += 46
    if earlier:
        out.append(f'<line x1="{kx + 20}" y1="{H - 12}" x2="{kx + 44}" y2="{H - 12}" stroke="#333" '
                   'stroke-width="1.5" stroke-dasharray="4 3"/>'
                   f'<text x="{kx + 50}" y="{H - 8}" fill="#333">{escape(earlier_label)}</text>')
    out.append(rose(bins, W - R - RW / 2 + 8, T + ph / 2 + 12, RW / 2 - 24))
    out.append("</svg>")
    return "\n".join(out)


def to_png(svg, zoom=2):
    """PNG bytes of svg, at zoom times its size."""
    r = subprocess.run(["rsvg-convert", "-f", "png", "-z", str(zoom)],
                       input=svg.encode(), capture_output=True, check=True)
    return r.stdout
