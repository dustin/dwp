---
theme: dashboard
title: a downwind run
toc: true
---

```js
import {renderRun, findCallouts} from "./components/map.js";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";
import {csv} from "https://cdn.jsdelivr.net/npm/d3-fetch@3/+esm";
import {autoType} from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";
import {fetchMeta, fetchRun} from "./components/data.js";

const allRuns = await fetchMeta(() => FileAttachment('data/runs.csv'));

const beaches = [...new Set(allRuns.map(d => d.start_beach))].sort();
const beachColor = d3.scaleOrdinal(d3.schemeObservable10).domain(beaches);

const runMetaMap = allRuns.reduce((m, r) => {
  m[r.id] = r
  return m;
}, {});

const urlParams = new URLSearchParams(window.location.search);
const thisId = urlParams.get("id");

const runMeta = runMetaMap[thisId] || _.maxBy(allRuns, d => d.ts);
```

# From ${runMeta.start_beach} to ${runMeta.end_beach}

<div>
    ${fmt.date(runMeta.ts)} at ${fmt.time(runMeta.ts)}
    on the ${runMeta.foil}
</div>

```js
const runCsv = await fetchRun(runMeta.id);

const callouts = findCallouts(runMeta, runCsv);
```

<div class="card">${resize(width => renderRun(width, [runCsv], callouts))}</div>

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

const segments = tl.computeSegments(runCsv);
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
const splits = tl.computeSplits(runCsv);
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

## Compare

You can compare this run to a similar run by clicking on one of the timestamps below.

<div class="card">${
Inputs.table(allRuns.filter(d => d.id != thisId && (
    d.start_beach == runMeta.start_beach || d.end_beach == runMeta.end_beach)).sort((a, b) => b.ts - a.ts), {
    columns: [
      "date",
      "linkedDate",
      "start_beach",
      "end_beach",
      "distance_km",
      "distance_on_foil",
      "duration_sec",
      "duration_on_foil",
      "max_speed_1k",
      "foil"
    ],
    header: {
      date: "Date",
      linkedDate: "Time",
      start_beach: "Start Beach",
      end_beach: "End Beach",
      distance_km: "Run Distance (km)",
      distance_on_foil: "On Foil (km)",
      duration_sec: "Run Duration",
      duration_on_foil: "On Foil",
      max_speed_1k: "Fastest km Pace",
      foil: "Foil"
      },
      format: {
        date: fmt.date,
        linkedDate: d => htl.html`<a href="/compare.html?id1=${thisId}&id2=${d.id}">${fmt.time(d.date)}</a>`,
        distance_on_foil: d => (d / 1000).toFixed(2),
        duration_on_foil: fmt.seconds,
        duration_sec: fmt.seconds,
        start_beach: d => htl.html`<span style="color: ${beachColor(d)}">${d}</span>`,
        max_speed_1k: d => fmt.pace(d).split(' ')[0]
      }})
}</div>
