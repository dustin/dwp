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
import { DIRECTION_COLOR, compassPoint, directionColor, formatDirection } from './spectrum.js';

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

// `run` ({start, end}) marks a run on the chart: its span is shaded, its
// start labeled, and readings from before it faded. Spectra come hourly, so
// a short run may not have a reading of its own; the last one before the
// start is what conditions were at launch, so it stays at full strength
// and only the lead-in before that fades.
export function renderPartitionBubbles(
  swell,
  { height = 340, title = 'Wave Partitions', rDomain, run } = {}
) {
  return width => {
    const components = flattenPartitions(swell);
    if (components.length === 0) return null;

    const atLaunch = run ? d3.max(components.filter(d => d.ts <= run.start), d => +d.ts) : null;
    const leadIn = d => run != null && +d.ts < (atLaunch ?? +run.start);
    const runMarks = run
      ? [
          Plot.rect([run], {
            x1: 'start',
            x2: 'end',
            fill: 'currentColor',
            fillOpacity: 0.08,
          }),
          Plot.ruleX([run.start], { stroke: 'currentColor', strokeDasharray: '4,3', strokeOpacity: 0.7 }),
          Plot.text([run.start], {
            x: d => d,
            frameAnchor: 'top',
            textAnchor: 'start',
            dx: 4,
            dy: 2,
            fontSize: 11,
            fill: 'currentColor',
            text: d => `Run start ${fmt.clock(d)}`,
          }),
        ]
      : [];

    return Plot.plot({
      title,
      width,
      height,
      marginLeft: 50,
      x: { type: 'time', label: null, tickFormat: fmt.timeTick },
      y: { label: 'Period (s)', grid: true },
      r: { label: 'Height (ft)', domain: rDomain, range: [3, 22] },
      color: DIRECTION_COLOR,
      marks: [
        ...runMarks,
        Plot.dot(components, {
          x: 'ts',
          y: 'period',
          r: 'height',
          fill: 'direction',
          stroke: 'white',
          strokeWidth: 1,
          fillOpacity: d => (leadIn(d) ? 0.3 : 0.85),
          strokeOpacity: d => (leadIn(d) ? 0.4 : 1),
          title: d =>
            `${leadIn(d) ? 'Before the run\n' : ''}${fmt.timestamp(d.ts)}\n${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s from ${formatDirection(d.direction)}\n${d.energy.toFixed(2)} kJ/m²`,
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
          strokeOpacity: d => (leadIn(d) ? 0.3 : 0.9),
          strokeWidth: 2,
        }),
      ],
    });
  };
}

// A single-moment "now" snapshot: one arrow per wave system, drawn the way
// the swell actually moves -- starting out on the compass at the bearing it
// comes *from* and pointing in toward the buoy at the center (so a NW swell
// is an arrow in the upper left pointing down-right, toward the shore).
// Distance from center is period (long-period swell starts further out, like
// CDIP's polar partition view), thickness is height, color is direction.
// Rank 1 (NDBC's whole-sea-state reading, not a distinct system) is drawn
// dashed and gray for reference. The arrowhead sits near the outer end of
// each line rather than at the center, so the heads don't all pile up on
// top of each other in the middle. Plain cartesian math rather than a geo
// projection -- direction is a compass bearing, not a map coordinate.
export function renderPartitionCompass(values, { size = 320, title = 'Current Swell' } = {}) {
  return width => {
    if (!values || values.length === 0) return null;
    const dim = Math.min(width, size);
    const ringMax = Math.max(15, Math.ceil((d3.max(values, d => d.period) || 1) / 5) * 5);
    // Room past the outer ring for the cardinal labels and arrow tails.
    const domainMax = ringMax * 1.25;

    // Plot's y scale increases upward, so compass bearing (clockwise from
    // North) maps straight to x = sin, y = cos -- no axis flip needed.
    const polar = (deg, r) => {
      const theta = (deg * Math.PI) / 180;
      return [r * Math.sin(theta), r * Math.cos(theta)];
    };
    // Largest system drawn last so it sits on top.
    const points = values
      .slice()
      .sort((a, b) => a.height - b.height)
      .map(d => {
        const [x1, y1] = polar(d.direction, d.period);
        const [hx, hy] = polar(d.direction, Math.max(d.period - ringMax * 0.25, d.period / 2));
        return { ...d, x1, y1, hx, hy };
      });

    const rings = d3.range(5, ringMax + 1, 5);
    const spokes = d3.range(0, 360, 45).map(deg => {
      const [x2, y2] = polar(deg, ringMax);
      const [lx, ly] = polar(deg, ringMax * 1.13);
      return { x2, y2, lx, ly, label: compassPoint(deg) };
    });

    const label = d =>
      `${d.rank === 1 ? 'Overall sea state' : 'Swell'}\n${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s from ${formatDirection(d.direction)}`;

    return Plot.plot({
      title,
      width: dim,
      height: dim,
      margin: 10,
      x: { domain: [-domainMax, domainMax], axis: null },
      y: { domain: [-domainMax, domainMax], axis: null },
      marks: [
        ...rings.map(r =>
          Plot.line(
            d3.range(0, 361, 5).map(deg => polar(deg, r)),
            { stroke: 'currentColor', strokeOpacity: 0.15 }
          )
        ),
        Plot.text(rings, {
          x: 0,
          y: r => r,
          text: r => `${r}s`,
          fontSize: 9,
          fill: 'currentColor',
          fillOpacity: 0.5,
          dy: -5,
        }),
        Plot.link(spokes, { x1: 0, y1: 0, x2: 'x2', y2: 'y2', stroke: 'currentColor', strokeOpacity: 0.15 }),
        Plot.text(spokes, { x: 'lx', y: 'ly', text: 'label', fontSize: 11, fill: 'currentColor', fillOpacity: 0.7 }),
        // strokeDasharray is constant-only in Plot, so the overall reading
        // (rank 1, dashed gray) and the swells get separate marks.
        ...[
          [points.filter(d => d.rank === 1), { stroke: 'gray', strokeDasharray: '4,3' }],
          [points.filter(d => d.rank !== 1), { stroke: d => directionColor(d.direction) }],
        ].flatMap(([data, style]) => [
          // Shaft: from the source bearing all the way in to the buoy.
          Plot.link(data, {
            x1: 'x1',
            y1: 'y1',
            x2: 0,
            y2: 0,
            ...style,
            strokeWidth: d => 1.5 + d.height * 0.8,
            strokeOpacity: 0.9,
            title: label,
          }),
          // Head: a short segment over the outer end of the shaft, pointing in.
          Plot.link(data, {
            x1: 'x1',
            y1: 'y1',
            x2: 'hx',
            y2: 'hy',
            ...style,
            strokeDasharray: null,
            strokeWidth: d => 1.5 + d.height * 0.8,
            strokeOpacity: 0.9,
            markerEnd: 'arrow',
          }),
        ]),
        // dy must be a constant, so labels above and below center are two marks.
        ...[
          [d => d.y1 >= 0, -8],
          [d => d.y1 < 0, 10],
        ].map(([where, dy]) =>
          Plot.text(
            points.filter(d => d.rank !== 1 && where(d)),
            {
              x: 'x1',
              y: 'y1',
              text: d => `${d.height.toFixed(1)}' ${d.period.toFixed(0)}s`,
              fontSize: 10,
              fontWeight: 'bold',
              dy,
              stroke: 'var(--theme-background)',
              fill: 'currentColor',
            }
          )
        ),
      ],
    });
  };
}
