// A 296×128 buoy card for an Adafruit MagTag's 4-level greyscale e-ink
// panel (magtag.md). Drawn on a canvas one element at a time, each element
// thresholded to a single solid grey, so the page holds only the panel's
// four colors: no anti-aliased edges for the panel to dither.

import { compassPoint } from './spectrum.js';
import { toHstParam } from './data.js';

export const WIDTH = 296;
export const HEIGHT = 128;

// The panel's four levels.
export const BLACK = '#000000';
export const DARK = '#555555';
export const LIGHT = '#aaaaaa';
export const WHITE = '#ffffff';

const FONT = '"DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif';

// Readings older than this are flagged rather than shown as current.
const STALE_MS = 3 * 3600 * 1000;

// Draw with `draw(ctx)` in black, then lay it down as solid `color`
// wherever coverage is at least half. Every pixel ends up either untouched
// or exactly `color`.
function paint(ctx, color, draw) {
  const layer = document.createElement('canvas');
  layer.width = WIDTH;
  layer.height = HEIGHT;
  const lctx = layer.getContext('2d');
  lctx.fillStyle = lctx.strokeStyle = BLACK;
  draw(lctx);
  const img = lctx.getImageData(0, 0, WIDTH, HEIGHT);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const on = px[i + 3] >= 128;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = on ? 255 : 0;
  }
  lctx.putImageData(img, 0, 0);
  ctx.drawImage(layer, 0, 0);
}

function text(ctx, s, x, y, { size, weight = 'bold', align = 'left' }) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

function width(ctx, s, { size, weight = 'bold' }) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  return ctx.measureText(s).width;
}

const hstClock = ts => toHstParam(ts).slice(11, 16);
const hstDate = ts => toHstParam(ts).slice(5, 10).replace('-', '/');

// `readings` are grouped swell_partition rows (fetchSwellPartitionWindow)
// covering the trend window, oldest first; the newest with an overall
// (rank 1) reading is the one shown. `now` decides staleness.
export function renderMagTag(canvas, readings, { now = new Date(), trendHours = 24 } = {}) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const overall = readings
    .map(d => ({ ts: d.ts, ...d.values.find(v => v.rank === 1) }))
    .filter(d => d.rank === 1);
  const latest = overall.at(-1);
  if (!latest) {
    paint(ctx, BLACK, c => text(c, 'No buoy data', WIDTH / 2, 72, { size: 24, align: 'center' }));
    return null;
  }

  // Left: the overall height, huge, with period and direction under it.
  const height = latest.height.toFixed(1);
  const hw = width(ctx, height, { size: 66 });
  paint(ctx, BLACK, c => {
    text(c, height, 4, 58, { size: 66 });
    text(c, 'ft', 4 + hw + 3, 58, { size: 20 });
    text(c, `${Math.round(latest.period)}s ${compassPoint(latest.direction)}`, 4, 96, { size: 30 });
  });

  // Footer: when, plus the reading's kJ.
  const stale = now - latest.ts > STALE_MS;
  const when = stale ? `${hstDate(latest.ts)} ${hstClock(latest.ts)}` : hstClock(latest.ts);
  const kj = latest.surflineKJ == null ? '' : `${Math.round(latest.surflineKJ)} kJ`;
  paint(ctx, DARK, c => {
    text(c, [`${Math.round(latest.direction)}°`, kj].filter(Boolean).join('  '), 4, 121, { size: 15 });
  });
  paint(ctx, stale ? BLACK : DARK, c => text(c, when, WIDTH - 4, 121, { size: 15, align: 'right' }));

  // Right: the height over the trend window, as a step line over a light
  // fill. Each reading holds until the next; gaps over two hours are left
  // empty.
  const chart = { x0: 172, x1: WIDTH - 4, y0: 8, y1: 100 };
  const span = trendHours * 3600 * 1000;
  const start = +latest.ts - span;
  const trend = overall.filter(d => +d.ts >= start);
  const lo = Math.max(0, Math.floor(Math.min(...trend.map(d => d.height)) - 0.5));
  const hi = Math.ceil(Math.max(...trend.map(d => d.height)) + 0.25);
  const xOf = t => chart.x0 + Math.round(((+t - start) / span) * (chart.x1 - chart.x0));
  const yOf = h => chart.y1 - Math.round(((h - lo) / (hi - lo)) * (chart.y1 - chart.y0));
  const steps = trend.map((d, i) => {
    const next = trend[i + 1];
    const end = !next ? xOf(d.ts) + 1 : +next.ts - +d.ts > 2 * 3600 * 1000 ? xOf(d.ts) + 2 : xOf(next.ts);
    return { x: xOf(d.ts), end, y: yOf(d.height) };
  });

  paint(ctx, DARK, c => {
    text(c, String(hi), chart.x0 - 5, chart.y0 + 6, { size: 13, align: 'right' });
    text(c, String(lo), chart.x0 - 5, chart.y1, { size: 13, align: 'right' });
  });
  paint(ctx, LIGHT, c => {
    for (const s of steps) c.fillRect(s.x, s.y, s.end - s.x, chart.y1 - s.y + 1);
    // Dotted rule at the top value.
    for (let x = chart.x0; x <= chart.x1; x += 3) c.fillRect(x, chart.y0, 1, 1);
  });
  paint(ctx, BLACK, c => {
    steps.forEach((s, i) => {
      c.fillRect(s.x, s.y, s.end - s.x, 2);
      const prev = steps[i - 1];
      if (prev && prev.end === s.x) c.fillRect(s.x, Math.min(prev.y, s.y), 2, Math.abs(prev.y - s.y) + 2);
    });
    c.fillRect(chart.x0, chart.y1 + 1, chart.x1 - chart.x0 + 1, 1);
  });

  return latest;
}
