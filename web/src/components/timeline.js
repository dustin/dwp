import * as Plot from 'npm:@observablehq/plot';
import _ from 'npm:lodash';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';

function regress(src, x, y) {
  return Plot.linearRegressionY(src, { x, y, stroke: '#808' });
}

function line(src, obj) {
  return Plot.line(src, { opacity: 0.2, curve: 'cardinal', ...obj });
}

export function tl(data, title, opts, xField, yField, lineOpts, dotOpts) {
  return width =>
    Plot.plot({
      title,
      width,
      ...opts,
      marks: [
        regress(data, xField, yField),
        line(data, { x: xField, y: yField, ...lineOpts }),
        Plot.dot(data, {
          x: xField,
          y: yField,
          r: d => (d.dry ? 10 : 5),
          opacity: d => (d.dry ? 0.8 : 0.2),
          symbol: d => (d.dry ? 'star' : 'circle'),
          href: d => `/run.html?id=${encodeURIComponent(d.id)}`,
          ...dotOpts,
        }),
      ],
    });
}

function pace(speed) {
  return 60 / speed;
}

export function computeSplits(data) {
  return _.orderBy(
    d3
      .groups(data, d => Math.floor(d.distance / 1000))
      .map(([s, d]) => {
        const speeds = d.map(d => d.speed);
        return {
          split: s + 1,
          min_speed: d3.min(speeds),
          avg_speed: d3.mean(speeds),
          max_speed: d3.max(speeds),
          min_pace: pace(d3.min(speeds)),
          avg_pace: pace(d3.mean(speeds)),
          max_pace: pace(d3.max(speeds)),
          max_hr: d3.max(d.map(d => d.hr)),
          min_hr: d3.min(d.map(d => d.hr)),
          avg_hr: d3.mean(d.map(d => d.hr)),
          data: d,
        };
      }),
    d => d.split
  );
}

const SPEED_THRESHOLD = 11;
const MIN_DURATION_MS = 5000;

export function computeSegments(data) {
  return data.reduce(
    (acc, d, i) => {
      const { segments, pendingState } = acc;

      const currentSpeed = d.speed;
      const hasValidSpeed = currentSpeed != null;
      const speedIndicatesOnFoil = hasValidSpeed && currentSpeed >= SPEED_THRESHOLD;

      // Get current confirmed state
      let confirmedOnFoil = null;
      if (segments.length > 0) {
        confirmedOnFoil = segments[segments.length - 1].onFoil;
      }

      // Handle first point
      if (i === 0) {
        segments.push({
          start: d.ts,
          end: d.ts,
          onFoil: speedIndicatesOnFoil,
          data: [d],
        });
        return {
          segments,
          pendingState:
            speedIndicatesOnFoil !== null
              ? {
                  state: speedIndicatesOnFoil,
                  startTime: d.ts,
                }
              : null,
        };
      }

      // Check if speed indicates a different state than confirmed
      const stateChangeIndicated = speedIndicatesOnFoil !== confirmedOnFoil;

      if (!stateChangeIndicated) {
        // Speed agrees with current state - clear any pending change
        const currentSegment = segments[segments.length - 1];
        currentSegment.end = d.ts;
        currentSegment.data.push(d);

        return {
          segments,
          pendingState: null,
        };
      }

      // Speed indicates a state change
      if (!pendingState || pendingState.state !== speedIndicatesOnFoil) {
        // Start tracking this potential state change
        const currentSegment = segments[segments.length - 1];
        currentSegment.end = d.ts;
        currentSegment.data.push(d);

        return {
          segments,
          pendingState: {
            state: speedIndicatesOnFoil,
            startTime: d.ts,
          },
        };
      }

      // We have a pending state change - check if it's been long enough
      const durationMs = d.ts - pendingState.startTime;

      if (durationMs >= MIN_DURATION_MS) {
        // Confirmed state change - create new segment
        segments.push({
          start: d.ts,
          end: d.ts,
          onFoil: speedIndicatesOnFoil,
          data: [d],
        });

        return {
          segments,
          pendingState: null,
        };
      } else {
        // Still pending - continue current segment
        const currentSegment = segments[segments.length - 1];
        currentSegment.end = d.ts;
        currentSegment.data.push(d);

        return {
          segments,
          pendingState,
        };
      }
    },
    { segments: [], pendingState: null }
  ).segments;
}

export function makeWindMarks(wind, wind2, idx, label, colors) {
  const color = colors[idx](d3.mean(wind));
  const altColor = colors[idx == 0 ? 1 : 0](d3.mean(wind2));
  return [
    Plot.areaY(wind, { x: 't', y: 'wgust', curve: 'basis', fill: color, fillOpacity: 0.1 }),
    Plot.areaY(wind, { x: 't', y: 'wlull', curve: 'basis', fill: color, fillOpacity: 0.1 }),
    Plot.lineY(wind, {
      x: 't',
      y: 'wgust',
      curve: 'basis',
      stroke: color,
      strokeWidth: 1.5,
      opacity: 0.3,
    }),
    Plot.lineY(wind, {
      x: 't',
      y: 'wlull',
      curve: 'basis',
      stroke: color,
      strokeWidth: 1.5,
      opacity: 0.3,
    }),
    Plot.lineY(wind, { x: 't', y: 'wavg', curve: 'basis', stroke: color, strokeWidth: 2.5 }),
    Plot.lineY(wind2, {
      x: 't',
      y: 'wavg',
      curve: 'basis',
      stroke: altColor,
      strokeWidth: 2.5,
      strokeDasharray: '4,4',
      opacity: 0.4,
    }),
    Plot.vector(wind, {
      x: 't',
      y: 'wavg',
      length: 30,
      rotate: d => d.wdir + 180,
      anchor: 'middle',
      stroke: color,
      strokeWidth: 2,
      opacity: 0.9,
    }),
    // tooltip
    Plot.tip(
      wind,
      Plot.pointer({
        x: 't',
        y: 'wavg',
        fontSize: 14,
        title: d =>
          `${label} • ${fmt.time(d.ts)}\n${d.wavg.toFixed(1)} kn (avg), ${d.wgust.toFixed(1)} kn (gust) @ ${Math.round(d.wdir)}°`,
      })
    ),
  ];
}
