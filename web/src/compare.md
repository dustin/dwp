---
theme: dashboard
title: compare downwind runs
toc: true
---

<style>
  .run1 {
    color: hsl(140, 80%, 45%);
    font-weight: 600;
  }
  .run2 {
    color: hsl(30, 85%, 55%);
    font-weight: 600;
  }
</style>

```js
import {renderRun, findCallouts, createWindRoseInset} from "./components/map.js";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";
import {csv} from "https://cdn.jsdelivr.net/npm/d3-fetch@3/+esm";
import {autoType} from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";
import {fetchMeta, fetchRun, fetchWind, fetchSwell, toRelative} from "./components/data.js";

const urlParams = new URLSearchParams(window.location.search);

const id1 = urlParams.get("id1");
const id2 = urlParams.get("id2");

const allRunsP = fetchMeta(() => FileAttachment('data/runs.csv')).then(data => data.reduce((m, r) => {
  m[r.id] = r
  return m;
}, {}));
const csvFetches = [id1, id2].map(fetchRun);

const runMetaMap = await allRunsP;

const runMeta1 = runMetaMap[id1];
const runMeta2 = runMetaMap[id2];

const windFetches = [id1, id2].map(i => fetchWind(runMetaMap[i]).then(toRelative));
const swellFetches = [id1, id2].map(i => fetchSwell(runMetaMap[i]).then(toRelative));
```

# Comparing a run on <span class="run1">${fmt.date(runMeta1.ts)}</span> to a run on <span class="run2">${fmt.date(runMeta2.ts)}</span>

```js
const [runCsv1, runCsv2] = await Promise.all(csvFetches);

function createColorizer(data, baseHue) {
  const speeds = data.map(d => d.speed).filter(s => s != null);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);

  return speed => {
    if (speed == null) return `hsl(${baseHue}, 70%, 50%)`;
    if (speed < 11) return `hsl(${baseHue}, 40%, 30%)`;

    // Normalize speed to 0-1 range
    const normalized = speeds.length > 1 ? (speed - minSpeed) / (maxSpeed - minSpeed) : 0.5;

    const lightness = 30 + normalized * 40; // Range: 30% to 70%
    const saturation = 70 + normalized * 20; // Range: 70% to 90%

    return `hsl(${baseHue}, ${saturation}%, ${lightness}%)`;
  };
};

const colorizers = [
  createColorizer(runCsv1, 140), // Green hue
  createColorizer(runCsv2, 30), // Orange hue
];

const callouts = [[runMeta1, runCsv1], [runMeta2, runCsv2]].flatMap(([m,c]) => findCallouts(m, c));
const [wind1, wind2] = await windFetches;
const [swell1, swell2] = await swellFetches;

function aRose(d3, svg, width, height, wind, idx, colors, off) {
  const size = 130;
  const margin = 16;
  const centerX = margin + size;
  const centerY = margin + size + off;
  const inset = createWindRoseInset(d3, svg, wind, {
    x: centerX,
    y: centerY,
    radius: size,
    innerHole: 40,
    nDirections: 36,
    speedBreaks: [0, 15, 20, 25, 30],
    colors: {
      type: 'ordinal',
      scheme: [0, 15, 20, 25, 30].map(colors)
    },
    normalize: false,
    title: "Wind Speed " + idx + " (knots)",
  });
  return {
    updateOnZoom: null,
    update: () => {
      inset.update({ x: centerX, y: centerY });
    }
  };
}
```

<div class="card">${resize(width => renderRun(width, [runCsv1, runCsv2], callouts, {
  colorizers: colorizers,
  additionalMarks: ({ d3, svg, width, height }) => {
    aRose(d3, svg, width, height, wind1, 1, colorizers[0], 0);
    aRose(d3, svg, width, height, wind2, 2, colorizers[1], 300)
  }
}))}</div>

## At a Glance

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">
      <span class="run1">${fmt.seconds(runMeta1.duration_sec)}</span>
      /<br/>
      <span class="run2">${fmt.seconds(runMeta2.duration_sec)}</span>
    </span>
  </div>

  <div class="card">
      <h2>Time on Foil</h2>
      <span class="big">
          <span class="run1">${fmt.seconds(runMeta1.duration_on_foil)} (${(runMeta1.pct_time_on_foil * 100).toFixed(0)}%)</span>
          /<br/>
          <span class="run2">${fmt.seconds(runMeta2.duration_on_foil)} (${(runMeta2.pct_time_on_foil * 100).toFixed(0)}%)</span>
      </span>
  </div>

  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">
      <span class="run1">${runMeta1.distance_km.toFixed(2)} km</span>
      /<br/>
      <span class="run2">${runMeta2.distance_km.toFixed(2)} km</span>
    </span>
  </div>

  <div class="card">
    <h2>Distance Traveled on Foil</h2>
    <span class="big">
      <span class="run1">
        ${(runMeta1.distance_on_foil / 1000).toFixed(2)} km
        (${(runMeta1.pct_dist_on_foil * 100).toFixed(0)}%)
      </span>
      /<br/>
      <span class="run2">
        ${(runMeta2.distance_on_foil / 1000).toFixed(2)} km
        (${(runMeta2.pct_dist_on_foil * 100).toFixed(0)}%)
      </span>
    </span>
  </div>

  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">
      <span class="run1">${(runMeta1.longest_segment_distance / 1000).toFixed(2)} km</span>
      /<br/>
      <span class="run2">${(runMeta2.longest_segment_distance / 1000).toFixed(2)} km</span>
    </span>
  </div>

  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">
      <span class="run1">${(runMeta1.max_distance / 1000).toFixed(2)} km</span>
      /<br/>
      <span class="run2">${(runMeta2.max_distance / 1000).toFixed(2)} km</span>
    </span>
  </div>

  <div class="card">
    <h2>Foil</h2>
    <span class="big">
      <span class="run1">${runMeta1.foil}</span>
      /<br/>
      <span class="run2">${runMeta2.foil}</span>
    </span>
  </div>

  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">
      <span class="run1">${runMeta1.paddle_up_count || 0}</span>
      /<br/>
      <span class="run2">${runMeta2.paddle_up_count || 0}</span>
    </span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">
      <span class="run1">${runMeta1.max_speed_kmh.toFixed(2)} kph</span>
      /<br/>
      <span class="run2">${runMeta2.max_speed_kmh.toFixed(2)} kph</span>
    </span>
  </div>

  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">
      <span class="run1">${fmt.pace(runMeta1.max_speed_1k)}</span>
      /<br/>
      <span class="run2">${fmt.pace(runMeta2.max_speed_1k)}</span>
    </span>
  </div>

  <div class="card">
    <h2>Min Foiling Heart Rate</h2>
    <span class="big">
      <span class="run1">${fmt.hr(runMeta1.min_foiling_hr)}</span>
      /<br/>
      <span class="run2">${fmt.hr(runMeta2.min_foiling_hr)}</span>
    </span>
  </div>

  <div class="card">
    <h2>Average Foiling Heart Rate</h2>
    <span class="big">
      <span class="run1">${fmt.hr(runMeta1.avg_foiling_hr)}</span>
      /<br/>
      <span class="run2">${fmt.hr(runMeta2.avg_foiling_hr)}</span>
    </span>
  </div>

</div>

## Speed

<div class="card">${
resize(width => Plot.plot({
    title: "Speed",
    width, x: {tickFormat: fmt.distanceM},
    marks: [
        Plot.lineY(runCsv1, { x: "distance", y: "speed", stroke: "green",
                             opacity: 0.5, strokeWidth: 1 }),
        Plot.lineY(runCsv1, { x: "distance", y: "avg_speed_1k", stroke: "green",
                              opacity: 1, strokeWidth: 2 }),
        Plot.crosshair(runCsv1, {x: "distance", y: "speed"}),
        Plot.lineY(runCsv2, { x: "distance", y: "speed", stroke: "orange",
                             opacity: 0.5, strokeWidth: 1 }),
        Plot.lineY(runCsv2, { x: "distance", y: "avg_speed_1k", stroke: "orange",
                                                   opacity: 1, strokeWidth: 2 }),
        Plot.crosshair(runCsv2, {x: "distance", y: "speed"}),
        Plot.tip(runCsv1, Plot.pointer({
            x: "distance",
            y: "speed", fontSize: 15,
        }))
    ]
}))
}</div>

## Conditions

```js
const windymax = Math.max(
  d3.max(wind1, d => Math.max(d.wavg, d.wgust)),
  d3.max(wind2, d => Math.max(d.wavg, d.wgust))
) * 1.1;

const swellymax = Math.max(
  d3.max(swell1, d => d.wave_height),
  d3.max(swell2, d => d.wave_height)
) * 1.1;
```

<div class="grid grid-cols-2">

<div class="card">${
  wind1 && wind2 && wind1.length > 0 && wind2.length > 0
    ? resize((width) => {
        return Plot.plot({
          title: `Wind Speed (${fmt.timestamp(runMeta1.ts)})`,
          width,
          color: { legend: false },
          y: { domain: [0, windymax], label: "knots" },
          x: { tickFormat: d => fmt.seconds(d / 1000) },
          marks: tl.makeWindMarks(wind1, wind2, 0, "wind1", colorizers),
        });
      })
    : html`<p>No wind data found for this run.</p>`
}</div>

<div class="card">${
  wind1 && wind2 && wind1.length > 0 && wind2.length > 0
    ? resize((width) => {
        return Plot.plot({
          title: `Wind Speed (${fmt.timestamp(runMeta2.ts)})`,
          width,
          color: { legend: false },
          y: { domain: [0, windymax], label: "knots" },
          x: { tickFormat: d => fmt.seconds(d / 1000) },
          marks: tl.makeWindMarks(wind2, wind1, 1, "wind2", colorizers),
        });
      })
    : html`<p>No wind data found for this run.</p>`
}</div>

</div>

<div class="grid grid-cols-2">

<div class="card">${
  swell1 && swell2 && swell1.length > 0 && swell2.length > 0
    ? resize((width) => {
        return Plot.plot({
          title: `Swell Height (${fmt.timestamp(runMeta1.ts)})`,
          width,
          color: { legend: false },
          y: { domain: [0, swellymax], label: "feet" },
          x: { tickFormat: d => fmt.seconds(d / 1000) },
          marks: tl.makeSwellMarks(swell1, swell2, 0, "swell1", colorizers),
        });
      })
    : html`<p>No swell data found for this run.</p>`
}</div>

<div class="card">${
  swell1 && swell2 && swell1.length > 0 && swell2.length > 0
    ? resize((width) => {
        return Plot.plot({
          title: `Swell Height (${fmt.timestamp(runMeta2.ts)})`,
          width,
          color: { legend: false },
          y: { domain: [0, swellymax], label: "feet" },
          x: { tickFormat: d => fmt.seconds(d / 1000) },
          marks: tl.makeSwellMarks(swell2, swell1, 1, "swell2", colorizers),
        });
      })
    : html`<p>No swell data found for this run.</p>`
}</div>

</div>

## Splits

```js
function pace(speed) {
  return (60/speed);
}

const splits1 = tl.computeSplits(runCsv1);
const splits2 = tl.computeSplits(runCsv2);

const maxSplitY = Math.max(
  ...splits1.map(d => d.max_speed),
  ...splits2.map(d => d.max_speed)
);

const maxPaceY = Math.min(5, Math.max(
  ...splits1.map(d => d.avg_pace),
  ...splits2.map(d => d.avg_pace)
));

const maxHRY = Math.max(
  ...splits1.map(d => d.max_hr),
  ...splits2.map(d => d.max_hr)
);
```

<div class="grid grid-cols-2">
<div class="card">${
resize((width) => Plot.plot({
      title: `Speed (${fmt.timestamp(runMeta2.ts)})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxSplitY] },
      marks: [
        Plot.rect(splits1,{x:"split",y1:"min_speed",y2:"max_speed", fill: "green", opacity: 0.2,
          title: d => `${d.min_speed.toFixed(2)} - ${d.max_speed.toFixed(2)} kph\n${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph avg`
        }),
        Plot.line(splits1, {x: "split", y: "avg_speed", stroke: "green", strokeWidth: 2}),
        Plot.line(splits2, {x: "split", y: "avg_speed", stroke: "orange", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>
<div class="card">${
  resize((width) => Plot.plot({
      title: `Speed (${fmt.timestamp(runMeta2.ts)})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxSplitY] },
      marks: [
        Plot.rect(splits2,{x:"split",y1:"min_speed",y2:"max_speed", fill: "orange", opacity: 0.2,
          title: d => `${d.min_speed.toFixed(2)} - ${d.max_speed.toFixed(2)} kph\n${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph avg`
        }),
        Plot.line(splits2, {x: "split", y: "avg_speed", stroke: "orange", strokeWidth: 2}),
        Plot.line(splits1, {x: "split", y: "avg_speed", stroke: "green", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>
</div>

<div class="grid grid-cols-2">

<div class="card">${
resize((width) => Plot.plot({
      title: `Pace (${fmt.timestamp(runMeta1.ts)})`,
      color: { legend: true },
      clip: true,
      width, x: { interval: 1, label: "km" }, y: { domain: [1, maxPaceY] },
      marks: [
      Plot.line(splits1, {x: "split", y: "avg_pace", stroke: "green", strokeWidth: 2}),
      Plot.line(splits2, {x: "split", y: "avg_pace", stroke: "orange", strokeWidth: 2, strokeDasharray: "4,4"}),
        Plot.barY(splits1,{x:"split",y:"avg_pace", fill: "green", opacity: 0.2,
          title: (d => `${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph`) }),
      ]
    })
    )
}</div>
<div class="card">${
  resize((width) => Plot.plot({
      title: `Pace (${fmt.timestamp(runMeta2.ts)})`,
      color: { legend: true },
      clip: true,
      width, x: { interval: 1, label: "km" }, y: { domain: [1, maxPaceY] },
      marks: [
        Plot.barY(splits2,{x:"split",y:"avg_pace", fill: "orange", opacity: 0.2,
          title: (d => `${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph`) }),
          Plot.line(splits2, {x: "split", y: "avg_pace", stroke: "orange", strokeWidth: 2}),
          Plot.line(splits1, {x: "split", y: "avg_pace", stroke: "green", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>

</div>

<div class="grid grid-cols-2">

<div class="card">${
resize((width) => Plot.plot({
      title: `Heart Rate (${fmt.timestamp(runMeta1.ts)})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxHRY] },
      marks: [
        Plot.rect(splits1,{x:"split",y1:"min_hr",y2:"max_hr", fill: 'green', opacity: 0.2,
          title: d => `${d.min_hr} - ${d.max_hr} bpm`
        }),
        Plot.line(splits1, {x: "split", y: "avg_hr", stroke: "green", strokeWidth: 2}),
        Plot.line(splits2, {x: "split", y: "avg_hr", stroke: "darkorange", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>
<div class="card">${
  resize((width) => Plot.plot({
      title: `Heart Rate (${fmt.timestamp(runMeta2.ts)})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxHRY] },
      marks: [
        Plot.rect(splits2,{x:"split",y1:"min_hr",y2:"max_hr", fill: 'darkorange', opacity: 0.2,
          title: d => `${d.min_hr} - ${d.max_hr} bpm`
        }),
        Plot.line(splits2, {x: "split", y: "avg_hr", stroke: "darkorange", strokeWidth: 2}),
        Plot.line(splits1, {x: "split", y: "avg_hr", stroke: "green", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>

</div>
