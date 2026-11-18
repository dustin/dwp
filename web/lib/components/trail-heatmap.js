import { FileAttachment } from 'observablehq:stdlib';
import * as d3 from 'npm:d3';
import { html } from 'npm:htl';

// Trail heatmaps: how many runs passed through each cell of a grid, drawn
// on the coastline outline (no map tiles), dark in either theme so the
// heat colors read the same. publish makes the counts (the heatmap table
// in db/dwp_publish.py) on one grid over the globe: cell (i, j) has its
// southwest corner at lon i * cell - 180, lat j * cell - 90, with cell
// CELL (about 22 m), or OVERVIEW_CELL (about 400 m) for a rider's
// overview. Both must match HEATMAP_CELL and HEATMAP_OVERVIEW_CELL there.
const DATAHOST = 'd2qwe1xndvncw9.cloudfront.net';
const CELL = 0.0002;
const OVERVIEW_CELL = 0.004;

// The spot pages' maps: the region's heatmap, the view ([[west, south],
// [east, north]]) and the beaches to name.
export const HEATMAP_SPOTS = {
  maliko: {
    region: 'Maui North Shore',
    view: [[-156.5, 20.88], [-156.325, 20.96]],
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
    region: 'Kihei',
    // Room east of the water for the beach names.
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

// 'Maui North Shore' -> 'maui-north-shore', like region_slug in publish.
export const regionSlug = region => region.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let islandsP = null;
const islands = () => (islandsP ??= FileAttachment('../data/islands.json').json());

// [[i, j, runs]] from one of publish's heatmap files; [] if there's none.
function cellsAt(path) {
  return d3.csv(`https://${DATAHOST}/${path}`, d => [+d.i, +d.j, +d.runs]).catch(() => []);
}
const regionPath = region => `heatmap/region%3D${regionSlug(region)}/data.csv`;
const riderPath = (rider, rest) => `runs/rider%3D${rider}/heatmap/${rest}`;

// {cells, islands, ...the spot} for a spot page; cells is [] until
// publish has made it.
export async function fetchHeatmap(spot) {
  const s = HEATMAP_SPOTS[spot];
  let [cells, isl] = await Promise.all([cellsAt(regionPath(s.region)), islands()]);
  if (!cells.length) cells = await oldSpotCells(spot);
  return { ...s, cells, cell: CELL, islands: isl };
}

// Until publish makes the region files: the first heatmaps, one per spot
// on a grid from the spot's southwest corner, moved onto the global grid.
// TODO: drop once heatmap/region= files are in S3.
const OLD_ORIGIN = { maliko: [-156.5, 20.88], kihei: [-156.495, 20.64] };
async function oldSpotCells(spot) {
  const [lon0, lat0] = OLD_ORIGIN[spot];
  const di = Math.round((lon0 + 180) / CELL), dj = Math.round((lat0 + 90) / CELL);
  return (await cellsAt(`heatmap/spot%3D${spot}/data.csv`)).map(([i, j, n]) => [i + di, j + dj, n]);
}

const ramp = t => d3.color(d3.interpolateTurbo(0.15 + 0.8 * t));
const LUT = d3.range(256).map(i => ramp(i / 255));
const GRAY = d3.range(256).map(i => d3.color(d3.interpolateRgb('#3d5266', '#b9c6d3')(i / 255)));
const OCEAN = '#1b2a38';

// The cells' extent, [[west, south], [east, north]].
function extent(cells, cell) {
  const [i0, i1] = d3.extent(cells, d => d[0]), [j0, j1] = d3.extent(cells, d => d[1]);
  return [[i0 * cell - 180, j0 * cell - 90], [(i1 + 1) * cell - 180, (j1 + 1) * cell - 90]];
}

// A heat layer: one pixel per cell, alpha the (log) run count, scaled up
// to the map and colored by alpha, so it looks the same at any width.
function heatLayer(cells, cell, proj, W, H, lut, { minAlpha = 90, blur = 0.6 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cv = document.createElement('canvas');
  cv.width = W * dpr;
  cv.height = H * dpr;
  Object.assign(cv.style, { position: 'absolute', inset: 0, width: `${W}px`, height: `${H}px` });
  if (!cells.length) return cv;
  const i0 = d3.min(cells, d => d[0]), j0 = d3.min(cells, d => d[1]);
  const nx = d3.max(cells, d => d[0]) - i0 + 1, ny = d3.max(cells, d => d[1]) - j0 + 1;
  const grid = document.createElement('canvas');
  grid.width = nx;
  grid.height = ny;
  const gctx = grid.getContext('2d');
  const gi = gctx.createImageData(nx, ny);
  const norm = d3.scaleLog().domain([1, Math.max(2, d3.max(cells, d => d[2]))]).range([0.12, 1]).clamp(true);
  for (const [i, j, n] of cells) gi.data[((ny - 1 - (j - j0)) * nx + (i - i0)) * 4 + 3] = Math.round(255 * norm(n));
  gctx.putImageData(gi, 0, 0);

  const ctx = cv.getContext('2d');
  ctx.filter = `blur(${blur * dpr}px)`;
  const [x0, y0] = proj([i0 * cell - 180, (j0 + ny) * cell - 90]);
  const [x1, y1] = proj([(i0 + nx) * cell - 180, j0 * cell - 90]);
  ctx.drawImage(grid, x0 * dpr, y0 * dpr, (x1 - x0) * dpr, (y1 - y0) * dpr);
  const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const a = d[k + 3];
    if (!a) continue;
    const c = lut[a];
    d[k] = c.r; d[k + 1] = c.g; d[k + 2] = c.b; d[k + 3] = Math.min(255, minAlpha + a);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// The base map over view at `width` px, as tall as its shape needs but no
// taller than maxHeight (a narrower map then, centered): {box, proj, W, H, svg}.
function baseMap(view, isl, width, maxHeight = Infinity) {
  const corners = { type: 'MultiPoint', coordinates: view };
  const proj = d3.geoMercator().fitWidth(width, corners);
  let [[x0, y0], [x1, y1]] = view.map(c => proj(c));
  if (y0 - y1 > maxHeight) {
    proj.fitHeight(maxHeight, corners);
    [[x0, y0], [x1, y1]] = view.map(c => proj(c));
  }
  const [tx, ty] = proj.translate();
  proj.translate([tx - x0, ty - y1]);
  const W = Math.round(x1 - x0), H = Math.round(y0 - y1);
  // Planar, so ring winding doesn't matter (spherical fill can invert).
  const path = d3.geoPath(d3.geoTransform({
    point(x, y) { const p = proj([x, y]); this.stream.point(p[0], p[1]); },
  }));
  const box = html`<div style="position: relative; width: ${W}px; height: ${H}px; margin: 0 auto; max-width: 100%;
    background: ${OCEAN}; border-radius: 4px; overflow: hidden;">`;
  const land = d3.create('svg').attr('width', W).attr('height', H).style('position', 'absolute').style('inset', 0);
  land.append('g').selectAll('path').data(isl.features).join('path').attr('d', path)
    .attr('fill', '#343b45').attr('stroke', '#5d6876').attr('stroke-width', 0.8);
  box.append(land.node());
  return { box, proj, W, H };
}

function overlay(W, H) {
  return d3.create('svg').attr('width', W).attr('height', H).style('position', 'absolute').style('inset', 0)
    .attr('font-size', W < 500 ? 10 : 12).attr('fill', '#c3ccd6');
}

const halo = text => text.attr('paint-order', 'stroke').attr('stroke', OCEAN).attr('stroke-width', 3).attr('stroke-opacity', 0.6);

function addLabels(svg, proj, labels) {
  for (const [name, lat, lon, where = 'right'] of labels) {
    const [x, y] = proj([lon, lat]);
    svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 2.5);
    const [dx, dy, anchor] = {
      'below': [0, 15, 'middle'], 'below-left': [-6, 14, 'end'], 'below-right': [6, 14, 'start'],
      'right': [6, 4, 'start'], 'left': [-6, 4, 'end'],
    }[where];
    halo(svg.append('text').attr('x', x + dx).attr('y', y + dy).attr('text-anchor', anchor)).text(name);
  }
}

// A region's map: cells in color over `under` (everyone's) in gray, if given.
export function renderHeatmap({ cells, cell = CELL, islands: isl, view, labels = [], under }, { width, maxHeight } = {}) {
  view ??= pad(extent(cells, cell), 0.004);
  const m = baseMap(view, isl, width, maxHeight);
  if (under?.length) m.box.append(heatLayer(under, cell, m.proj, m.W, m.H, GRAY, { minAlpha: 60 }));
  m.box.append(heatLayer(cells, cell, m.proj, m.W, m.H, LUT, { minAlpha: under?.length ? 110 : 90 }));
  const svg = overlay(m.W, m.H);
  addLabels(svg, m.proj, labels);
  m.box.append(svg.node());
  return m.box;
}

const pad = ([[w, s], [e, n]], d) => [[w - d, s - d], [e + d, n + d]];

export function heatmapLegend() {
  const stops = d3.range(0, 1.01, 0.1).map(t => ramp(t)).join(',');
  return html`<div class="muted" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.8rem; margin-top: 0.5rem;">
    <span>fewer runs</span><span style="width: 140px; height: 8px; border-radius: 4px; background: linear-gradient(90deg, ${stops});"></span><span>more</span></div>`;
}

// A spot page's card, from fetchHeatmap's result; resize is Framework's.
// `runs` is how many runs went into it, for the note.
export function heatmapCard(heat, { resize, maxHeight, title, runs } = {}) {
  const note = `${runs ? `${runs} runs` : 'Runs'} by every rider; the brighter a spot, the more runs passed through it.`;
  return html`<div class="card">${title ? html`<h2>${title}</h2>` : ''}
    <div class="muted" style="font-size: 0.85rem; margin-bottom: 0.5rem;">${note}</div>
    ${resize(width => renderHeatmap(heat, { width, maxHeight }))}
    ${heatmapLegend()}</div>`;
}

// ---- Rider pages: an overview of everywhere the rider has ridden, each
// region circled; a region opens its own heatmap in a popup.

const median = xs => d3.median(xs.filter(x => x != null && isFinite(x)));

// The rider's regions from their runs (fetchMeta rows), most runs first:
// [{region, runs, center: [lon, lat], labels}], labels being the beaches
// at least 3 of them started or ended at, busiest 12.
export function riderRegions(runs) {
  const tracked = runs.filter(d => d.has_track && d.region && d.region !== 'Elsewhere');
  return d3.groups(tracked, d => d.region).map(([region, rs]) => {
    const beaches = new Map();
    for (const r of rs) {
      for (const [b, lat, lon] of [[r.start_beach, r.start_lat, r.start_lon], [r.end_beach, r.end_lat, r.end_lon]]) {
        if (!b || b === 'Unknown' || lat == null) continue;
        if (!beaches.has(b)) beaches.set(b, []);
        beaches.get(b).push([lat, lon]);
      }
    }
    const labels = [...beaches].filter(([, ps]) => ps.length >= 3).sort((a, b) => b[1].length - a[1].length).slice(0, 12)
      .map(([b, ps]) => [b, median(ps.map(p => p[0])), median(ps.map(p => p[1])), 'right']);
    return {
      region, runs: rs.length, labels,
      center: [median(rs.flatMap(r => [r.start_lon, r.end_lon])), median(rs.flatMap(r => [r.start_lat, r.end_lat]))],
    };
  }).sort((a, b) => b.runs - a.runs);
}

// The rider's overview cells and the islands.
export async function fetchRiderHeatmap(rider) {
  const [cells, isl] = await Promise.all([cellsAt(riderPath(rider, 'overview.csv')), islands()]);
  return { rider, cells, islands: isl };
}

// Never closer than this many degrees across, so the islands show.
const MIN_SPAN = 0.6;

function overviewMap({ cells, islands: isl }, regions, { width, onPick }) {
  let [[w, s], [e, n]] = pad(extent(cells, OVERVIEW_CELL), 0.08);
  const grow = (lo, hi) => { const d = Math.max(0, MIN_SPAN - (hi - lo)) / 2; return [lo - d, hi + d]; };
  [w, e] = grow(w, e);
  [s, n] = grow(s, n);
  const m = baseMap([[w, s], [e, n]], isl, width, Math.max(260, width * 0.6));
  m.box.append(heatLayer(cells, OVERVIEW_CELL, m.proj, m.W, m.H, LUT, { minAlpha: 140, blur: 1 }));
  const svg = overlay(m.W, m.H);
  const r = d3.scaleSqrt().domain([0, d3.max(regions, d => d.runs)]).range([6, Math.max(14, m.W / 28)]);
  for (const reg of regions) {
    const [x, y] = m.proj(reg.center);
    const g = svg.append('g').style('cursor', 'pointer').on('click', () => onPick(reg));
    g.append('circle').attr('cx', x).attr('cy', y).attr('r', r(reg.runs) + 4).attr('fill', 'transparent')
      .attr('stroke', '#e6edf3').attr('stroke-width', 1.5).attr('stroke-dasharray', '3 3');
    // Right of the circle, or left of it where that would run off the map.
    const label = `${reg.region} · ${reg.runs}`, room = m.W - (x + r(reg.runs) + 8);
    const left = room < label.length * (m.W < 500 ? 6 : 7);
    halo(g.append('text').attr('x', left ? x - r(reg.runs) - 8 : x + r(reg.runs) + 8).attr('y', y + 4)
      .attr('text-anchor', left ? 'end' : 'start').attr('fill', '#e6edf3')).text(label);
  }
  m.box.append(svg.node());
  return m.box;
}

const PILL = 'border: 1px solid var(--theme-foreground-faint); border-radius: 999px; padding: 0.15rem 0.65rem; font: inherit; font-size: 0.8rem; background: var(--theme-background); color: var(--theme-foreground); cursor: pointer;';

// The rider page's card: the overview, a pill per region, and the popup.
export function riderHeatmapCard(heat, runs, { resize }) {
  const regions = riderRegions(runs);
  if (!heat.cells.length || !regions.length) return html`<div class="card"><div class="muted">No trail map yet.</div></div>`;
  const pick = reg => openRegion(heat, reg);
  return html`<div class="card">
    <div class="muted" style="font-size: 0.85rem; margin-bottom: 0.5rem;">${d3.sum(regions, d => d.runs)} runs in ${regions.length} region${regions.length > 1 ? 's' : ''}. Tap a region for its trails.</div>
    ${resize(width => overviewMap(heat, regions, { width, onPick: pick }))}
    <div style="display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.6rem;">${regions.map(reg =>
      Object.assign(html`<button style=${PILL}>${reg.region} ${reg.runs}</button>`, { onclick: () => pick(reg) }))}</div>
  </div>`;
}

// What a region's popup shows: its cells and beaches, with room east of
// them for the beach names.
function regionView(cells, labels) {
  let [[w, s], [e, n]] = pad(extent(cells, CELL), 0.004);
  for (const [, lat, lon] of labels) {
    w = Math.min(w, lon - 0.004); e = Math.max(e, lon + 0.025);
    s = Math.min(s, lat - 0.004); n = Math.max(n, lat + 0.004);
  }
  return [[w, s], [e, n]];
}

// The region's heatmap in a popup over the page, with everyone's runs in
// gray behind the rider's at the flip of a switch.
async function openRegion(heat, reg) {
  const dialog = html`<dialog style="padding: 0; border: none; border-radius: 10px; width: fit-content; min-width: min(96vw, 360px); max-width: 96vw; max-height: 96vh;
    background: var(--theme-background-alt, var(--theme-background)); color: var(--theme-foreground); box-shadow: 0 10px 40px rgba(0,0,0,0.45);">`;
  const close = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());
  // A click on the backdrop lands on the dialog itself.
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  const everyone = html`<input type="checkbox">`;
  const mapDiv = html`<div><div class="muted" style="padding: 2rem; text-align: center;">Loading…</div></div>`;
  const toggle = html`<label style="display: none; align-items: center; gap: 0.35rem; font-size: 0.85rem;">${everyone} Show everyone's</label>`;
  const note = html`<div class="muted" style="font-size: 0.8rem;"></div>`;
  dialog.append(html`<div style="padding: 0.75rem 1rem 1rem;">
    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.25rem;">
      <h2 style="margin: 0; font-size: 1.1rem; flex: 1;">${reg.region} · ${reg.runs} run${reg.runs > 1 ? 's' : ''}</h2>
      ${toggle}
      ${Object.assign(html`<button aria-label="Close" style="border: none; background: none; color: inherit; font-size: 1.4rem; line-height: 1; cursor: pointer;">×</button>`, { onclick: close })}
    </div>
    ${note}
    ${mapDiv}
    ${heatmapLegend()}
  </div>`);
  document.body.append(dialog);
  dialog.showModal();

  const [mine, all] = await Promise.all([
    cellsAt(riderPath(heat.rider, `region%3D${regionSlug(reg.region)}/data.csv`)),
    cellsAt(regionPath(reg.region)),
  ]);
  if (all.length) toggle.style.display = 'flex';
  const draw = () => {
    if (!dialog.open) return;
    const width = Math.min(window.innerWidth * 0.96, 1100) - 32;
    const maxHeight = window.innerHeight * 0.96 - 120;
    note.textContent = everyone.checked ? 'Yours in color over every rider\'s in gray.' : '';
    mapDiv.replaceChildren(mine.length
      ? renderHeatmap({ cells: mine, islands: heat.islands, labels: reg.labels, under: everyone.checked ? all : null,
        view: regionView(everyone.checked ? [...mine, ...all] : mine, reg.labels) }, { width, maxHeight })
      : html`<div class="muted" style="padding: 2rem; text-align: center;">No trail map for this region yet.</div>`);
  };
  everyone.onchange = draw;
  draw();
}
