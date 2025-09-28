---
theme: dashboard
title: a downwind run
toc: true
---

```js
import {renderRun} from "./components/map.js";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";

const runCsv = (await FileAttachment("run.csv").csv({typed: true})).map(d => ({
...d,
ts: new Date(d.tsi * 1000),
}));

const runMeta = (await FileAttachment("runs.csv").csv({typed: true})).filter(d => d.id === runCsv[0].dwid).map(d => ({
  ...d,
  ts: new Date(d.ts * 1000),
  longest_segment_start: new Date(d.longest_segment_start),
  longest_segment_end: new Date(d.longest_segment_end),
  foil: d.equip_2 || "unknown foil",
  pct_dist_on_foil: d.distance_on_foil / (1000 * d.distance_km),
  pct_time_on_foil: d.duration_on_foil / d.duration_sec,
  ts: new Date(d.ts),
}))[0];

const calloutSpots = {
  minHr: runCsv.find(d => d.speed > 11 && d.hr === runMeta.min_foiling_hr),
  maxSpeed: runCsv[d3.maxIndex(runCsv,d => d.speed)],
  maxDist: runCsv[d3.maxIndex(runCsv,d => d.distance_to_land)],
};
const callouts = [
    { lat: calloutSpots.minHr.lat, lon: calloutSpots.minHr.lon, icon: "🫀",
      text: `Min foiling heart rate of ${runMeta.min_foiling_hr} bpm` },
    { lat: calloutSpots.maxSpeed.lat, lon: calloutSpots.maxSpeed.lon, icon: "🚀",
      text: `Top speed of ${calloutSpots.maxSpeed.speed.toFixed(2)} kph` },
    { lat: calloutSpots.maxDist.lat, lon: calloutSpots.maxDist.lon, icon: "🗺️",
      text: `Maximum distance from land of ${(calloutSpots.maxDist.distance_to_land/1000).toFixed(2)} km` },
];
```

# From ${runMeta.start_beach} to ${runMeta.end_beach}

<div>
    ${fmt.date(runMeta.date)} at ${runMeta.time}
    on the ${runMeta.foil}
</div>

<div class="card">${resize(width => renderRun(width, runCsv, callouts))}</div>

## At a Glance

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">${fmt.seconds(runMeta.duration_sec)}</span>
  </div>
  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">${runMeta.distance_km.toFixed(2)} km</span>
  </div>
  <div class="card">
    <h2>Distance Traveled on Foil</h2>
    <span class="big">${(runMeta.distance_on_foil / 1000).toFixed(2)} km
        (${(runMeta.pct_dist_on_foil * 100).toFixed(0)}%)</span>
  </div>
  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">${runMeta.paddle_up_count}</span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${runMeta.max_speed_kmh.toFixed(2)} kph</span>
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${fmt.pace(runMeta.max_speed_1k)} min/km</span>
  </div>
  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">${(runMeta.longest_segment_distance / 1000).toFixed(2)} km</span>
  </div>
  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">${(runMeta.max_distance / 1000).toFixed(2)} km</span>
  </div>
</div>

## Speed

```js
const [onFoil, offFoil] = _.unzip(
  _.map(runCsv, d => {
    const on = d.speed > 11;
    return [ { ...d, speed: on ? d.speed : null, }, { ...d, speed: on ? null : d.speed }
    ]
  })
);
```

<div class="card">${
    resize(width => Plot.plot({
        title: "Speed",
        width, x: {tickFormat: d3.timeFormat("%H:%M")},
        marks: [
            Plot.areaY(onFoil, { x: "ts", y: "speed", fill: "#030" }),
            Plot.lineY(onFoil, { x: "ts", y: "speed", stroke: "#050" }),
            Plot.areaY(offFoil, { x: "ts", y: "speed", fill: "#500" }),
            Plot.lineY(offFoil, { x: "ts", y: "speed", stroke: "#900" }),
            Plot.lineY(runCsv, { x: "ts", y: "avg_speed_1k", stroke: "#808",
                                 opacity: 0.5, strokeWidth: 5 }),
            Plot.crosshair(runCsv, {x: "ts", y: "speed"})
        ]
    }))
}</div>

## Splits

```js
function pace(speed) {
  return (60/speed);
}

const splits = d3.groups(runCsv,
  d => (Math.floor(d.distance / 1000))).map(([s, d]) => {
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
    }
  });
```

<div class="card">${
  resize((width) => Plot.plot({
      title: "Speed",
      color: { legend: true },
      width, x: { interval: 1, label: "km" },
      marks: [
        Plot.rect(splits,{x:"split",y1:"min_speed",y2:"max_speed", fill: "green", opacity: 0.2,
          title: d => `${d.min_speed.toFixed(2)} - ${d.max_speed.toFixed(2)} kph\n${fmt.pace(d.avg_speed.toFixed(2))} min/km\n${d.avg_speed.toFixed(2)} kph avg`
        }),
        Plot.line(splits, {x: "split", y: "avg_speed", stroke: "green", strokeWidth: 2})
      ]
    })
    )
}</div>

<div class="card">${
  resize((width) => Plot.plot({
      title: "Pace",
      color: { legend: true },
      width, x: { interval: 1, label: "km" },
      marks: [
        Plot.barY(splits,{x:"split",y:"avg_pace", fill: "green", opacity: 0.2,
          title: (d => `${fmt.pace(d.avg_speed.toFixed(2))} min/km\n${d.avg_speed.toFixed(2)} kph`) }),
        // Plot.line(splits, {x: "split", y: "max_pace", stroke: "green", strokeWidth: 2})
      ]
    })
    )
}</div>

<div class="card">${
  resize((width) => Plot.plot({
      title: "Heart Rate",
      color: { legend: true },
      width, x: { interval: 1, label: "km" },
      marks: [
        Plot.rect(splits,{x:"split",y1:"min_hr",y2:"max_hr", fill: 'red', opacity: 0.2,
          title: d => `${d.min_hr} - ${d.max_hr} bpm`
        }),
        Plot.line(splits, {x: "split", y: "avg_hr", stroke: "red", strokeWidth: 2})
      ]
    })
    )
}</div>
