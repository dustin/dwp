// A 296×128 tide card for one spot, in the MagTag panel's four greys
// (magtag.md?card=tide&spot=…): the next day's curve from a few hours
// back, highs and lows, and the span above the spot's "enough" level.

import { WIDTH, HEIGHT, BLACK, DARK, LIGHT, WHITE, paint, text, width, hstClock } from './magtag.js';
import { heightAt, enoughSpans } from './tides.js';

// The curve runs from BACK before now to AHEAD after it.
const BACK = 3 * 3600 * 1000;
const AHEAD = 21 * 3600 * 1000;

const ft = h => `${h.toFixed(1)}′`;

export function renderTideMagTag(canvas, { spot, extremes, now = new Date() }) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const start = new Date(+now - BACK);
  const end = new Date(+now + AHEAD);
  const h = heightAt(extremes, now);
  if (h == null) {
    paint(ctx, BLACK, c => text(c, 'No tide data', WIDTH / 2, 72, { size: 24, align: 'center' }));
    return null;
  }
  const rising = heightAt(extremes, new Date(+now + 6e5)) > h;

  // Top: the spot, and the height now with which way it's going.
  const head = `${ft(h)} ${rising ? '↑' : '↓'}`;
  paint(ctx, BLACK, c => {
    text(c, spot.name, 2, 15, { size: 15 });
    text(c, head, WIDTH - 2, 16, { size: 18, align: 'right' });
  });

  // The chart, with a little headroom for the high labels.
  const chart = { x0: 2, x1: WIDTH - 3, y0: 32, y1: 100 };
  const ex = extremes.filter(e => e.time >= start && e.time <= end);
  const lo = Math.min(0, ...ex.map(e => e.height));
  const hi = Math.max(2, ...ex.map(e => e.height));
  const xOf = t => chart.x0 + ((t - start) / (end - start)) * (chart.x1 - chart.x0);
  // Lows sit 16px up so their labels fit beneath them.
  const yOf = v => chart.y1 - 16 - ((v - lo) / (hi - lo)) * (chart.y1 - 16 - chart.y0);
  const pts = [];
  for (let x = chart.x0; x <= chart.x1; x++) {
    const t = new Date(+start + ((x - chart.x0) / (chart.x1 - chart.x0)) * (end - start));
    pts.push([x, yOf(heightAt(extremes, t))]);
  }
  const area = (c, top) => {
    c.beginPath();
    c.moveTo(chart.x0, chart.y1 + 4);
    for (const [x, y] of pts) c.lineTo(x, top(y));
    c.lineTo(chart.x1, chart.y1 + 4);
    c.closePath();
    c.fill();
  };
  const level = spot.enough;
  paint(ctx, LIGHT, c => area(c, y => y));
  if (level != null) {
    const ly = yOf(level);
    paint(ctx, DARK, c => {
      c.save();
      c.beginPath();
      c.rect(chart.x0, 0, chart.x1 - chart.x0 + 1, ly);
      c.clip();
      area(c, y => y);
      c.restore();
    });
    paint(ctx, BLACK, c => {
      for (let x = chart.x0; x < chart.x1; x += 6) c.fillRect(x, Math.round(ly), 3, 1);
    });
  }
  paint(ctx, BLACK, c => {
    c.lineWidth = 2;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  });

  // Now: a dotted line through the chart.
  paint(ctx, BLACK, c => {
    const x = Math.round(xOf(now));
    for (let y = chart.y0 - 6; y <= chart.y1 + 4; y += 3) c.fillRect(x, y, 1, 2);
  });

  // Highs above their peaks, lows beneath, kept on the panel. Highs get a
  // white patch so the curve doesn't run through the digits.
  const labels = ex.map(e => {
    const s = `${hstClock(e.time)} ${ft(e.height)}`;
    const w = width(ctx, s, { size: 11 });
    const x = Math.min(WIDTH - 2 - w / 2, Math.max(2 + w / 2, xOf(e.time)));
    const y = e.high ? yOf(e.height) - 5 : yOf(e.height) + 14;
    return { s, w, x, y, high: e.high };
  });
  paint(ctx, WHITE, c => {
    for (const { w, x, y, high } of labels) if (high) c.fillRect(x - w / 2 - 1, y - 10, w + 2, 12);
  });
  paint(ctx, BLACK, c => {
    for (const { s, x, y } of labels) text(c, s, x, y, { size: 11, align: 'center' });
  });

  // Bottom: the next spans above "enough".
  const spans = level == null ? [] : enoughSpans(extremes, level, now, end);
  const next = high => ex.find(e => e.time > now && e.high === high);
  const line = level == null
    ? [next(true) && `high ${hstClock(next(true).time)}`, next(false) && `low ${hstClock(next(false).time)}`].filter(Boolean).join(', ')
    : spans.length
      ? `≥${ft(level)} ` + spans.slice(0, 2).map(s => `${+s.start === +now ? 'now' : hstClock(s.start)}–${+s.end === +end ? '' : hstClock(s.end)}`).join(', ')
      : `below ${ft(level)} all day`;
  paint(ctx, BLACK, c => {
    text(c, line, 2, 125, { size: 13 });
    text(c, hstClock(now), WIDTH - 2, 125, { size: 11, align: 'right' });
  });
  return h;
}
