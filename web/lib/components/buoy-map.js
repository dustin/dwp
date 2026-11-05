// Map of the buoys we collect, on a rough outline of the islands. The full
// map draws each buoy as its energy rose (renderMiniRose) linking to its
// page; the small one (roses: false) is a dot per buoy for page headers.
// Buoys with nothing to show are a red X on either.
import * as d3 from 'npm:d3';
import { HAWAII_ISLANDS } from './hawaii-islands.js';
import { renderMiniRose, compassPoint } from './spectrum.js';
import { BUOY_DATA_START } from './data.js';

// The buoys with a page (paths in hub.config.js), where they sit (NDBC's
// station list) and how far back each one's spectra go. `place` is where
// its rose goes relative to the buoy, in rose widths, so neighbors
// (Waimea and Barbers Point) don't overlap.
export const BUOYS = {
  pauwela: {
    name: 'Pauwela', station: '51205', where: "off Maui's North Shore",
    lat: 21.018, lon: -156.421, start: BUOY_DATA_START, place: [1.2, -0.2],
  },
  waimea: {
    name: 'Waimea Bay', station: '51201', where: "off Oʻahu's North Shore",
    lat: 21.671, lon: -158.118, start: new Date('2026-09-14T00:00:00-10:00'), place: [-0.05, -0.85],
  },
  barbers_point: {
    name: 'Barbers Point', station: '51212', where: "off Kalaeloa, Oʻahu's southwest corner",
    lat: 21.323, lon: -158.149, start: new Date('2026-09-17T00:00:00-10:00'), place: [-0.5, 0.7],
  },
  mokapu: {
    name: 'Mokapu Point', station: '51202', where: "off Oʻahu's windward side",
    lat: 21.414, lon: -157.681, start: new Date('2026-09-17T00:00:00-10:00'), place: [0.8, -1.0],
  },
  hilo: {
    name: 'Hilo', station: '51206', where: "off Hawaiʻi Island's east side",
    lat: 19.779, lon: -154.970, start: new Date('2026-09-17T00:00:00-10:00'), place: [0.75, 0.35],
  },
  nw_hawaii: {
    name: 'NW Hawaii', station: '51001', where: '188 nm northwest of Kauaʻi',
    lat: 24.475, lon: -162.030, start: new Date('2026-09-17T00:00:00-10:00'), place: [0, 0],
  },
  n_hawaii: {
    name: 'N Hawaii', station: '51000', where: '245 nm northeast of Honolulu',
    lat: 23.534, lon: -153.752, start: new Date('2026-09-17T00:00:00-10:00'), place: [0, 0],
  },
  sw_hawaii: {
    name: 'SW Hawaii', station: '51002', where: '215 nm south-southwest of Hilo',
    lat: 17.070, lon: -157.755, start: new Date('2026-09-17T00:00:00-10:00'), place: [0, 0],
  },
  se_hawaii: {
    name: 'SE Hawaii', station: '51004', where: '205 nm southeast of Hilo',
    lat: 17.504, lon: -152.197, start: new Date('2026-09-17T00:00:00-10:00'), place: [0, 0],
  },
  // Out with no recent reports, so not collected and without a page; the
  // map marks them with a red X. `side` is where the label goes.
  lanai: {
    name: 'Lānaʻi', station: '51213', where: "off Lānaʻi's southwest side", offline: '2026-07-13',
    lat: 20.750, lon: -157.002, side: 'left',
  },
  hanalei: {
    name: 'Hanalei', station: '51208', where: "off Kauaʻi's North Shore", offline: '2026-09-09',
    lat: 22.285, lon: -159.574, side: 'right',
  },
};

// The buoys we collect and have pages for.
export const LIVE_BUOYS = Object.fromEntries(Object.entries(BUOYS).filter(([, b]) => !b.offline));

// Which buoys matter for a run in each region, most relevant first. The
// run page lists these first and the rest after. Unknown regions get the
// default order.
export const REGION_BUOYS = {
  'Maui North Shore': ['pauwela', 'waimea', 'mokapu', 'n_hawaii', 'nw_hawaii', 'hilo'],
  'Kihei': ['barbers_point', 'sw_hawaii', 'se_hawaii', 'hilo'],
  'West Maui': ['barbers_point', 'waimea', 'nw_hawaii', 'sw_hawaii'],
  'Molokai': ['pauwela', 'mokapu', 'waimea', 'n_hawaii'],
  'Oahu': ['waimea', 'mokapu', 'barbers_point', 'nw_hawaii'],
};

const islands = {
  type: 'MultiPolygon',
  coordinates: HAWAII_ISLANDS.map(ring => [ring]),
};

// snapshots: site -> fetchBuoySnapshot result (or null) for the roses.
// current: the site whose page this is, drawn highlighted and not linked.
// href: link for a site.
export function renderBuoyMap({
  width = 640,
  snapshots = {},
  current = null,
  roses = true,
  href = site => `${site}.html`,
} = {}) {
  // A buoy with nothing to show (out, or on the full map no recent data) is
  // a small red X instead of a rose.
  const dead = site => BUOYS[site].offline || (roses && !snapshots[site]?.spectrum?.length);
  const rose = roses ? Math.round(Math.max(48, Math.min(150, width / 7))) : 0;
  const label = roses ? Math.max(9, Math.min(14, rose / 10)) : 10;
  const margin = roses ? 4 : 6;
  // Fit the islands to the width, then shrink them until every rose (and
  // its label) fits inside too.
  const projection = d3.geoMercator().fitWidth(width - 2 * margin, islands);
  const roseBox = () => Object.entries(BUOYS).filter(([site]) => !dead(site)).map(([, b]) => {
    const [x, y] = projection([b.lon, b.lat]);
    const cx = x + b.place[0] * rose, cy = y + b.place[1] * rose;
    return [[cx - rose / 2, cy - rose / 2], [cx + rose / 2, cy + rose / 2 + label * 2.8]];
  });
  let height = 0;
  for (let i = 0; i < 6; i++) {
    const boxes = [d3.geoPath(projection).bounds(islands), ...(roses ? roseBox() : [])];
    const x0 = d3.min(boxes, b => b[0][0]), x1 = d3.max(boxes, b => b[1][0]);
    const y0 = d3.min(boxes, b => b[0][1]), y1 = d3.max(boxes, b => b[1][1]);
    const [tx, ty] = projection.translate();
    const k = Math.min(1, (width - 2 * margin) / (x1 - x0));
    if (k > 0.995) {
      projection.translate([tx + margin - x0, ty + margin - y0]);
      height = Math.ceil(y1 - y0 + 2 * margin);
      break;
    }
    // Shrink about the islands' center and try again.
    const [[ix0, iy0], [ix1, iy1]] = d3.geoPath(projection).bounds(islands);
    const c = projection.invert([(ix0 + ix1) / 2, (iy0 + iy1) / 2]);
    projection.scale(projection.scale() * k);
    const [nx, ny] = projection(c);
    projection.translate([tx + (ix0 + ix1) / 2 - nx, ty + (iy0 + iy1) / 2 - ny]);
  }
  const path = d3.geoPath(projection);

  const svg = d3.create('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', [0, 0, width, height])
    .attr('class', 'buoy-map')
    .style('max-width', '100%').style('height', 'auto')
    .style('font', `${label}px var(--sans-serif)`);
  svg.append('path').attr('d', path(islands))
    .attr('fill', 'currentColor').attr('fill-opacity', 0.16)
    .attr('stroke', 'currentColor').attr('stroke-opacity', 0.35).attr('stroke-width', 0.75);

  for (const [site, b] of Object.entries(BUOYS)) {
    const [x, y] = projection([b.lon, b.lat]);
    const here = site === current;
    const parent = here || b.offline ? svg : svg.append('a').attr('href', href(site)).style('color', 'inherit');
    const g = parent.append('g').attr('class', 'buoy-map-buoy');
    g.append('title').text(`${b.name} buoy (NDBC ${b.station}), ${b.where}${
      b.offline ? `: out since ${b.offline}, not collected` : dead(site) ? ': no recent data' : ''}`);

    if (dead(site)) {
      const k = roses ? 5 : 3.5;
      g.append('path').attr('d', `M${x - k},${y - k}L${x + k},${y + k}M${x - k},${y + k}L${x + k},${y - k}`)
        .attr('stroke', '#d62728').attr('stroke-width', roses ? 2.5 : 2).attr('stroke-linecap', 'round');
      if (here) g.append('circle').attr('cx', x).attr('cy', y).attr('r', k + 4).attr('fill', 'none')
        .attr('stroke', 'var(--theme-foreground-focus)').attr('stroke-width', 1.5);
      if (roses) {
        const left = b.side === 'left';
        g.append('text').attr('x', x + (left ? -k - 4 : k + 4)).attr('y', y).attr('dy', '0.35em')
          .attr('text-anchor', left ? 'end' : 'start')
          .attr('fill', 'currentColor').attr('fill-opacity', 0.6).style('font-size', `${label * 0.85}px`)
          .text(here ? `${b.name} (this buoy)` : b.name);
      }
      continue;
    }

    if (!roses) {
      g.append('circle').attr('cx', x).attr('cy', y).attr('r', here ? 5 : 4)
        .attr('fill', here ? 'var(--theme-foreground-focus)' : 'currentColor')
        .attr('fill-opacity', here ? 1 : 0.55);
      if (here) g.append('circle').attr('cx', x).attr('cy', y).attr('r', 8).attr('fill', 'none')
        .attr('stroke', 'var(--theme-foreground-focus)').attr('stroke-width', 1.5);
      continue;
    }

    const cx = x + b.place[0] * rose, cy = y + b.place[1] * rose;
    const r = rose / 2 - 7;
    // Leader from the buoy to the edge of its rose.
    const a = Math.atan2(cy - y, cx - x), d = Math.hypot(cx - x, cy - y);
    // A rose above its buoy has its label underneath, so stop short of that.
    const end = cy < y ? Math.max(0, d - (rose / 2 + label * 3)) : d - r;
    g.append('line').attr('x1', x).attr('y1', y)
      .attr('x2', x + Math.cos(a) * end).attr('y2', y + Math.sin(a) * end)
      .attr('stroke', 'currentColor').attr('stroke-opacity', 0.4);
    g.append('circle').attr('cx', x).attr('cy', y).attr('r', 3.5)
      .attr('fill', here ? 'var(--theme-foreground-focus)' : 'currentColor');
    // A backdrop so the rose reads over the coastline and is easy to hit.
    g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', r + 2)
      .attr('fill', 'var(--theme-background)').attr('fill-opacity', 0.85)
      .attr('stroke', here ? 'var(--theme-foreground-focus)' : 'none').attr('stroke-width', 2);

    const snap = snapshots[site];
    const node = renderMiniRose(snap.spectrum, { size: rose });
    d3.select(node).attr('x', cx - rose / 2).attr('y', cy - rose / 2);
    g.append(() => node);

    const t = g.append('text').attr('x', cx).attr('y', cy + rose / 2 + label * 0.4).attr('text-anchor', 'middle').attr('fill', 'currentColor');
    t.append('tspan').attr('x', cx).attr('dy', '0.7em').attr('font-weight', 600)
      .text(here ? `${b.name} (this buoy)` : b.name);
    const p = snap?.primary;
    if (p) t.append('tspan').attr('x', cx).attr('dy', '1.25em').attr('fill-opacity', 0.7)
      .text(`${p.height.toFixed(1)}′ @ ${p.period.toFixed(0)}s ${compassPoint(p.direction)}`);
  }
  return svg.node();
}
