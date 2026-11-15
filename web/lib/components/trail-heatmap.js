import { FileAttachment } from 'observablehq:stdlib';
import * as d3 from 'npm:d3';
import { html } from 'npm:htl';

// Where everyone rides: how many runs passed through each ~22 m cell of a
// grid over the spot, on the coastline outline (no map tiles), dark in
// either theme so the heat colors read the same. The counts
// come from publish (the heatmap table in db/dwp_publish.py), whose grids
// these must match: southwest corner, size in cells, cell size in degrees.
const DATAHOST = 'd2qwe1xndvncw9.cloudfront.net';
const CELL = 0.0002;
export const HEATMAP_SPOTS = {
  maliko: {
    lat0: 20.88, lon0: -156.5, nx: 875, ny: 400,
    // [name, lat, lon, where the label goes from the dot]
    labels: [
      ['Maliko', 20.9411, -156.3415, 'below-left'],
      ['Kūʻau', 20.9294, -156.3696, 'below'],
      ['Baldwin', 20.9148, -156.393, 'below'],
      ['Sugar Cove', 20.9101, -156.4093, 'below'],
      ['Kanahā', 20.9021, -156.4395, 'below'],
      ['Kahului Harbor', 20.8979, -156.4749, 'below-right'],
    ],
  },
  kihei: {
    lat0: 20.64, lon0: -156.495, nx: 300, ny: 800,
    // What the map shows, [[west, south], [east, north]], when not just
    // the grid: room east of the grid for the beach names.
    view: [[-156.495, 20.64], [-156.405, 20.8]],
    labels: [
      ['Keālia Boardwalk', 20.7946, -156.4852, 'right'],
      ['Sugar Beach', 20.7897, -156.4751, 'right'],
      ['Green Church', 20.7805, -156.4625, 'right'],
      ['Kalepolepo', 20.7656, -156.4594, 'right'],
      ['Coconut Channel', 20.7426, -156.4574, 'right'],
      ['Kam I', 20.7224, -156.4481, 'right'],
      ['Keawakapu', 20.7023, -156.446, 'right'],
      ['Ulua', 20.6909, -156.444, 'right'],
      ['Wailea', 20.6825, -156.4434, 'right'],
      ['Poʻolenalena', 20.6621, -156.4417, 'right'],
      ['Maluaka', 20.6469, -156.4428, 'right'],
    ],
  },
};

// {cells: [[i, j, runs]], islands} for the spot; cells is [] when publish
// hasn't made it yet.
export async function fetchHeatmap(spot) {
  const [cells, islands] = await Promise.all([
    d3.csv(`https://${DATAHOST}/heatmap/spot%3D${spot}/data.csv`, d => [+d.i, +d.j, +d.runs]).catch(() => []),
    FileAttachment('../data/islands.json').json(),
  ]);
  return { spot, cells, islands };
}

const ramp = t => d3.color(d3.interpolateTurbo(0.15 + 0.8 * t));
const LUT = d3.range(256).map(i => ramp(i / 255));

// The map for `spot` at `width` px, as tall as the grid's shape needs but
// no taller than maxHeight (a narrower map then, centered).
export function renderHeatmap({ spot, cells, islands }, { width, maxHeight = Infinity } = {}) {
  const g = HEATMAP_SPOTS[spot];
  const gridCorners = [[g.lon0, g.lat0], [g.lon0 + g.nx * CELL, g.lat0 + g.ny * CELL]];
  const corners = { type: 'MultiPoint', coordinates: g.view ?? gridCorners };
  const proj = d3.geoMercator().fitWidth(width, corners);
  let [[x0, y0], [x1, y1]] = [proj(corners.coordinates[0]), proj(corners.coordinates[1])];
  if (y0 - y1 > maxHeight) {
    proj.fitHeight(maxHeight, corners);
    [[x0, y0], [x1, y1]] = [proj(corners.coordinates[0]), proj(corners.coordinates[1])];
  }
  // Start the map at 0,0.
  const [tx, ty] = proj.translate();
  proj.translate([tx - x0, ty - y1]);
  const W = Math.round(x1 - x0), H = Math.round(y0 - y1);
  // Planar, so ring winding doesn't matter (spherical fill can invert).
  const path = d3.geoPath(d3.geoTransform({
    point(x, y) { const p = proj([x, y]); this.stream.point(p[0], p[1]); },
  }));

  const wrap = html`<div style="position: relative; width: ${W}px; height: ${H}px; margin: 0 auto; max-width: 100%;
    background: #1b2a38; border-radius: 4px; overflow: hidden;">`;

  const land = d3.create('svg').attr('width', W).attr('height', H).style('position', 'absolute').style('inset', 0);
  land.append('g').selectAll('path').data(islands.features).join('path').attr('d', path)
    .attr('fill', '#343b45')
    .attr('stroke', '#5d6876')
    .attr('stroke-width', 0.8);
  wrap.append(land.node());

  if (cells.length) {
    const dpr = window.devicePixelRatio || 1;
    // One pixel per cell, alpha the (log) run count, then scaled up to the
    // map and colored by alpha: the same look at any width.
    const grid = document.createElement('canvas');
    grid.width = g.nx;
    grid.height = g.ny;
    const gctx = grid.getContext('2d');
    const gi = gctx.createImageData(g.nx, g.ny);
    const norm = d3.scaleLog().domain([1, d3.max(cells, d => d[2])]).range([0.1, 1]).clamp(true);
    for (const [i, j, n] of cells) gi.data[((g.ny - 1 - j) * g.nx + i) * 4 + 3] = Math.round(255 * norm(n));
    gctx.putImageData(gi, 0, 0);

    const cv = document.createElement('canvas');
    cv.width = W * dpr;
    cv.height = H * dpr;
    Object.assign(cv.style, { position: 'absolute', inset: 0, width: `${W}px`, height: `${H}px` });
    const ctx = cv.getContext('2d');
    ctx.filter = `blur(${0.6 * dpr}px)`;
    const [[gx0, gy0], [gx1, gy1]] = gridCorners.map(c => proj(c));
    ctx.drawImage(grid, gx0 * dpr, gy1 * dpr, (gx1 - gx0) * dpr, (gy0 - gy1) * dpr);
    const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
    for (let k = 0; k < d.length; k += 4) {
      const a = d[k + 3];
      if (!a) continue;
      const c = LUT[a];
      d[k] = c.r; d[k + 1] = c.g; d[k + 2] = c.b; d[k + 3] = Math.min(255, 90 + a);
    }
    ctx.putImageData(img, 0, 0);
    wrap.append(cv);
  }

  const lab = d3.create('svg').attr('width', W).attr('height', H).style('position', 'absolute').style('inset', 0)
    .attr('font-size', W < 500 ? 10 : 12).attr('fill', '#c3ccd6');
  for (const [name, lat, lon, where] of g.labels) {
    const [x, y] = proj([lon, lat]);
    lab.append('circle').attr('cx', x).attr('cy', y).attr('r', 2.5);
    const [dx, dy, anchor] = {
      'below': [0, 15, 'middle'], 'below-left': [-6, 14, 'end'], 'below-right': [6, 14, 'start'],
      'right': [6, 4, 'start'],
    }[where];
    lab.append('text').attr('x', x + dx).attr('y', y + dy).attr('text-anchor', anchor)
      .attr('paint-order', 'stroke').attr('stroke', '#1b2a38').attr('stroke-width', 3)
      .attr('stroke-opacity', 0.6).text(name);
  }
  wrap.append(lab.node());
  return wrap;
}

export function heatmapLegend() {
  const stops = d3.range(0, 1.01, 0.1).map(t => ramp(t)).join(',');
  return html`<div class="muted" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; margin-top: 0.5rem;">
    <span>fewer runs</span><span style="width: 140px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, ${stops});"></span><span>more</span></div>`;
}

// The whole card, from fetchHeatmap's result; resize is Framework's.
// `runs` is how many runs went into it, for the note.
export function heatmapCard(heat, { resize, maxHeight, title, runs } = {}) {
  const note = `${runs ? `${runs} runs` : 'Runs'} by every rider; the brighter a spot, the more runs passed through it.`;
  return html`<div class="card">${title ? html`<h2>${title}</h2>` : ""}
    <div class="muted" style="font-size: 0.85rem; margin-bottom: 0.5rem;">${note}</div>
    ${resize(width => renderHeatmap(heat, { width, maxHeight }))}
    ${heatmapLegend()}</div>`;
}
