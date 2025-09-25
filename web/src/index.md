---
theme: dashboard
title: downwind dashboard
toc: true
sql:
  runs: runs.csv
---

# Downwinding

```js
import * as duckdb from "npm:@duckdb/duckdb-wasm";

const dateFmt = d3.utcFormat("%Y-%m-%d");
const comma = d3.format(',');

function timeDiff(start, end) {
  const diffMs = end - start;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

function formatSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = (totalSeconds % 60).toFixed(0);

  return [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    seconds > 0 ? `${seconds}s` : null
  ].filter(Boolean).join(" ");
}

function minutes(x) {
    const m = Math.floor(x);
    const s = Math.floor(60 * (x - m));
    return (m + ":" + (s < 10 ? "0" : "") + s);
}

function toMonth(d) {
  return new Date(d3.utcFormat("%Y-%m-01")(d));
}

let runCsv = (await FileAttachment("runs.csv").csv({typed: true}));
runCsv.forEach(d => {
  d.ts = new Date(d.ts * 1000);
  d.longest_segment_start = new Date(d.longest_segment_start);
  d.longest_segment_end = new Date(d.longest_segment_end);
  d.foil = d.equip_2 || "unknown foil";
  d.month = toMonth(d.ts);
  });
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
```

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Sessions</h2>
    <span class="big">${comma(totals.sessions)}</span>
  </div>
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">${formatSeconds(totals.time)}</span>
  </div>
  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">${comma(totals.dist.toFixed(2))} km</span>
  </div>
  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">${comma(totals.paddle_ups)}</span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${totals.max_speed.toFixed(2)} kph</span>
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${minutes(1 / (totals.max_speed_1k / 60))} min/km</span>
  </div>
  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">${(totals.longest_seg / 1000).toFixed(2)} km</span>
  </div>
  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">${(totals.max_dist / 1000).toFixed(2)} km</span>
  </div>
</div>

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
                            // tip: { format: { y: d => `${d}` }, },
                            title: d => `${d.region}\n${d.count} of ${d.total} runs`})
                        ]
                      })
                      )
  }</div>
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Outings (Duration)",
                        color: { legend: true },
                        width, x: { interval: Plot.utcInterval("month"), label: "" },
                        y: { tickFormat: d => formatSeconds(d).split(' ')[0] },
                        marks: [
                          Plot.barY(outings,{x:"ts",y:"duration", fill: "region",
                            // tip: { format: { y: d => `${d}` }, },
                            title: d => `${d.region}\n${formatSeconds(d.duration)} of ${formatSeconds(d.totalDuration)}`})
                        ]
                      })
                      )
  }</div>
</div>


## Distances

<div class="grid grid-cols-2" style="grid-auto-rows: 504px;">
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Total Distance Traveled",
                        width, y: { label: "km" },
                        marks: [
                          Plot.linearRegressionY(runCsv, {x: "ts", y: "distance_km", stroke: "#606"}),
                          Plot.dot(runCsv,
                            {x: "ts", y: "distance_km", fill: "start_beach", r: 5,
                            title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "went", d.distance_km.toFixed(2), "km"].join(' '))
                            }),
                        ]
                      })
                      )
  }</div>
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Maximum Distance from Land",
                        width, y: { label: "km", tickFormat: d => (d/1000).toFixed(0) },
                        marks: [
                          Plot.linearRegressionY(runCsv, {x: "ts", y: "max_distance", stroke: "#606"}),
                          Plot.dot(runCsv,
                            {x: "ts", y: "max_distance", r: 5,
                            fill: "start_beach",
                            title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "hit", (d.max_distance / 1000).toFixed(2), "km"].join(' '))
                            }),
                        ]
                        }))
  }</div>
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Longest Segment on Foil",
                        width, y: { label: "km", tickFormat: d => (d/1000).toFixed(0) },
                        marks: [
                          Plot.linearRegressionY(runCsv, {x: "longest_segment_start", y: "longest_segment_distance", stroke: "#606"}),
                          Plot.dot(runCsv,
                            {x: "longest_segment_start", y: "longest_segment_distance", r: 5,
                            fill: "start_beach",
                            title: d => ([dateFmt(d.longest_segment_start) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "went",
                                          (d.longest_segment_distance / 1000).toFixed(2), "km in",
                                          timeDiff(d.longest_segment_start, d.longest_segment_end)
                                         ].join(' '))
                            }),
                        ]
                        }))
  }</div>
    <div class="card">${
    resize((width) => Plot.plot({
                        title: "Distance to First Paddle Up",
                        width, y: { label: "meters" },
                        marks: [
                          Plot.linearRegressionY(runCsv, {x: "ts", y: "distance_to_first_paddle_up", stroke: "#606"}),
                          Plot.dot(runCsv,
                            {x: "ts", y: "distance_to_first_paddle_up", r: 5,
                            fill: "start_beach",
                            title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "paddled up within",
                                          (d.distance_to_first_paddle_up || 0).toFixed(0), "meters", d.foil
                                         ].join(' '))
                            }),
                        ]
                        }))
  }</div>

</div>

```js
const colorLegend = Plot.legend({color: { domain: Array.from(await sql`
   select distinct  start_beach from runs
   `).map(d => d.start_beach) }});
```

Broken down by start beach:  ${colorLegend}

## Paddling

The number of times I've had to paddle up on a run has changed quite a bit from
the beginning.  At first, "I paddled up one time the whole outing" meant
something very different than it does now.

<div class="card">

```js
Plot.plot({
       title: "Paddle Ups",
       width, color: { legend: true },
       marks: [
         Plot.linearRegressionY(runCsv, {x: "ts", y: "paddle_up_count", stroke: "#606"}),
         Plot.dot(runCsv,
           {x: "ts", y: "paddle_up_count", r: 5,
           fill: "foil",
           title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                         d.end_beach, "paddled up",
                         d.paddle_up_count, "times using the", d.foil
                        ].join(' '))
           }),
       ]
       })
```

</div>

## Speed

This is a measure of the fastest speed I could average over a full
kilometer.  My peak speed would be better, but this is an interesting
metric to me.

```js
let paces = Array.from(await sql`
with paced as NOT MATERIALIZED (
  select ts, max_speed_1k, (1 / (max_speed_1k / 60)) as maxpace, start_beach, end_beach
    from runs
)

select
  ts, max_speed_1k as maxspeed, maxpace,
  start_beach, end_beach
from paced
order by max_speed_1k desc
`);
paces.forEach(d => d.ts = new Date(d.ts * 1000));

const weekSpeed = d3.group(paces, d => {
  let weekStart = d.ts;
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return weekStart;
});

// Convert to array format
const weekSpeedA = Array.from(weekSpeed, ([weekTime, runs]) => ({
  week_start: weekTime,
  run_count: runs.length,
  min_max: d3.min(runs, d => d.maxspeed),
  max_max: d3.max(runs, d => d.maxspeed),
  runs: runs
}));
```

<div class="card">

```js
Plot.plot({
  width,
  x: {type: "utc"}, y: { label: "kph" },
  marks: [
    Plot.linearRegressionY(paces, {x: "ts", y: "maxspeed", stroke: "#606"}),
    Plot.rect(weekSpeedA,
      {x: "week_start", y1: "min_max", y2: "max_max", strokeWidth: 5,
       fill: '#050', stroke: '#030', interval: d3.utcWeek,
       opacity: 0.3, tip: true,
       }),
    Plot.dot(paces,
      {x: "ts", y: "maxspeed", r: 5,
      fill: "start_beach",
      title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                    d.end_beach, "hit", minutes(d.maxpace), "mins/km"].join(' '))
      }),
  ]
})

```

</div>

## Minimum Heart Rate on Foil (weekly)

How low can I get my heart rate while riding on foil?

```js
let hrs = Array.from(await sql`
select time_bucket(interval '1 week', date)::text as week_start,
       min(min_foiling_hr) as min_hr,
       max(min_foiling_hr) as max_hr
  from runs
where min_foiling_hr is not null
group by week_start
order by week_start`);
hrs.forEach(d => d.week_start = new Date(d.week_start));
```

<div class="card">

```js
      Plot.plot({
        width,
        x: {type: "utc"},
        y: {grid: true, label: "heart bpm"},
        marks: [
          Plot.rect(hrs,
                    {x: "week_start", y1: "min_hr", y2: "max_hr", stroke: "#100", fill: '#c00',
                     interval: d3.utcWeek, strokeWidth: 2,
                     opacity: 0.3, tip: true}),
          Plot.linearRegressionY(hrs, {x: "week_start", y: "min_hr", stroke: "#606"})
        ]
      })
```

</div>

## Starts and Ends

This shows where I start and end my runs.

If you hover over a
beach's arc, it'll highlight the places I've gone from that beach.

```js
function renderChord(beaches) {
  const height = 800,
        width = Math.max(height, 1000);

    var svg = d3.create('svg')
      .attr("viewBox", [-width / 2, -height / 2, width, height]);

  const g = svg.append('g');

  const innerR = 285;
  const outerR = 300;

  const popularity = d3.rollup(beaches, d => d.length, d => d.start_beach);
  const beachNames = Array.from(new Set(beaches.flatMap(d => [d.start_beach, d.end_beach]))).sort(
                          (a, b) => d3.descending(popularity[a], popularity[b]));
  const index = new Map(beachNames.map((name, i) => [name, i]));
  const matrix = Array.from(index, () => new Array(beachNames.length).fill(0));
  for (const {start_beach, end_beach} of beaches) matrix[index.get(start_beach)][index.get(end_beach)] += 1;

  const color = d3.scaleOrdinal(beachNames, d3.schemeCategory10);

  let chords = d3.chordDirected()
    .padAngle(10 / innerR)
    .sortSubgroups(d3.ascending)
    .sortChords(d3.ascending)
    (matrix);

  let textArc = d3.arc()
    .innerRadius(outerR)
    .outerRadius(outerR + 20)

    const sources = d3.rollup(chords, c => c.map(x => x.source.index), c => c.target.index);

  const pluralize = (n,s,p) => n == 1 ? s : p;

  const lblTitle = d => {
    const launches = d3.sum(chords, c => (c.source.index === d.index) * c.source.value);
    const landings = d3.sum(chords, c => (c.target.index === d.index) * c.source.value);
    let parts = [];
    if (launches > 0) { parts.push([`${launches} ${pluralize(launches, "launch", "launches")}`]) };
    if (landings > 0) { parts.push([`${landings} ${pluralize(landings, "landing", "landings")}`])};
    return parts.join(' ');
  };

  g.selectAll('.labels')
    .data(chords.groups)
    .enter()
    .append('text')
    .attr('stroke', '#ccc')
    .attr("font-size", 10)
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr('class', d => {
      const classes = ['labels'];
      const inbound = sources.get(d.index) || [];
      inbound.forEach(src => classes.push(`target-of-${src}`));
      return classes.join(' ');
    })
    .attr('id', d => `label-${d.index}`)
    .attr('text-anchor', d => { return d.angle > Math.PI ? 'end' : null; })
    .attr('transform', d => {
      let res = `rotate(${ d.angle * 180 / Math.PI - 90}) translate(${innerR + 30})`;
      res += d.angle > Math.PI ? 'rotate(180)' : '';

    	return res;
    })
    .text(d => beachNames[d.index])
    .append("title")
      .text(lblTitle);


  g.selectAll('.nodes')
    .data(chords.groups)
    .enter()
    .append('path')
    .attr('class', d => {
      const classes = ['nodes'];
      const inbound = sources.get(d.index) || [];
      inbound.forEach(src => classes.push(`target-of-${src}`));
      return classes.join(' ');
    })
    .attr('id', d => `node-${d.index}`)
    .attr('d', d3.arc()
      .innerRadius(innerR)
      .outerRadius(outerR)
    )
    .attr('fill', d => color(beachNames[d.index]))
    .attr('opacity', 0.8)
    .on('mouseover', (e, d) => {
      g.selectAll('.nodes')
        .attr('opacity', 0.2);

      g.selectAll('.links')
        .attr('opacity', 0.1);

      g.selectAll('.labels')
        .attr('opacity', 0.2);

      g.select(`#node-${d.index}`)
        .attr('opacity', 0.8);
      g.selectAll(`.target-of-${d.index}`)
        .attr('opacity', 0.8);

      g.selectAll(`.source-link-${d.index}`)
        .attr('opacity', 0.5);

      g.select(`#label-${d.index}`)
        .attr('opacity', 1);
    })
    .on('mouseout', (d) => {
      g.selectAll('.nodes')
        .attr('opacity', 0.8);

      g.selectAll('.links')
        .attr('opacity', 0.3);

       g.selectAll(`.labels`)
        .attr('opacity', 1);
    })
    .append("title")
      .text(lblTitle);

  g.selectAll('links')
    .data(chords)
    .enter()
    .append('path')
    .attr('class', d => `links source-link-${d.source.index}`)
    .attr('d', d3.ribbon().radius(innerR))
    .attr("fill", d => color(beachNames[d.source.index]))
    .attr('opacity', 0.3);

  return svg.node();
}

```

```js
renderChord(runCsv)
```
