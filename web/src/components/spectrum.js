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
    const bins = withBinEdges(rows).filter(d => d.hi > FREQ_DOMAIN[0] && d.lo < FREQ_DOMAIN[1]);
    const yMax = d3.max(bins, d => d.energy) || 1;

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 50,
      marginTop: 20,
      marginRight: partitions.length ? 90 : 20,
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
