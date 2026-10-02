// CDIP-style spectrum plot (https://cdip.ucsd.edu/m/products/spectrum_plot/),
// modernized: a per-reading energy-by-period histogram, plus a time x period
// heatmap (a spectrogram) so a run's lead-in hours are visible too, not just
// the single latest reading CDIP shows.
//
// Backed by swell_spectrum -- the raw, append-only per-frequency-bin archive
// (see db/swell/schema.sql) -- rather than swell_partition's already-banded
// components, so these charts show the actual spectral shape.

import * as Plot from 'npm:@observablehq/plot';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';

// Direction is circular (0 == 360), so a cyclical hue wheel reads better
// than a sequential scheme -- the same idea as CDIP's own directional
// shading. Shared across every chart below so direction colors stay
// consistent wherever they show up.
export const DIRECTION_COLOR = {
  type: 'linear',
  domain: [0, 360],
  scheme: 'rainbow',
  legend: true,
  label: 'Direction (° true)',
};

export function periodOf(freq) {
  return 1 / freq;
}

// Time x period heatmap: each column is one spectral reading (NDBC publishes
// these hourly), each row a frequency bin, colored by energy density.
// `height` legend conveys where in the period spectrum energy is
// concentrated, and how that shifts over the window.
export function renderSpectrumHeatmap(rows, { height = 300, title = 'Spectral Energy' } = {}) {
  return width => {
    if (!rows || rows.length === 0) return null;

    // Longest period (lowest frequency) first so it renders at the top of
    // the chart, swell-to-chop top-to-bottom like CDIP's own plots.
    const freqs = Array.from(new Set(rows.map(d => d.freq))).sort(d3.ascending);

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 55,
      x: { type: 'utc', label: null, tickFormat: d3.timeFormat('%-m/%-d %H:%M') },
      y: {
        label: 'Period (s)',
        domain: freqs,
        tickFormat: f => periodOf(f).toFixed(0),
      },
      color: {
        type: 'log',
        scheme: 'inferno',
        label: 'Energy density (m²/Hz)',
        legend: true,
      },
      marks: [
        Plot.cell(rows, {
          x: 'ts',
          y: 'freq',
          fill: d => Math.max(d.energy, 1e-4),
          inset: 0.5,
          title: d =>
            `${fmt.time(d.ts)}\n${periodOf(d.freq).toFixed(1)}s (${d.freq.toFixed(3)} Hz)\n` +
            `${d.energy.toFixed(2)} m²/Hz @ ${Math.round(d.direction)}° (r1 ${d.r1.toFixed(2)})`,
        }),
      ],
    });
  };
}

// Single-reading energy-by-period histogram -- the classic CDIP spectrum
// plot shape -- colored by direction so it doubles as a mini partition view
// of that one moment.
export function renderSpectrumHistogram(rows, { height = 260, title = 'Spectral Energy' } = {}) {
  return width => {
    if (!rows || rows.length === 0) return null;
    const sorted = d3.sort(rows, d => d.freq);

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 50,
      x: {
        label: 'Period (s)',
        tickFormat: f => periodOf(f).toFixed(0),
      },
      y: { label: 'Energy density (m²/Hz)', grid: true },
      color: DIRECTION_COLOR,
      marks: [
        Plot.ruleY([0]),
        Plot.barY(sorted, {
          x: 'freq',
          y: 'energy',
          fill: 'direction',
          title: d =>
            `${periodOf(d.freq).toFixed(1)}s (${d.freq.toFixed(3)} Hz)\n` +
            `${d.energy.toFixed(2)} m²/Hz @ ${Math.round(d.direction)}° (r1 ${d.r1.toFixed(2)})`,
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
