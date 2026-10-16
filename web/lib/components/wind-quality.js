import * as Plot from 'npm:@observablehq/plot';
import {html} from 'npm:htl';
import {FileAttachment} from 'observablehq:stdlib';

const TABLE = await FileAttachment('../data/wind-quality.json').json();

// How good the wind is for a downwind run, per sensor. Ranges are in the
// degrees that sensor reports, since stations don't all read alike.
//
// Ranges run clockwise from `from` to `to` (inclusive, so 330 → 10 wraps
// through north). The first range that holds a reading wins; a direction
// in none of them is no-go. A station with no entry here gets no rating.
// `floor` is the lightest average wind worth going in.

// The table lives in data/wind-quality.json, which Node-RED's run rating
// also reads, so the site and the rating agree. Edit it there.
export const CLASSES = TABLE.classes;

export const WIND_QUALITY = TABLE.stations;

const inRange = (deg, {from, to}) => from <= to ? deg >= from && deg <= to : deg >= from || deg <= to;

// The class key for one reading ({wavg, wdir}) at a site, or null when the
// site has no table or the reading has no direction.
export function windClass(site, {wavg, wdir}) {
  const q = WIND_QUALITY[site];
  if (!q || wdir == null || Number.isNaN(wdir)) return null;
  const deg = ((Math.round(wdir) % 360) + 360) % 360;
  const range = q.ranges.find(r => inRange(deg, r));
  if (!range) return "nogo";
  if (wavg != null && wavg < q.floor) return "light";
  return range.class;
}

export function windRange(site, wdir) {
  const q = WIND_QUALITY[site];
  if (!q || wdir == null) return null;
  const deg = ((Math.round(wdir) % 360) + 360) % 360;
  return q.ranges.find(r => inRange(deg, r)) ?? null;
}

// A strip of colored cells along the bottom of a wind chart, one per
// reading, from y1 to y2 (chart units), so a run of good direction shows
// at a glance. Pass rows oldest first.
export function qualityStrip(site, rows, {y1, y2}) {
  if (!WIND_QUALITY[site]) return null;
  const cells = rows.map((d, i) => {
    const next = rows[i + 1]?.ts ?? new Date(+d.ts + 5 * 60e3);
    const cls = windClass(site, d);
    return {x1: d.ts, x2: next, cls};
  }).filter(d => d.cls);
  return Plot.rectY(cells, {x1: "x1", x2: "x2", y1, y2, fill: d => CLASSES[d.cls].color, insetLeft: 0, insetRight: 0});
}

// "magic" etc. as a small colored pill for a reading, or "" when the site
// has no table. It opens the wind page's section for the site, where the
// numbers come from. A click handler rather than a link, since the hub's
// wind cards are links themselves. Pages style it with .wq-badge.
export function qualityBadge(site, d) {
  const cls = windClass(site, d);
  if (!cls) return "";
  const {label, color} = CLASSES[cls];
  const open = e => { e.preventDefault(); e.stopPropagation(); location.href = `wind.html#${site}`; };
  return html`<span class="wq-badge" role="link" tabindex="0" title="Where this comes from" style="--wq: ${color}; cursor: pointer"
    onclick=${open} onkeydown=${e => e.key === "Enter" && open(e)}>${label}</span>`;
}
