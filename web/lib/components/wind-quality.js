import * as Plot from 'npm:@observablehq/plot';
import {html} from 'npm:htl';

// How good the wind is for a downwind run, per sensor. Ranges are in the
// degrees that sensor reports, since stations don't all read alike.
//
// Ranges run clockwise from `from` to `to` (inclusive, so 330 → 10 wraps
// through north). The first range that holds a reading wins; a direction
// in none of them is no-go. A station with no entry here gets no rating.
// `floor` is the lightest average wind worth going in.

export const CLASSES = {
  magic: {label: "magic", color: "#14b8a6", rank: 4},
  good:  {label: "good", color: "#3ca951", rank: 3},
  hard:  {label: "harder", color: "#efb118", rank: 2},
  light: {label: "too light", color: "#9a9a9a", rank: 1},
  nogo:  {label: "no go", color: "#e8453c", rank: 0},
};

export const WIND_QUALITY = {
  // Dustin, 2026-10-16: the magical 340, pretty good 350, more difficult
  // 15. Run data agrees that 330-347 goes best (on-foil share and foiling
  // speed); 350-015 are about average and runs stop past ~020. Reverse
  // (south) runs go better at 180-195 than 200+. Floor 12 kn.
  kihei: {
    floor: 12,
    ranges: [
      {from: 328, to: 347, class: "magic", note: "the magical 340"},
      {from: 348, to: 12, class: "good", note: "pretty good, around 350"},
      {from: 13, to: 22, class: "hard", note: "more difficult, around 15"},
      {from: 315, to: 327, class: "hard", note: "west of 340"},
      {from: 178, to: 196, class: "good", note: "south: reverse runs"},
      {from: 197, to: 215, class: "hard", note: "south, too onshore"},
    ],
  },
  // Rough, from run data until Dustin gives ranges: 70-100 all go about
  // the same (90s a touch faster), 60s go noticeably worse, and runs stop
  // below 60. Floor 17 kn.
  hookipa: {
    floor: 17,
    ranges: [
      {from: 68, to: 105, class: "good", note: "trades"},
      {from: 55, to: 67, class: "hard", note: "north of the trades"},
      {from: 106, to: 115, class: "hard", note: "east of the trades"},
    ],
  },
};

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
// has no table. Pages style it with .wq-badge.
export function qualityBadge(site, d) {
  const cls = windClass(site, d);
  if (!cls) return "";
  const {label, color} = CLASSES[cls];
  return html`<span class="wq-badge" style="--wq: ${color}">${label}</span>`;
}

