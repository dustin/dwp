// Swell energy over time, in Surfline's "kJ" and the oceanographic standard.
//
// Surfline's kJ figure isn't a published formula. swell_partition.surfline_kj
// (db/swell/update.sql) reproduces it closely enough: per swell, single-wave
// energy rho*g*H^2/8 times deep-water wavelength g*T^2/(2*pi), with
// H = 4*sqrt(m0) and T the peak period, i.e. rho*g^2*m0*T^2/pi, summed over
// the swells. Long period counts twice (T^2), which is why a small long
// groundswell can outscore a bigger short one.
//
// The standard measure is wave power (energy flux) per meter of crest,
// P = rho*g^2*m_-1/(4*pi) in deep water, the same as rho*g^2*Hs^2*Te/(64*pi).

import * as Plot from 'npm:@observablehq/plot';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';
import { DIRECTION_COLOR, formatDirection } from './spectrum.js';
import { withBinEdges } from './spectral-partitions.js';

const G = 9.80665;
const RHO = 1025;

// One swell's share of the Surfline-style kJ. `energy` is rho*g*m0 in kJ/m².
export const swellKJ = d => (d.energy * G * d.period ** 2) / Math.PI;

// Deep-water wave power in kW per meter of crest from one spectral reading.
export function wavePower(spectrumRows) {
  const bins = withBinEdges(spectrumRows).filter(b => b.energy > 0);
  if (bins.length === 0) return null;
  const mMinus1 = d3.sum(bins, b => (b.energy * b.df) / b.freq);
  return (RHO * G * G * mMinus1) / (4 * Math.PI) / 1000;
}

// Surfline-style kJ over a window. `partitions` are the spectral partitions
// ({ts, values}) drawn as stacked bars colored by direction; `swell` gives
// the stored total (rank 1 surflineKJ) as a line. `runKJ` -- the kJ at the
// middle of each logged run -- is drawn as a band (the middle half of them)
// and a median line, as a "what you usually go out in" reference.
export function renderSwellEnergy(partitions, swell, { height = 300, title = 'Swell Energy (kJ)', runKJ = [] } = {}) {
  return width => {
    // Stacked longest period at the bottom.
    const bars = partitions.flatMap(({ ts, values }) => {
      let y = 0;
      return values
        .slice()
        .sort((a, b) => b.period - a.period)
        .map(d => {
          const kj = swellKJ(d);
          return { ...d, ts, kj, y1: y, y2: (y += kj) };
        });
    });
    const totals = swell
      .map(({ ts, values }) => ({ ts, kj: values.find(v => v.rank === 1)?.surflineKJ }))
      .filter(d => d.kj != null);
    if (bars.length === 0 && totals.length === 0) return null;

    const runs = runKJ.filter(k => k != null && k > 0).sort(d3.ascending);
    const band =
      runs.length >= 4
        ? { lo: d3.quantileSorted(runs, 0.25), mid: d3.quantileSorted(runs, 0.5), hi: d3.quantileSorted(runs, 0.75) }
        : null;
    const halfWidth = 22 * 60 * 1000;
    const tsExtent = d3.extent([...bars, ...totals], d => d.ts);

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 50,
      x: {
        type: 'time',
        label: null,
        tickFormat: fmt.timeTick,
        domain: [new Date(+tsExtent[0] - halfWidth), new Date(+tsExtent[1] + halfWidth)],
      },
      y: {
        label: 'kJ',
        grid: true,
        domain: [0, d3.max([...bars.map(d => d.y2), ...totals.map(d => d.kj), band?.hi ?? 0]) * 1.1],
      },
      color: DIRECTION_COLOR,
      marks: [
        ...(band
          ? [
              Plot.rectY([band], { y1: 'lo', y2: 'hi', fill: 'currentColor', fillOpacity: 0.08 }),
              Plot.ruleY([band.mid], { stroke: 'currentColor', strokeOpacity: 0.4, strokeDasharray: '4,3' }),
              Plot.text([band], {
                y: 'hi',
                frameAnchor: 'left',
                textAnchor: 'start',
                dx: 4,
                dy: -7,
                fontSize: 10,
                fill: 'currentColor',
                fillOpacity: 0.7,
                text: d =>
                  `Your runs: middle half ${Math.round(d.lo)}–${Math.round(d.hi)} kJ, median ${Math.round(d.mid)}`,
              }),
            ]
          : []),
        Plot.rect(bars, {
          x1: d => new Date(+d.ts - halfWidth),
          x2: d => new Date(+d.ts + halfWidth),
          y1: 'y1',
          y2: 'y2',
          fill: 'direction',
          fillOpacity: 0.75,
          stroke: 'var(--theme-background)',
          strokeWidth: 0.5,
          title: d =>
            `${fmt.minuteStamp(d.ts)}\n${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s from ${formatDirection(d.direction)}\n${Math.round(d.kj)} kJ`,
        }),
        Plot.line(totals, { x: 'ts', y: 'kj', stroke: 'currentColor', strokeWidth: 1.5, curve: 'monotone-x' }),
        Plot.dot(totals, {
          x: 'ts',
          y: 'kj',
          r: 2.5,
          fill: 'currentColor',
          title: d => `${fmt.minuteStamp(d.ts)}\nTotal ${Math.round(d.kj)} kJ`,
        }),
      ],
    });
  };
}
