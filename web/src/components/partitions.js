// CDIP-style wave partitions chart
// (https://cdip.ucsd.edu/m/products/partition/): each distinct wave system
// (swell, wind sea, etc.) as a bubble over time, sized by height, positioned
// by period, and colored by direction -- read top-to-bottom-left-to-right
// for "what showed up, how big, and from where".
//
// Built on swell_partition (see db/swell/schema.sql): rank 1 is NDBC's
// whole-sea-state observation; ranks 2+ are the individual spectral
// components CDIP calls "partitions".

import * as Plot from 'npm:@observablehq/plot';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';
import { DIRECTION_COLOR } from './spectrum.js';

// Flattens grouped swell_partition readings ({ts, values: [...]}) down to
// one row per wave system, excluding rank 1 (the whole-sea-state summary,
// not a distinct partition) -- the shape the bubble chart marks expect.
export function flattenPartitions(swell) {
  return swell.flatMap(({ ts, values }) =>
    values
      .filter(d => d.rank !== 1)
      .map(d => ({
        ts,
        rank: d.rank,
        period: d.period,
        direction: d.direction,
        height: d.height,
        energy: d.energy,
        spread: d.spread,
      }))
  );
}

export function renderPartitionBubbles(
  swell,
  { height = 340, title = 'Wave Partitions', rDomain } = {}
) {
  return width => {
    const components = flattenPartitions(swell);
    if (components.length === 0) return null;

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 50,
      x: { type: 'utc', label: null, tickFormat: d3.timeFormat('%-m/%-d %H:%M') },
      y: { label: 'Period (s)', grid: true },
      r: { label: 'Height (ft)', domain: rDomain, range: [3, 22] },
      color: DIRECTION_COLOR,
      marks: [
        Plot.dot(components, {
          x: 'ts',
          y: 'period',
          r: 'height',
          fill: 'direction',
          stroke: 'white',
          strokeWidth: 1,
          fillOpacity: 0.85,
          title: d =>
            `${fmt.time(d.ts)}\n${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s - ${Math.round(d.direction)}°\n${d.energy.toFixed(2)} kJ/m²`,
        }),
        // Arrow shows where each wave system is heading (direction + 180),
        // matching the arrow convention used for wind/swell elsewhere in
        // the app (see timeline.js's wind/swell vectors). Scaled past the
        // dot's own radius (up to 22px) so it isn't swallowed by big
        // bubbles, and drawn in a fixed high-contrast color rather than
        // the direction scale so it reads against any dot color.
        Plot.vector(components, {
          x: 'ts',
          y: 'period',
          rotate: d => d.direction + 180,
          length: d => 24 + d.height * 3,
          anchor: 'middle',
          stroke: 'currentColor',
          strokeOpacity: 0.9,
          strokeWidth: 2,
        }),
      ],
    });
  };
}

// A single-moment "now" snapshot: one bubble per wave system (including
// rank 1, the whole sea state), placed by compass direction and distance
// from center by period (long-period swell further out, like CDIP's own
// polar partition view), sized by height. Plain cartesian math rather than
// a geo projection -- direction is compass bearing, not a map coordinate.
export function renderPartitionCompass(values, { size = 280, title = 'Current Swell' } = {}) {
  return width => {
    if (!values || values.length === 0) return null;
    const dim = Math.min(width, size);
    // Spokes/rings extend out to ringMax; the plot domain goes well beyond
    // that so the cardinal labels and arrowheads near the edge have room
    // to render without getting clipped by the frame.
    const ringMax = d3.max(values, d => d.period) || 1;
    const domainMax = ringMax * 1.4;
    const color = '#0ea5e9';

    // Plot's y scale increases upward, so compass bearing (clockwise from
    // North) maps straight to x = sin, y = cos -- no axis flip needed.
    const points = values.map(d => {
      const theta = (d.direction * Math.PI) / 180;
      const radius = d.period;
      return {
        ...d,
        x1: 0,
        y1: 0,
        x2: radius * Math.sin(theta),
        y2: radius * Math.cos(theta),
      };
    });

    const rings = d3.ticks(0, ringMax, 4).filter(r => r > 0);
    const ringLabels = rings.map(r => ({ x: 0, y: r, label: `${r}s` }));
    const spokes = [0, 90, 180, 270].map(deg => {
      const theta = (deg * Math.PI) / 180;
      return {
        x1: 0,
        y1: 0,
        x2: ringMax * Math.sin(theta),
        y2: ringMax * Math.cos(theta),
        label: ['N', 'E', 'S', 'W'][deg / 90],
      };
    });

    return Plot.plot({
      title,
      width: dim,
      height: dim,
      aspectRatio: 1,
      margin: 28,
      x: { domain: [-domainMax, domainMax], axis: null },
      y: { domain: [-domainMax, domainMax], axis: null },
      r: { label: 'Height (ft)', range: [3, 24] },
      marks: [
        ...rings.map(r =>
          Plot.dot([{ x: 0, y: 0 }], {
            x: 'x',
            y: 'y',
            r,
            fill: 'none',
            stroke: 'currentColor',
            strokeOpacity: 0.15,
          })
        ),
        Plot.text(ringLabels, {
          x: 'x',
          y: 'y',
          text: 'label',
          fontSize: 9,
          fill: 'currentColor',
          fillOpacity: 0.4,
          dy: -4,
        }),
        Plot.link(spokes, { x1: 'x1', y1: 'y1', x2: 'x2', y2: 'y2', stroke: 'currentColor', strokeOpacity: 0.15 }),
        Plot.text(spokes, { x: 'x2', y: 'y2', text: 'label', fontSize: 11, fill: 'currentColor', fillOpacity: 0.6 }),
        // Direction is shown by the arrow itself (pointing toward where
        // each wave system is heading) rather than color; the arrowhead's
        // endpoint position also encodes period (distance from center).
        Plot.link(points, {
          x1: 'x1',
          y1: 'y1',
          x2: 'x2',
          y2: 'y2',
          stroke: color,
          strokeWidth: d => 1.5 + d.height * 0.8,
          strokeOpacity: 0.85,
          markerEnd: 'arrow',
          title: d =>
            `${d.rank === 1 ? 'Primary' : 'Partition'}\n${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s - ${Math.round(d.direction)}°`,
        }),
      ],
    });
  };
}


