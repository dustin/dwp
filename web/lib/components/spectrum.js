// CDIP-style spectrum plot (https://cdip.ucsd.edu/m/products/spectrum_plot/),
// modernized: a per-reading energy-by-period histogram colored by direction,
// plus overlays for comparing readings.
//
// Backed by swell_spectrum -- the raw, append-only per-frequency-bin archive
// (see db/swell/schema.sql) -- rather than swell_partition's already-banded
// components, so these charts show the actual spectral shape.
//
// Every chart here draws frequency bins as rects between their real bin
// edges on a linear frequency axis (NDBC bins aren't evenly spaced), labeled
// in period since that's what surfers read.

import * as Plot from 'npm:@observablehq/plot';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';
import { withBinEdges } from './spectral-partitions.js';

const COMPASS_16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compassPoint(deg) {
  return COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function formatDirection(deg) {
  return `${Math.round(deg)}° ${compassPoint(deg)}`;
}

// Direction is circular (0 == 360), so it needs a cyclical hue wheel.
// Sinebow rather than rainbow: rainbow runs purple→pink→red through N, NE
// and E, which made a NW swell, a N swell and an E trade swell all read as
// the same reddish purple. Sinebow puts N at red, NE orange, E yellow-green,
// S cyan, W blue and NW magenta. Shared across every chart so direction
// colors stay consistent wherever they show up.
export const DIRECTION_COLOR = {
  type: 'linear',
  domain: [0, 360],
  scheme: 'sinebow',
  legend: true,
  label: 'Direction (from)',
  ticks: d3.range(0, 361, 45),
  tickFormat: d => compassPoint(d),
};

export function directionColor(deg) {
  return d3.interpolateSinebow((((deg % 360) + 360) % 360) / 360);
}

export function periodOf(freq) {
  return 1 / freq;
}

// Frequency domain worth showing: 25s down to ~2.9s. Longer is empty at
// Pauwela; shorter is chop.
const FREQ_DOMAIN = [0.04, 0.35];
const PERIOD_TICKS = [20, 15, 12, 10, 8, 7, 6, 5, 4, 3];

function periodAxis(label = 'Period (s)') {
  return {
    domain: FREQ_DOMAIN,
    ticks: PERIOD_TICKS.map(p => 1 / p),
    tickFormat: f => `${Math.round(1 / f)}`,
    label,
  };
}

function binTitle(d) {
  return (
    `${periodOf(d.freq).toFixed(1)}s (${d.freq.toFixed(3)} Hz)\n` +
    `${d.energy.toFixed(2)} m²/Hz from ${formatDirection(d.direction)} (r1 ${(+d.r1).toFixed(2)})`
  );
}

// Single-reading energy-by-period histogram -- the classic CDIP spectrum
// plot shape -- colored by direction so it doubles as a mini partition view
// of that one moment. Optional `partitions` (from partitionReading) are
// drawn as labeled brackets over the bins they cover.
export function renderSpectrumHistogram(rows, { height = 260, title = 'Spectral Energy', partitions = [] } = {}) {
  return width => {
    if (!rows || rows.length === 0) return null;
    const marginLeft = 50;
    const marginRight = partitions.length ? 90 : 20;
    // resize() can first call this before layout, with a width narrower than
    // the margins; the bars would get negative widths. Wait for a real one.
    if (width <= marginLeft + marginRight) return null;
    const bins = withBinEdges(rows).filter(d => d.hi > FREQ_DOMAIN[0] && d.lo < FREQ_DOMAIN[1]);
    const yMax = d3.max(bins, d => d.energy) || 1;

    return Plot.plot({
      title,
      width,
      height,
      marginLeft,
      marginTop: 20,
      marginRight,
      x: periodAxis(),
      y: { label: 'Energy density (m²/Hz)', grid: true, domain: [0, yMax * (1.05 + 0.1 * partitions.length)] },
      color: DIRECTION_COLOR,
      marks: [
        Plot.ruleY([0]),
        Plot.rectY(bins, {
          x1: 'lo',
          x2: 'hi',
          y: 'energy',
          fill: 'direction',
          insetLeft: 0.5,
          insetRight: 0.5,
          title: binTitle,
        }),
        ...partitionBrackets(partitions, yMax),
      ],
    });
  };
}

// Brackets stack one row per partition (in period order) above the bars so
// neighboring labels don't collide; each is labeled at its left end.
function partitionBrackets(partitions, yMax) {
  if (!partitions.length) return [];
  const data = partitions
    .slice()
    .sort((a, b) => a.peakFreq - b.peakFreq)
    .map((p, i) => ({
      ...p,
      x1: Math.max(p.freqLo, FREQ_DOMAIN[0]),
      x2: Math.min(p.freqHi, FREQ_DOMAIN[1]),
      y: yMax * (1.08 + 0.1 * i),
    }));
  return [
    Plot.link(data, {
      x1: 'x1',
      x2: 'x2',
      y1: 'y',
      y2: 'y',
      stroke: d => directionColor(d.direction),
      strokeWidth: 3,
    }),
    Plot.dot(data, { x: 'peakFreq', y: 'y', r: 3.5, fill: d => directionColor(d.direction), stroke: 'currentColor', strokeWidth: 0.5 }),
    Plot.text(data, {
      x: 'x2',
      y: 'y',
      dx: 4,
      textAnchor: 'start',
      fontSize: 10,
      text: d => `${d.height.toFixed(1)}' @ ${d.period.toFixed(0)}s ${compassPoint(d.direction)}`,
    }),
  ];
}

// Overlaid single-reading spectra for comparing conditions: energy by period
// as a step line per snapshot, and the direction of each bin as dots sized by
// energy, so differences in size, period and direction all show up.
// `series` is [{label, color, rows}].
export function renderSpectrumComparison(series, { height = 260, title = 'Spectral Energy' } = {}) {
  return width => {
    const data = series.flatMap(s =>
      withBinEdges(s.rows)
        .filter(d => d.freq >= FREQ_DOMAIN[0] && d.freq <= FREQ_DOMAIN[1])
        .map(d => ({ ...d, label: s.label }))
    );
    if (data.length === 0) return null;
    const color = {
      domain: series.map(s => s.label),
      range: series.map(s => s.color),
      legend: true,
    };

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 50,
      x: periodAxis(),
      y: { label: 'Energy density (m²/Hz)', grid: true },
      color,
      marks: [
        Plot.ruleY([0]),
        Plot.areaY(data, { x: 'freq', y1: 0, y2: 'energy', z: 'label', fill: 'label', fillOpacity: 0.12, curve: 'step' }),
        Plot.lineY(data, { x: 'freq', y: 'energy', z: 'label', stroke: 'label', strokeWidth: 2, curve: 'step' }),
        Plot.tip(data, Plot.pointerX({ x: 'freq', y: 'energy', title: d => `${d.label}\n${binTitle(d)}` })),
      ],
    });
  };
}

export function renderDirectionComparison(series, { height = 240, title = 'Direction by Period' } = {}) {
  return width => {
    const data = series.flatMap(s =>
      withBinEdges(s.rows)
        .filter(d => d.freq >= FREQ_DOMAIN[0] && d.freq <= FREQ_DOMAIN[1] && d.energy > 0 && d.direction <= 360)
        .map(d => ({ ...d, label: s.label, signedDirection: d.direction > 180 ? d.direction - 360 : d.direction }))
    );
    if (data.length === 0) return null;

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 50,
      x: periodAxis(),
      // Centered on north (-180..180) so a swell straddling N (350° vs 5°)
      // stays together; Pauwela's swells come from the NW through E.
      y: {
        label: 'From',
        domain: [-180, 180],
        ticks: d3.range(-180, 181, 45),
        tickFormat: d => compassPoint(d),
        grid: true,
      },
      r: { range: [0, 9] },
      color: { domain: series.map(s => s.label), range: series.map(s => s.color), legend: true },
      marks: [
        Plot.dot(data, {
          x: 'freq',
          y: 'signedDirection',
          r: 'energy',
          fill: 'label',
          fillOpacity: 0.6,
          stroke: 'label',
          title: d => `${d.label}\n${binTitle(d)}`,
        }),
      ],
    });
  };
}

// Waterfall: one spectrum per reading, newest at the front on the real
// period axis, older ones stepped back up and to the right like a 3D
// spectrogram seen from an angle. Each spectrum is filled with the card's
// background so newer ones hide the parts of older ones behind them, and
// stroked segment by segment in its bins' direction colors. Energy is on a
// square-root scale so a big groundswell peak doesn't flatten everything
// else. Longer windows are thinned to at most `maxReadings` rows. With
// `onSelect`, the rows behind the front one are clickable, calling
// onSelect(ts) with that reading's time (to bring it to the front).
// `sampleTime` maps NDBC's hourly slot time to when the spectrum was
// measured, for the labels.
export function renderSpectrumWaterfall(
  rows,
  // 25: a 24-hour window holds 25 hourly readings, counting both ends.
  { height = 420, title = 'Spectral Energy Over Time', maxReadings = 25, onSelect, sampleTime = ts => ts } = {}
) {
  return width => {
    if (!rows || rows.length === 0) return null;
    const byTs = d3.sort(d3.groups(rows, d => +d.ts), d => d[0]);
    const step = Math.ceil(byTs.length / maxReadings);
    // Thin from the newest end so the front row is always the latest reading.
    const readings = byTs
      .filter((_, i) => (byTs.length - 1 - i) % step === 0)
      .map(([t, bins]) => ({
        ts: new Date(t),
        bins: d3.sort(bins.filter(b => b.freq >= FREQ_DOMAIN[0] && b.freq <= FREQ_DOMAIN[1]), b => b.freq),
      }));
    const n = readings.length;

    const margin = { top: 28, right: 64, bottom: 36, left: 46 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    // How far the oldest row sits behind the front one.
    const depthX = n > 1 ? plotW * 0.22 : 0;
    const depthY = n > 1 ? plotH * 0.55 : 0;
    const frontW = plotW - depthX;
    const ampH = plotH - depthY * 0.75;
    const eMax = d3.max(rows, d => d.energy) || 1;

    const x = d3.scaleLinear().domain(FREQ_DOMAIN).range([0, frontW]);
    const amp = d3.scaleSqrt().domain([0, eMax]).range([0, ampH]);
    // depth 0 = newest (front), n - 1 = oldest (back)
    const offX = depth => (n > 1 ? (depth / (n - 1)) * depthX : 0);
    const offY = depth => (n > 1 ? (depth / (n - 1)) * depthY : 0);
    const baseY = depth => margin.top + plotH - offY(depth);
    const px = (f, depth) => margin.left + x(f) + offX(depth);
    const timeFmt = fmt.shortStamp;

    const svg = d3
      .create('svg')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'max-width: 100%; height: auto; font: 10px sans-serif; overflow: visible;');

    svg
      .append('text')
      .attr('x', 0)
      .attr('y', 12)
      .attr('fill', 'currentColor')
      .attr('style', 'font-size: 13px;')
      .text(title);

    // Back to front, so each newer row covers the older ones behind it.
    readings.forEach((r, i) => {
      const depth = n - 1 - i;
      const pts = r.bins.map(b => [px(b.freq, depth), baseY(depth) - amp(b.energy), b]);
      if (pts.length < 2) return;
      const g = svg.append('g');
      const selectable = onSelect && depth > 0;
      g.append('title').text(timeFmt(sampleTime(r.ts)) + (selectable ? ' \u2014 click to view this time' : ''));
      const y0 = baseY(depth);
      g.append('path')
        .attr('d', d3.line()([[pts[0][0], y0], ...pts.map(p => [p[0], p[1]]), [pts[pts.length - 1][0], y0]]))
        .attr('fill', 'var(--theme-background-alt, var(--theme-background))')
        .attr('stroke', 'none');
      g.append('line')
        .attr('x1', px(FREQ_DOMAIN[0], depth))
        .attr('x2', px(FREQ_DOMAIN[1], depth))
        .attr('y1', y0)
        .attr('y2', y0)
        .attr('stroke', 'currentColor')
        .attr('stroke-opacity', 0.12);
      // Older rows a little lighter; the newest one bold.
      const opacity = depth === 0 ? 1 : 0.85 - 0.45 * (depth / Math.max(1, n - 1));
      const strokeWidth = depth === 0 ? 2.5 : 1.3;
      d3.pairs(pts).forEach(([a, b]) => {
        // Direction is noise where there's next to no energy, so fade
        // near-empty bins rather than flashing random colors.
        const e = Math.max(a[2].energy, b[2].energy);
        const presence = Math.min(1, Math.max(0.15, 3 * Math.sqrt(e / eMax)));
        const segOpacity = opacity * (presence < 0.5 ? 0.35 : presence);
        g.append('line')
          .attr('x1', a[0])
          .attr('y1', a[1])
          .attr('x2', b[0])
          .attr('y2', b[1])
          .attr('stroke', presence < 0.5 ? 'currentColor' : directionColor(a[2].direction))
          .attr('stroke-opacity', segOpacity)
          .attr('stroke-width', strokeWidth)
          .attr('stroke-linecap', 'round')
          .attr('class', 'seg')
          // Remembered so a hover highlight can restore them.
          .attr('data-o', segOpacity)
          .attr('data-w', strokeWidth);
      });
      if (selectable) {
        // The fill under each line is the hit area: the visible band
        // between this row and the one in front of it.
        g.style('cursor', 'pointer')
          .on('click', () => onSelect(r.ts))
          .on('mouseenter', () => g.selectAll('line.seg').attr('stroke-width', 3).attr('stroke-opacity', 1))
          .on('mouseleave', function () {
            g.selectAll('line.seg').each(function () {
              const el = d3.select(this);
              el.attr('stroke-width', el.attr('data-w')).attr('stroke-opacity', el.attr('data-o'));
            });
          });
      }
      // Time labels down the right-hand edge: the front row, the back row,
      // and every few in between.
      const every = Math.max(1, Math.round(n / 6));
      if (depth === 0 || depth === n - 1 || depth % every === 0) {
        svg
          .append('text')
          .attr('x', px(FREQ_DOMAIN[1], depth) + 6)
          .attr('y', y0)
          .attr('dy', '0.32em')
          .attr('fill', 'currentColor')
          .attr('fill-opacity', depth === 0 ? 1 : 0.6)
          .attr('font-weight', depth === 0 ? 'bold' : null)
          .text(timeFmt(sampleTime(r.ts)));
      }
    });

    // Period axis along the front row.
    const axisY = baseY(0) + 4;
    const ticks = PERIOD_TICKS.map(p => 1 / p).filter(f => f >= FREQ_DOMAIN[0] && f <= FREQ_DOMAIN[1]);
    const ax = svg.append('g').attr('fill', 'currentColor');
    ticks.forEach(f => {
      ax.append('line')
        .attr('x1', px(f, 0))
        .attr('x2', px(f, 0))
        .attr('y1', axisY)
        .attr('y2', axisY + 5)
        .attr('stroke', 'currentColor');
      ax.append('text')
        .attr('x', px(f, 0))
        .attr('y', axisY + 16)
        .attr('text-anchor', 'middle')
        .text(Math.round(1 / f));
    });
    ax.append('text')
      .attr('x', margin.left + frontW)
      .attr('y', axisY + 30)
      .attr('text-anchor', 'end')
      .text('Period (s) \u2192');

    // Energy axis at the front row's left edge.
    const ey = svg.append('g').attr('fill', 'currentColor');
    amp.ticks(4).filter(e => e > 0).forEach(e => {
      const y = baseY(0) - amp(e);
      ey.append('line')
        .attr('x1', margin.left - 5)
        .attr('x2', margin.left)
        .attr('y1', y)
        .attr('y2', y)
        .attr('stroke', 'currentColor');
      ey.append('text')
        .attr('x', margin.left - 8)
        .attr('y', y)
        .attr('dy', '0.32em')
        .attr('text-anchor', 'end')
        .text(e);
    });
    ey.append('text')
      .attr('x', margin.left - 8)
      .attr('y', baseY(0) - ampH - 10)
      .attr('text-anchor', 'start')
      .text('\u2191 m\u00b2/Hz (\u221a scale)');

    return svg.node();
  };
}

// The reading closest to `ts` (defaults to the latest reading in `rows`),
// returned as the flat array of per-frequency-bin rows for just that time --
// what renderSpectrumHistogram expects.
export function readingNear(rows, ts) {
  if (!rows || rows.length === 0) return [];
  const target = ts ? +ts : d3.max(rows, d => +d.ts);
  const byTs = d3.group(rows, d => +d.ts);
  const closest = d3.least(byTs.keys(), t => Math.abs(t - target));
  return closest == null ? [] : byTs.get(closest);
}

// Sparkline-sized spectrum for summary cards: the same direction-colored
// bins as renderSpectrumHistogram, with only a few period ticks.
export function renderSpectrumSparkline(rows, { width = 200, height = 48 } = {}) {
  if (!rows || rows.length === 0) return null;
  // Out to 4s: shorter is chop, and on this scale it squeezes the swell.
  const domain = [FREQ_DOMAIN[0], 0.25];
  const bins = withBinEdges(rows).filter(d => d.hi > domain[0] && d.lo < domain[1]);
  return Plot.plot({
    width,
    height,
    marginTop: 2,
    marginLeft: 2,
    marginRight: 2,
    marginBottom: 11,
    style: { fontSize: '8px' },
    x: { domain, ticks: [1 / 20, 1 / 12, 1 / 8, 1 / 6, 1 / 5], tickFormat: f => `${Math.round(1 / f)}s`, tickSize: 2, label: null },
    y: { axis: null },
    marks: [
      Plot.rectY(bins, { x1: 'lo', x2: 'hi', y: 'energy', fill: d => directionColor(d.direction), insetLeft: 0.25, insetRight: 0.25 }),
      Plot.ruleY([0], { strokeOpacity: 0.3 }),
    ],
  });
}

// Tiny rose: spectral energy summed into 16 sectors by the direction it
// comes from, each wedge's length the square root of its share.
export function renderMiniRose(rows, { size = 64 } = {}) {
  if (!rows || rows.length === 0) return null;
  const sectors = 16, step = 360 / sectors;
  const bins = withBinEdges(rows).filter(d => d.hi > FREQ_DOMAIN[0] && d.lo < FREQ_DOMAIN[1]);
  const totals = d3.range(sectors).map(i => ({ deg: i * step, energy: 0 }));
  for (const d of bins) totals[Math.round((((d.direction % 360) + 360) % 360) / step) % sectors].energy += d.energy * (d.hi - d.lo);
  const max = d3.max(totals, d => d.energy) || 1;
  const r = size / 2 - 7;
  const arc = d3.arc().innerRadius(0);
  const svg = d3.create('svg').attr('width', size).attr('height', size).attr('viewBox', [-size / 2, -size / 2, size, size]).attr('preserveAspectRatio', 'xMinYMid meet');
  svg.append('circle').attr('r', r).attr('fill', 'none').attr('stroke', 'currentColor').attr('stroke-opacity', 0.2);
  svg.append('g').selectAll('path').data(totals.filter(d => d.energy > 0)).join('path')
    .attr('d', d => arc({ outerRadius: r * Math.sqrt(d.energy / max), startAngle: ((d.deg - step / 2) * Math.PI) / 180, endAngle: ((d.deg + step / 2) * Math.PI) / 180 }))
    .attr('fill', d => directionColor(d.deg));
  svg.append('text').attr('y', -r - 1).attr('text-anchor', 'middle').attr('font-size', 8).attr('fill', 'currentColor').attr('fill-opacity', 0.6).text('N');
  return svg.node();
}
