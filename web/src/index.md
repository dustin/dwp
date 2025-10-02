---
theme: dashboard
title: downwind dashboard
toc: true
---

# Downwinding Summary

```js
import {renderChord} from "./components/chord.js";
import {renderCrashes} from "./components/map.js";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";

function toWeek(ts) {
  let week = new Date(ts);
  week.setHours(0,0,0,0);
  week.setDate(week.getDate() - week.getDay());
  return week;
}

function toMonth(ts) {
  let month = new Date(ts);
  month.setHours(0,0,0,0);
  month.setDate(1);
  return month;
}

const dryLimit = 0.98;

function isDry(d) {
  return d.longest_segment_distance / d.distance_on_foil > dryLimit;
}

const runCsv = (await FileAttachment("data/runs.csv").csv({typed: true})).map(d => {
  const ts = new Date(d.ts * 1000);
  return {
    ...d,
    ts: ts,
    longest_segment_start: new Date(d.longest_segment_start),
    longest_segment_end: new Date(d.longest_segment_end),
    foil: d.equip_2 || "unknown foil",
    pct_dist_on_foil: d.distance_on_foil / (1000 * d.distance_km),
    pct_time_on_foil: d.duration_on_foil / d.duration_sec,
    linkedDate: {date: ts, id: d.id},
    month: toMonth(ts),
    week: toWeek(ts),
    dry: isDry(d)
  };
});

const latestRun = runCsv[runCsv.findIndex(d => d.ts === d3.max(runCsv, d => d.ts))];
```

```js
const totals = {
  sessions: runCsv.length,
  time: d3.sum(runCsv, d => d.duration_sec),
  dist: d3.sum(runCsv, d => d.distance_km),
  paddle_ups: d3.sum(runCsv, d => d.paddle_up_count),
  max_speed: d3.max(runCsv, d => d.max_speed_kmh),
  max_speed_1k: d3.max(runCsv, d => d.max_speed_1k),
  longest_seg: d3.max(runCsv, d => d.longest_segment_distance),
  max_dist: d3.max(runCsv, d => d.max_distance)
};

totals.max_speed_id = runCsv.find(d => d.max_speed_kmh === totals.max_speed).id;
totals.max_speed_1k_id = runCsv.find(d => d.max_speed_1k === totals.max_speed_1k).id;
totals.longest_seg_id = runCsv.find(d => d.longest_segment_distance === totals.longest_seg).id;
totals.max_dist_id = runCsv.find(d => d.max_distance === totals.max_dist).id;

const beaches = [...new Set(runCsv.map(d => d.start_beach))].sort();
const beachColor = d3.scaleOrdinal(d3.schemeObservable10).domain(beaches);
function beachColorNamed(name) {
  return d => beachColor(d[name]);
}
const beachLegend = Plot.legend({color: ({ domain: beaches, range: d3.schemeObservable10 })});
const regionLegend = Plot.legend({color: ({ domain: runCsv.map(d => d.region) })});
```

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Sessions</h2>
    <span class="big">${fmt.comma(totals.sessions)}</span>
  </div>
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">${fmt.seconds(totals.time)}</span>
  </div>
  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">${fmt.comma(totals.dist.toFixed(2))} km</span>
  </div>
  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">${fmt.comma(totals.paddle_ups)}</span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_speed_id}">
        ${totals.max_speed.toFixed(2)} kph</a>`}</span>
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_speed_1k_id}">
        ${fmt.pace(totals.max_speed_1k)}</a>`}</span>
  </div>
  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.longest_seg_id}">
        ${(totals.longest_seg / 1000).toFixed(2)} km</a>`}</span>
  </div>
  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_dist_id}">
        ${(totals.max_dist / 1000).toFixed(2)} km</a>`}</span>
  </div>
</div>

Check out the details of my ${htl.html`<a href="/run.html?id=${latestRun.id}">most recent run</a>`}
from ${latestRun.start_beach} to ${latestRun.end_beach}
from ${fmt.relativeTime(latestRun.ts)} where I was
on foil ${(latestRun.pct_dist_on_foil * 100).toFixed(0)}% of the way.

## Time on Water

```js
const outings = d3.rollups(runCsv,
  rows => ({ total: rows.length,
             totalDuration: d3.sum(rows, d => d.duration_sec),
             regionCounts: d3.rollup(rows, v => ({
             count: v.length, duration: d3.sum(v, d => d.duration_sec)
             }), d => d.region ) }),
  d => d.month
).flatMap(([ts, { total, totalDuration, regionCounts }]) =>
  Array.from(regionCounts, ([region, { count, duration }]) => ({
    ts,
    region,
    count,
    total,
    duration,
    totalDuration
  }))
);
```

<div class="grid grid-cols-2" style="grid-auto-rows: 504px;">
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Outings",
                        color: { legend: true },
                        width, x: { interval: Plot.utcInterval("month"), label: "" },
                        marks: [
                          Plot.barY(outings,{x:"ts",y:"count", fill: "region",
                                             title: d => d.count == d.total
                                             ? `${d.region}\n${d.count} runs`
                                             : `${d.region}\n${d.count} of ${d.total} runs`})
                        ]
                      })
                      )
  }</div>
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Outings (Duration)",
                        color: { legend: true },
                        width, x: { interval: Plot.utcInterval("month"), label: "" },
                        y: { tickFormat: d => fmt.seconds(d).split(' ')[0] },
                        marks: [
                          Plot.barY(outings,{x:"ts",y:"duration", fill: "region",
                                             title: d => d.duration == d.totalDuration
                                             ? `${d.region}\n${fmt.seconds(d.duration)}`
                                             : `${d.region}\n${fmt.seconds(d.duration)} of ${fmt.seconds(d.totalDuration)}`})
                        ]
                      })
                      )
  }</div>
</div>

## On Dry Runs

The starred ★ runs below indicate that the distance was "dry."  This typically means I paddled up
once and ran the whole thing without a mistake, but I calculate it a little differently because
I tend to play around early on some of my Kihei runs and it looks like I paddle up more than once.

Instead, I calculate a dry run by verifying that the longest segment is
${(dryLimit * 100).toFixed(1)}% of the total foiling distance.  Basically, are the times
where once I paddled up for real, I stayed up until I was done.

So the following ${runCsv.filter(d => d.dry).length} runs are considered "dry":

<div class="card">${
Inputs.table(runCsv.filter(d => d.dry).sort((a, b) => b.ts - a.ts), {
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
        linkedDate: d => htl.html`<a href="/run.html?id=${d.id}">${fmt.time(d.date)}</a>`,
        distance_on_foil: d => (d / 1000).toFixed(2),
        duration_on_foil: fmt.seconds,
        duration_sec: fmt.seconds,
        start_beach: d => htl.html`<span style="color: ${beachColor(d)}">${d}</span>`,
        max_speed_1k: d => fmt.pace(d).split(' ')[0]
      }})
}</div>

## Distances

```js
function regress(x, y, src) {
  return Plot.linearRegressionY(src || runCsv, {x, y, stroke: "#808"})
}
```

<div class="grid grid-cols-2" style="grid-auto-rows: 504px;">
  <div class="card">${
    resize(tl.tl(runCsv, "Total Distance Traveled per Session", {y: {label: "km"}},
                 "ts", "distance_km" ,
                 {stroke: beachColorNamed("start_beach")},
                 {fill: beachColorNamed("start_beach"),
                  title: d => ([fmt.date(d.ts) + ":", "from", d.start_beach, "to",
                                d.end_beach, "went", d.distance_km.toFixed(2), "km"
                                ].join(' '))})) }
  </div>
  <div class="card">${
    resize(tl.tl(runCsv, "Maximum Distance from Land", {y: { label: "km", tickFormat: d => (d/1000).toFixed(0) } },
                 "ts", "max_distance",
                 {stroke: beachColorNamed("start_beach")},
                 {fill: beachColorNamed("start_beach"),
                  title: d => ([fmt.date(d.ts) + ":", "from", d.start_beach, "to",
                                d.end_beach, "hit", (d.max_distance / 1000).toFixed(2), "km"].join(' '))
                 })
    )
  }</div>
  <div class="card">${
    resize(tl.tl(runCsv, "Longest Segment on Foil",
      {y: { label: "km", tickFormat: d => (d/1000).toFixed(0) } },
      "longest_segment_start", "longest_segment_distance", {stroke: beachColorNamed("start_beach")},
      {fill: beachColorNamed("start_beach"),
       title: d => ([fmt.date(d.longest_segment_start) + ":", "from", d.start_beach, "to",
                     d.end_beach, "went", (d.longest_segment_distance / 1000).toFixed(2), "km in",
                     fmt.timeDiff(d.longest_segment_start, d.longest_segment_end)
                     ].join(' '))
      }
    ))
    }</div>
    <div class="card">${
      resize(tl.tl(runCsv, "Distance to First Paddle Up", {y: { label: "meters" }},
        "ts", "distance_to_first_paddle_up",
        {stroke: beachColorNamed("start_beach")},
        {fill: beachColorNamed("start_beach"),
         title: d => ([fmt.date(d.ts) + ":", "from", d.start_beach, "to",
                       d.end_beach, "paddled up within",
                       (d.distance_to_first_paddle_up || 0).toFixed(0), "meters", d.foil
                      ].join(' '))
        }
      ))
  }</div>

  <div class="card">${
    resize(tl.tl(runCsv, "Percentage of Distance on Foil",
        {y: { label: "percent", tickFormat: d => (d * 100).toFixed(0), domain: [0, 1] }},
        "ts", "pct_dist_on_foil", {stroke: "start_beach"},
        {fill: "start_beach",
         title: d => ([fmt.date(d.ts) + ":", "from", d.start_beach, "to",
                       d.end_beach, "on foil", (d.pct_dist_on_foil * 100).toFixed(0) + "%",
                       "on foil"
                      ].join(' '))
        }
      ))
  }</div>

  <div class="card">${
    resize(tl.tl(runCsv, "Percentage of Time on Foil",
                 {y: { label: "percent", tickFormat: d => (d * 100).toFixed(0), domain: [0, 1] }},
                 "ts", "pct_time_on_foil",
                 {stroke: beachColorNamed("start_beach")},
                 {fill: beachColorNamed("start_beach"),
                  title: d => ([fmt.date(d.ts) + ":", "from", d.start_beach, "to",
                                d.end_beach, "on foil", (d.pct_time_on_foil * 100).toFixed(0) + "%",
                                "of the time foil"
                               ].join(' '))
                 }
    ))
  }</div>


</div>

Broken down by start beach:  ${beachLegend}

## Paddling

The number of times I've had to paddle up on a run has changed quite a bit from
the beginning.  At first, "I paddled up one time the whole outing" meant
something very different than it does now.

<div class="card">

```js
tl.tl(runCsv, "Paddle Ups", {color: { legend: true}},
      "ts", "paddle_up_count",
      {stroke: beachColorNamed("start_beach")},
      {fill: "foil",
        title: d => ([fmt.date(d.ts) + ":", "from", d.start_beach, "to",
                      d.end_beach, "paddled up",
                      d.paddle_up_count, "times using the", d.foil
                     ].join(' '))
      })(width)
```

</div>

## Speed

This is a measure of the fastest speed I could average over a full
kilometer.  My peak speed would be better, but this is an interesting
metric to me.

```js
const weekSpeed = Array.from(
  d3.rollup(
    runCsv,
    g => ({
      min_speed: d3.min(g, d => d.max_speed_1k),
      max_speed: d3.max(g, d => d.max_speed_1k),
      run_count: g.length,
      start_beach: g[0].start_beach,
      end_beach:   g[0].end_beach
    }),
    d => d.week
  ), ([w,o]) => ({week: w, ...o}));
```

<div class="card">

```js
Plot.plot({
  width,
  x: {type: "utc"}, y: { label: "kph" },
  marks: [
    regress("week", "max_speed", weekSpeed),
    Plot.rect(weekSpeed,
      {x: "week", y1: "min_speed", y2: "max_speed", strokeWidth: 5,
       fill: '#050', stroke: '#030', interval: d3.utcWeek,
       opacity: 0.3, tip: true,
       })
  ]
})
```

</div>

## Minimum Heart Rate on Foil (weekly)

How low can I get my heart rate while riding on foil?

```js
const hrs = Array.from(
  d3.rollup(
    runCsv.filter(d => d.min_foiling_hr > 0),
    g => ({
      min_hr: d3.min(g, d => d.min_foiling_hr),
      max_hr: d3.max(g, d => d.min_foiling_hr),
    }),
    d => d.week
  ), ([w,o]) => ({week: w, ...o}));
```

<div class="card">

```js
      Plot.plot({
        width,
        x: {type: "utc"},
        y: {grid: true, label: "heart bpm"},
        marks: [
          Plot.rect(hrs,
                    {x: "week", y1: "min_hr", y2: "max_hr", stroke: "#100", fill: '#c00',
                     interval: d3.utcWeek, strokeWidth: 2,
                     opacity: 0.3, tip: true}),
          regress("week", "min_hr", hrs)
        ]
      })
```

</div>

## Crash Density

```js
const crashes = (await FileAttachment("data/crashes.csv").csv({typed: true})).map(d => ({
    ...d,
    ts: new Date(d.ts * 1000),
    }));

// Recent enough, I guess
const recently = new Date(Date.now() - 80 * 24 * 60 * 60 * 1000);
const someCrashes = crashes.filter(d => d.date > recently);
```

Below is a density map of recent crashes to identify hot spots.

<div class="card">${resize(width => renderCrashes(width, someCrashes))}</div>

## Starts and Ends

This shows where I start and end my runs.

If you hover over a
beach's arc, it'll highlight the places I've gone from that beach.

<div class="card">${resize(width => renderChord(width, runCsv))}</div>

## All Runs

Click through to view details.

<div class="card">${
Inputs.table(runCsv.sort((a, b) => b.ts - a.ts), {
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
        linkedDate: d => htl.html`<a href="/run.html?id=${d.id}">${fmt.time(d.date)}</a>`,
        distance_on_foil: d => (d / 1000).toFixed(2),
        duration_on_foil: fmt.seconds,
        duration_sec: fmt.seconds,
        start_beach: d => htl.html`<span style="color: ${beachColor(d)}">${d}</span>`,
        max_speed_1k: d => fmt.pace(d).split(' ')[0]
      }})
}</div>
