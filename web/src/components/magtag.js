// A 296×128 buoy card for an Adafruit MagTag's 4-level greyscale e-ink
// panel (magtag.md). Drawn on a canvas one element at a time, each element
// thresholded to a single solid grey, so the page holds only the panel's
// four colors: no anti-aliased edges for the panel to dither.

import { compassPoint } from './spectrum.js';
import { withBinEdges } from './spectral-partitions.js';
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

// The compass rim is this period (longer swells sit on it), with a ring at
// half of it. The spectrum spans 20s to ~3.3s.
const RIM_PERIOD = 16;
const FREQ_DOMAIN = [1 / 20, 0.3];
const PERIOD_TICKS = [12, 6, 4];

// `spectrum` is one reading's flat swell_spectrum rows, `partitions` its
// partitionReading (largest first), `sampleTs` when it was measured, and
// `overall` NDBC's rank 1 reading nearest it, or null. Without a spectrum
// the card falls back to the overall reading. `now` decides staleness.
export function renderMagTag(canvas, { spectrum, partitions, sampleTs, overall, now = new Date() }) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // The swells for the compass: the spectrum's partitions, or else just
  // the overall reading.
  const swells = partitions.length ? partitions : overall ? [overall] : [];
  const dominant = swells[0];
  if (!dominant) {
    paint(ctx, BLACK, c => text(c, 'No buoy data', WIDTH / 2, 72, { size: 24, align: 'center' }));
    return null;
  }
  const ts = sampleTs ?? spectrum[0]?.ts ?? overall.ts;

  // Left: the overall sea state (NDBC's reading), big: height, period and
  // direction, then its kJ and when. Falls back to the dominant swell.
  const sea = overall ?? dominant;
  // The swell behind NDBC's dominant period: the partition whose band holds
  // it (else the biggest). It's drawn black so the compass and spectrum
  // point at the big numbers.
  const lead = partitions.find(p => 1 / sea.period >= p.freqLo && 1 / sea.period <= p.freqHi) ?? dominant;
  // Big numbers shrink to keep clear of the compass (10ft+, 10s+).
  const LEFT_W = 92;
  const fit = (s, unit) => {
    let size = 42;
    while (size > 24 && width(ctx, s, { size }) + 2 + width(ctx, unit, { size: 15 }) > LEFT_W) size--;
    return size;
  };
  const height = sea.height.toFixed(1);
  const hs = fit(height, 'ft');
  const hw = width(ctx, height, { size: hs });
  const period = `${Math.round(sea.period)}`;
  const ps = fit(period, 's');
  const pw = width(ctx, period, { size: ps });
  paint(ctx, BLACK, c => {
    text(c, height, 2, 38, { size: hs });
    text(c, 'ft', 2 + hw + 2, 38, { size: 15 });
    text(c, period, 2, 82, { size: ps });
    text(c, 's', 2 + pw + 2, 82, { size: 15 });
    text(c, `${compassPoint(sea.direction)} ${Math.round(sea.direction)}°`, 2, 100, { size: 14 });
  });
  const stale = now - ts > STALE_MS;
  const when = stale ? `${hstDate(ts)} ${hstClock(ts)}` : hstClock(ts);
  paint(ctx, BLACK, c => {
    const line = [
      sea.surflineKJ == null ? null : `${Math.round(sea.surflineKJ)} kJ`,
      partitions.length ? null : 'no spectrum',
    ].filter(Boolean).join(' · ');
    text(c, line, 2, 112, { size: 12 });
  });
  paint(ctx, BLACK, c => text(c, when, 2, 125, { size: 12 }));

  // Middle: a compass with each swell at its direction and at a distance
  // out set by its period (rim = 16s, ring = 8s), its spoke pointing the way it
  // travels. The swell behind the dominant period is black, the rest dark grey; dot size is
  // height.
  const cx = 146;
  const cy = 64;
  const R = 50;
  const at = (deg, r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const ring = (c, r, step) => {
    for (let deg = 0; deg < 360; deg += step) {
      const [x, y] = at(deg, r);
      c.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  };
  paint(ctx, LIGHT, c => {
    ring(c, R * 0.5, 6);
    // Cardinal ticks.
    for (const deg of [90, 180, 270]) {
      const [x0, y0] = at(deg, R - 5);
      const [x1, y1] = at(deg, R);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    }
  });
  paint(ctx, DARK, c => {
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cx, cy, R, 0, 2 * Math.PI);
    c.stroke();
    text(c, 'N', cx, cy - R + 13, { size: 12, align: 'center' });
  });
  const maxH = Math.max(...swells.map(p => p.height));
  const swell = (c, p, lineWidth) => {
    const [x, y] = at(p.direction, Math.min(p.period / RIM_PERIOD, 1) * R);
    const [hx, hy] = at(p.direction, 4);
    c.lineWidth = lineWidth;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(hx, hy);
    c.stroke();
    c.beginPath();
    c.arc(x, y, 2 + 3 * Math.sqrt(p.height / maxH), 0, 2 * Math.PI);
    c.fill();
  };
  for (const p of swells.filter(p => p !== lead).reverse()) paint(ctx, DARK, c => swell(c, p, 2));
  paint(ctx, BLACK, c => swell(c, lead, 3));

  // Right: energy by period, on a linear frequency axis like the dashboard's
  // spectrum. That swell's bins are black.
  const chart = { x0: 202, x1: WIDTH - 3, y0: 6, y1: 110 };
  const bins = withBinEdges(spectrum).filter(d => d.hi > FREQ_DOMAIN[0] && d.lo < FREQ_DOMAIN[1]);
  const eMax = Math.max(1e-9, ...bins.map(d => d.energy));
  const xOf = f =>
    chart.x0 + Math.round(((Math.min(Math.max(f, FREQ_DOMAIN[0]), FREQ_DOMAIN[1]) - FREQ_DOMAIN[0]) / (FREQ_DOMAIN[1] - FREQ_DOMAIN[0])) * (chart.x1 - chart.x0));
  const yOf = e => chart.y1 - Math.round((e / eMax) * (chart.y1 - chart.y0));
  const inDominant = d => d.freq >= lead.freqLo && d.freq <= lead.freqHi;
  const bars = (c, keep) => {
    for (const d of bins.filter(keep)) {
      const x0 = xOf(d.lo);
      const x1 = xOf(d.hi);
      if (x1 - x0 < 1) continue;
      // A 1px gap between bars, except where bins are too narrow to spare it.
      const w = x1 - x0 >= 4 ? x1 - x0 - 1 : x1 - x0;
      c.fillRect(x0, yOf(d.energy), w, chart.y1 - yOf(d.energy) + 1);
    }
  };
  paint(ctx, DARK, c => bars(c, d => !inDominant(d)));
  paint(ctx, BLACK, c => bars(c, inDominant));
  paint(ctx, LIGHT, c => {
    c.fillRect(chart.x0, chart.y1 + 1, chart.x1 - chart.x0 + 1, 1);
    for (const p of PERIOD_TICKS) c.fillRect(xOf(1 / p), chart.y1 + 2, 1, 2);
  });
  paint(ctx, DARK, c => {
    for (const p of PERIOD_TICKS) text(c, `${p}s`, xOf(1 / p), 125, { size: 12, align: 'center' });
  });

  return dominant;
}
