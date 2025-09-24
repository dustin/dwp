---
theme: dashboard
title: downwind dashboard
toc: true
sql:
  runs: runs.parquet
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
```

```js
const totals = Array.from(await sql`
select
  count(*) as sessions,
  sum(duration_sec) as time,
  sum(distance_km) as dist,
  sum(paddle_up_count) paddle_ups,
  max(max_speed_kmh) as max_speed,
  max(max_speed_1k) as  max_speed_1k,
  max(longest_segment_distance) longest_seg,
  max(max_distance) max_dist
from runs
`);
```

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Sessions</h2>
    <span class="big">${comma(totals[0].sessions)}</span>
  </div>
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">${formatSeconds(totals[0].time)}</span>
  </div>
  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">${comma(totals[0].dist.toFixed(2))} km</span>
  </div>
  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">${comma(totals[0].paddle_ups)}</span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${totals[0].max_speed.toFixed(2)} kph</span>
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${minutes(1 / (totals[0].max_speed_1k / 60))} min/km</span>
  </div>
  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">${(totals[0].longest_seg / 1000).toFixed(2)} km</span>
  </div>
  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">${(totals[0].max_dist / 1000).toFixed(2)} km</span>
  </div>
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

```js
      Plot.plot({
        width,
        x: {type: "utc"},
        y: {grid: true, label: "rate"},
        marks: [
          Plot.rect(hrs,
                    {x: "week_start", y1: "min_hr", y2: "max_hr", stroke: "#100", fill: '#c00',
                     interval: d3.utcWeek, strokeWidth: 2,
                     opacity: 0.3, tip: true}),
          Plot.linearRegressionY(hrs, {x: "week_start", y: "min_hr", stroke: "#606"})
        ]
      })
```

## Distances

```js
let runDist = Array.from(await sql`
select
	ts,
    distance_km as distance,
    duration_sec as duration,
	start_beach,
	end_beach,
    avg_speed_kmh as avg_speed, max_speed_kmh as max_speed,
	name,
	description,
	feeling,
	equip_1,
	equip_2,
	equip_3
from runs
order by distance_km desc
`);
runDist.forEach(d => d.ts = new Date(d.ts * 1000));

let maxDist = Array.from(await sql`
select ts, start_beach, end_beach, (max_distance / 1000) as max_distance
from runs
order by max_distance desc
`);
maxDist.forEach(d => d.ts = new Date(d.ts * 1000));

let longestSegments = Array.from(await sql`
select longest_segment_start as start,
       longest_segment_end as end,
       longest_segment_distance as dist,
       start_beach, end_beach
from runs
order by dist desc
`);
longestSegments.forEach(d => {
  d.start = new Date(d.start);
  d.end = new Date(d.end);
  });

let paddleUps = Array.from(await sql`
select
  ts,
  start_beach,
  end_beach,
  coalesce(equip_2, 'unknown foil') as foil,
  coalesce(paddle_up_count, 0) as paddle_up_count
from runs
`);
paddleUps.forEach(d => d.ts = new Date(d.ts * 1000));
```

<div class="grid grid-cols-2" style="grid-auto-rows: 504px;">
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Total Distance Traveled",
                        width,
                        marks: [
                          Plot.linearRegressionY(runDist, {x: "ts", y: "distance", stroke: "#606"}),
                          Plot.dot(runDist,
                            {x: "ts", y: "distance", fill: "start_beach", r: 5,
                            title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "went", d.distance.toFixed(2), "km"].join(' '))
                            }),
                        ]
                      })
                      )
  }</div>
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Maximum Distance from Land",
                        width,
                        marks: [
                          Plot.linearRegressionY(maxDist, {x: "ts", y: "max_distance", stroke: "#606"}),
                          Plot.dot(maxDist,
                            {x: "ts", y: "max_distance", r: 5,
                            fill: "start_beach",
                            title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "hit", d.max_distance.toFixed(2), "km"].join(' '))
                            }),
                        ]
                        }))
  }</div>
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Longest Segment on Foil",
                        width,
                        marks: [
                          Plot.linearRegressionY(longestSegments, {x: "start", y: "dist", stroke: "#606"}),
                          Plot.dot(longestSegments,
                            {x: "start", y: "dist", r: 5,
                            fill: "start_beach",
                            title: d => ([dateFmt(d.start) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "went",
                                          (d.dist / 1000).toFixed(2), "km in", timeDiff(d.start, d.end)
                                         ].join(' '))
                            }),
                        ]
                        }))
  }</div>
  <div class="card">${
    resize((width) => Plot.plot({
                        title: "Paddle Ups",
                        width, color: { legend: true },
                        marks: [
                          Plot.linearRegressionY(paddleUps, {x: "ts", y: "paddle_up_count", stroke: "#606"}),
                          Plot.dot(paddleUps,
                            {x: "ts", y: "paddle_up_count", r: 5,
                            fill: "foil",
                            title: d => ([dateFmt(d.ts) + ":", "from", d.start_beach, "to",
                                          d.end_beach, "paddled up",
                                          d.paddle_up_count, "times using the", d.foil
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

```js
Plot.plot({
  width,
  x: {type: "utc"},
  marks: [
    Plot.linearRegressionY(paces, {x: "ts", y: "maxspeed", stroke:
    "#606"}),
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

## Starts and Ends

This shows where I start and end my runs.

If you hover over a
beach's arc, it'll highlight the places I've gone from that beach.

```js
function renderChord(beaches) {
  const height = 800,
        width = height;

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
renderChord(Array.from(await sql`
select start_beach, end_beach from runs
`))
```
