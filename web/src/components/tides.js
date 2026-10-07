import * as Plot from 'npm:@observablehq/plot';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';

// NOAA CO-OPS stations. Kīhei and Lahaina are subordinates of Kahului,
// so NOAA only publishes their highs and lows; the curve between is
// NOAA's own half-cosine interpolation, used for all so they read the same.
export const STATIONS = {
  kahului: { id: '1615680', name: 'Kahului Harbor' },
  kihei: { id: 'TPT2797', name: 'Kīhei (Maʻalaea Bay)' },
  lahaina: { id: 'TPT2799', name: 'Lahaina' },
};

// `enough` is the height (ft above MLLW) a spot wants; null for no line.
// `region` groups spots on the tides page, in this order.
export const SPOTS = [
  { name: 'Maʻalaea', region: 'Kīhei', station: 'kihei', enough: 1.0 },
  { name: 'Kaipukaihina', region: 'Kīhei', station: 'kihei', enough: 1.6 },
  { name: 'Ukumehame', region: 'West Side', station: 'kihei', enough: 1.6 },
  { name: 'Guardrails', region: 'West Side', station: 'lahaina', enough: 1.0 },
  { name: 'Kaʻa', region: 'North Shore', station: 'kahului', enough: null },
];

// "Kaʻa" → "kaa", for URLs.
export const spotSlug = spot => spot.name.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();

const ymd = d3.utcFormat('%Y%m%d');

// Highs and lows, as [{time, height, high}], for [start, end] padded a
// day either side so the curve has extremes beyond both edges.
export async function fetchExtremes(station, start, end) {
  const params = new URLSearchParams({
    product: 'predictions',
    station: STATIONS[station].id,
    begin_date: ymd(d3.utcDay.offset(start, -1)),
    end_date: ymd(d3.utcDay.offset(end, 1)),
    datum: 'MLLW',
    units: 'english',
    time_zone: 'gmt',
    interval: 'hilo',
    format: 'json',
    application: 'dwp',
  });
  const res = await fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?${params}`);
  if (!res.ok) throw new Error(`NOAA ${res.status}`);
  const json = await res.json();
  if (!json.predictions) throw new Error(json.error?.message ?? 'no predictions');
  return json.predictions.map(p => ({
    time: new Date(p.t.replace(' ', 'T') + 'Z'),
    height: +p.v,
    high: p.type === 'H',
  }));
}

// Height at time t, between the extremes on either side.
export function heightAt(extremes, t) {
  const i = d3.bisector(e => e.time).right(extremes, t);
  const a = extremes[i - 1], b = extremes[i];
  if (!a || !b) return null;
  const f = (t - a.time) / (b.time - a.time);
  return a.height + ((b.height - a.height) * (1 - Math.cos(Math.PI * f))) / 2;
}

// Times the curve crosses `level`, each tagged rising or falling.
export function crossings(extremes, level) {
  const out = [];
  for (let i = 1; i < extremes.length; i++) {
    const a = extremes[i - 1], b = extremes[i];
    if ((level - a.height) * (level - b.height) >= 0) continue;
    const f = Math.acos(1 - (2 * (level - a.height)) / (b.height - a.height)) / Math.PI;
    out.push({ time: new Date(+a.time + f * (b.time - a.time)), height: level, rising: b.height > a.height });
  }
  return out;
}

// Spans at or above `level`, clipped to [start, end].
export function enoughSpans(extremes, level, start, end) {
  const xs = crossings(extremes, level);
  const spans = [];
  let from = heightAt(extremes, start) >= level ? start : null;
  for (const x of xs) {
    if (x.rising) from = x.time;
    else if (from) { spans.push({ start: from, end: x.time }); from = null; }
  }
  if (from) spans.push({ start: from, end });
  return spans.filter(s => s.end > start && s.start < end)
    .map(s => ({ start: s.start < start ? start : s.start, end: s.end > end ? end : s.end }));
}

const ft = h => `${h.toFixed(1)}′`;
const dur = ms => `${Math.floor(ms / 36e5)}h${String(Math.round((ms % 36e5) / 6e4)).padStart(2, '0')}`;

export function renderTideChart(spot, extremes, { start, end, now, width }) {
  const curve = d3.utcMinute.every(10).range(start, +end + 1).map(time => ({ time, height: heightAt(extremes, time) }));
  const inDay = d => d.time >= start && d.time <= end;
  const ex = extremes.filter(inDay);
  const level = spot.enough;
  const xs = level == null ? [] : crossings(extremes, level).filter(inDay);
  const spans = level == null ? [] : enoughSpans(extremes, level, start, end);
  const showNow = now >= start && now <= end;
  const yMax = Math.max(3, d3.max(ex, d => d.height) + 0.6);

  return Plot.plot({
    width,
    height: 260,
    marginLeft: 36,
    marginTop: 24,
    x: { type: 'time', domain: [start, end], tickFormat: fmt.timeTick, ticks: d3.timeHour.every(width < 500 ? 6 : 3) },
    y: { domain: [Math.min(-0.3, d3.min(ex, d => d.height) - 0.4), yMax], label: 'ft', grid: true, tickFormat: d => `${d}′` },
    marks: [
      Plot.areaY(curve, { x: 'time', y: 'height', fill: 'var(--theme-blue, #4269d0)', fillOpacity: 0.12 }),
      level == null ? null : Plot.areaY(curve, {
        x: 'time', y1: level, y2: d => Math.max(d.height, level),
        fill: 'var(--theme-blue, #4269d0)', fillOpacity: 0.4,
      }),
      Plot.line(curve, { x: 'time', y: 'height', stroke: 'var(--theme-blue, #4269d0)', strokeWidth: 2 }),
      level == null ? null : Plot.ruleY([level], { stroke: 'var(--theme-red, #ff725c)', strokeDasharray: '4,3' }),
      // Where "enough" starts and ends, with how long it lasts.
      Plot.dot(xs, { x: 'time', y: 'height', r: 3.5, fill: 'var(--theme-red, #ff725c)' }),
      // One label per span, under the line: "09:42–15:30" and its length,
      // kept inside the plot so the edges don't clip it.
      Plot.text(spans, {
        x: s => {
          const pad = (45 / Math.max(1, width - 56)) * (end - start);
          return new Date(Math.min(+end - pad, Math.max(+start + pad, (+s.start + +s.end) / 2)));
        },
        y: () => level,
        text: s => `${+s.start === +start ? '' : fmt.clock(s.start)}–${+s.end === +end ? '' : fmt.clock(s.end)}\n${dur(s.end - s.start)}`,
        lineAnchor: 'top', dy: 6, fill: 'var(--theme-red, #ff725c)', fontWeight: 600,
        stroke: 'var(--theme-background)', strokeWidth: 3, paintOrder: 'stroke',
      }),
      // Highs and lows.
      Plot.dot(ex, { x: 'time', y: 'height', r: 4, fill: d => (d.high ? 'var(--theme-blue, #4269d0)' : 'var(--theme-background)'), stroke: 'var(--theme-blue, #4269d0)', strokeWidth: 2 }),
      ...[true, false].map(high => Plot.text(ex.filter(d => d.high === high), {
        x: 'time', y: 'height', text: d => `${fmt.clock(d.time)} ${ft(d.height)}`,
        dy: high ? -12 : 14, fontWeight: 600, fill: 'currentColor', stroke: 'var(--theme-background)', strokeWidth: 3, paintOrder: 'stroke',
      })),
      showNow ? Plot.ruleX([now], { stroke: 'var(--theme-orange, #efb118)', strokeWidth: 2 }) : null,
      showNow ? Plot.dot([{ time: now, height: heightAt(extremes, now) }], { x: 'time', y: 'height', r: 5, fill: 'var(--theme-orange, #efb118)' }) : null,
    ],
  });
}

// "1.2′ rising, enough until 15:43" for the spot's header.
export function nowSummary(spot, extremes, now) {
  const h = heightAt(extremes, now);
  if (h == null) return '';
  const rising = heightAt(extremes, new Date(+now + 6e5)) > h;
  let s = `${ft(h)} ${rising ? 'rising ↑' : 'falling ↓'}`;
  if (spot.enough != null) {
    const next = crossings(extremes, spot.enough).find(x => x.time > now);
    if (next) s += h >= spot.enough ? `, enough until ${fmt.clock(next.time)}` : `, enough from ${fmt.clock(next.time)}`;
  }
  return s;
}
