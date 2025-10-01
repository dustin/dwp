---
theme: dashboard
title: a downwind run
toc: true
---

```js
import {renderRun} from "./components/map.js";
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

const runMeta = runMetaMap[urlParams.get("id")] || _.maxBy(allRuns, d => d.ts);

const runDataURL = `https://s3.us-east-1.amazonaws.com/db.downwind.pro/runs/dwid%3D${runMeta.id}/data.csv`;
```

# From ${runMeta.start_beach} to ${runMeta.end_beach}

<div>
    ${fmt.date(runMeta.ts)} at ${fmt.time(runMeta.ts)}
    on the ${runMeta.foil}
</div>

```js
const runCsv = _.sortBy(await csv(runDataURL, autoType)
                     .then(data => data.map(d => ({...d, ts: new Date(d.tsi*1000)}))), d => d.tsi);

const calloutSpots = {
  minHr: runCsv.find(d => d.speed > 11 && d.hr === runMeta.min_foiling_hr),
  maxSpeed: _.maxBy(runCsv, d => d.speed),
  maxDist: _.maxBy(runCsv, d => d.distance_to_land),
};
const callouts = [
    { lat: calloutSpots.maxSpeed.lat, lon: calloutSpots.maxSpeed.lon, icon: "🚀",
      text: `Top speed of ${calloutSpots.maxSpeed.speed.toFixed(2)} kph` },
    { lat: calloutSpots.maxDist.lat, lon: calloutSpots.maxDist.lon, icon: "🗺️",
      text: `Maximum distance from land of ${(calloutSpots.maxDist.distance_to_land/1000).toFixed(2)} km` },
];

// Sometimes I didn't get on foil enough to have a min heart rate there.
if (calloutSpots.minHr) {
  callouts.push({ lat: calloutSpots.minHr.lat, lon: calloutSpots.minHr.lon, icon: "🫀",
    text: `Min foiling heart rate of ${runMeta.min_foiling_hr} bpm` });
}
```

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
    <span class="big">${runMeta.paddle_up_count || 0}</span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${runMeta.max_speed_kmh.toFixed(2)} kph</span>
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${fmt.pace(runMeta.max_speed_1k)}</span>
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

const SPEED_THRESHOLD = 11;
const MIN_DURATION_MS = 5000;

const segments = runCsv.reduce((acc, d, i) => {
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
            data: [d]
        });
        return {
            segments,
            pendingState: speedIndicatesOnFoil !== null ? {
                state: speedIndicatesOnFoil,
                startTime: d.ts
            } : null
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
            pendingState: null
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
                startTime: d.ts
            }
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
            data: [d]
        });

        return {
            segments,
            pendingState: null
        };
    } else {
        // Still pending - continue current segment
        const currentSegment = segments[segments.length - 1];
        currentSegment.end = d.ts;
        currentSegment.data.push(d);

        return {
            segments,
            pendingState
        };
    }
}, { segments: [], pendingState: null }).segments;
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
            Plot.crosshair(runCsv, {x: "ts", y: "speed"}),
            Plot.tip(runCsv, Plot.pointer({
                x: "ts",
                y: "speed", fontSize: 15,
                title: d => {
                    const seg = segments.find(s => d.ts >= s.start && d.ts <= s.end);
                    if (!seg) return null;
                    const speeds = seg.data.map(d => d.speed);
                    const hrs = seg.data.map(d => d.hr).filter(h => h !== null);
                    const [mindist, maxdist] = d3.extent(seg.data.map(d => d.distance));
                    const dist = maxdist - mindist;
                    const landdist = d3.mean(seg.data, d => d.distance_to_land);
                    const desc = [
                        `${seg.onFoil ? 'On' : 'Off'} foil segment`,
                        `Duration: ${fmt.timeDiff(seg.start, seg.end)}`,
                        `Distance Traveled: ${fmt.distanceM(dist)}`,
                        `Nearest Land: ${fmt.distanceM(landdist)}`,
                        `Max speed: ${fmt.speed(d3.max(speeds))}`,
                        `Average speed: ${fmt.speed(d3.mean(speeds))}`,
                        `Pace: ${fmt.pace(d3.mean(speeds))}`,
                        `Average HR: ${fmt.hr(d3.mean(hrs))}`,
                        `Max HR: ${fmt.hr(d3.max(hrs))}`,
                        `Min HR: ${fmt.hr(d3.min(hrs))}`
                    ];
                    return desc.join('\n');
                }
            }))
        ]
    }))
}</div>

## Splits

```js
function pace(speed) {
  return (60/speed);
}

const splits = _.orderBy(d3.groups(runCsv,
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
  }), d => d.split);
```

<div class="card">${
  resize((width) => Plot.plot({
      title: "Speed",
      color: { legend: true },
      width, x: { interval: 1, label: "km" },
      marks: [
        Plot.rect(splits,{x:"split",y1:"min_speed",y2:"max_speed", fill: "green", opacity: 0.2,
          title: d => `${d.min_speed.toFixed(2)} - ${d.max_speed.toFixed(2)} kph\n${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph avg`
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
          title: (d => `${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph`) }),
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
