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
import {renderRun, renderCmp} from "./components/map.js";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";
import {csv} from "https://cdn.jsdelivr.net/npm/d3-fetch@3/+esm";
import {autoType} from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";

const allRuns = (await FileAttachment("data/runs.csv").csv({typed:true})).map(r => ({
  ...r,
  ts: new Date(r.ts * 1000),
  longest_segment_start: new Date(r.longest_segment_start),
  longest_segment_end:   new Date(r.longest_segment_end),
  foil: r.equip_2 ?? "unknown foil",
  pct_dist_on_foil: r.distance_on_foil / (1000 * r.distance_km),
  pct_time_on_foil: r.duration_on_foil / r.duration_sec,

})
);

const runMetaMap = allRuns.reduce((m, r) => {
  m[r.id] = r
  return m;
}, {});

const urlParams = new URLSearchParams(window.location.search);

const runMeta1 = runMetaMap[urlParams.get("id1")] || _.maxBy(allRuns, d => d.ts);
const runMeta2 = runMetaMap[urlParams.get("id2")] || _.maxBy(allRuns, d => d.ts);

const runDataURL1 = `https://s3.us-east-1.amazonaws.com/db.downwind.pro/runs/dwid%3D${runMeta1.id}/data.csv`;
const runDataURL2 = `https://s3.us-east-1.amazonaws.com/db.downwind.pro/runs/dwid%3D${runMeta2.id}/data.csv`;
```

# Comparing a run on <span class="run1">${fmt.date(runMeta1.ts)}</span> to a run on <span class="run2">${fmt.date(runMeta2.ts)}</span>

```js
const runCsv1 = _.sortBy(await csv(runDataURL1, autoType)
                     .then(data => data.map(d => ({...d, ts: new Date(d.tsi*1000)}))), d => d.tsi);
const runCsv2 = _.sortBy(await csv(runDataURL2, autoType)
                     .then(data => data.map(d => ({...d, ts: new Date(d.tsi*1000)}))), d => d.tsi);

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

const calloutSpots = [];
```

<div class="card">${resize(width => renderRun(width, [runCsv1, runCsv2], calloutSpots, {colorizers: colorizers}))}</div>

## At a Glance

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">
      <span class="run1">${fmt.seconds(runMeta1.duration_sec)}</span>
      /
      <span class="run2">${fmt.seconds(runMeta2.duration_sec)}</span>
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
</div>

## Speed

<div class="card">${
resize(width => Plot.plot({
    title: "Speed",
    width, x: {tickFormat: d3.timeFormat("%H:%M")},
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

const maxPaceY = Math.max(
  ...splits1.map(d => d.avg_pace),
  ...splits2.map(d => d.avg_pace)
);

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
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxPaceY] },
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
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxPaceY] },
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
        Plot.rect(splits1,{x:"split",y1:"min_hr",y2:"max_hr", fill: 'orange', opacity: 0.2,
          title: d => `${d.min_hr} - ${d.max_hr} bpm`
        }),
        Plot.line(splits1, {x: "split", y: "avg_hr", stroke: "orange", strokeWidth: 2}),
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
        Plot.line(splits1, {x: "split", y: "avg_hr", stroke: "orange", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>

</div>
