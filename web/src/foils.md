---
theme: dashboard
title: downwind equipment
toc: true
---

# Equipment

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta} from "./components/data.js";
import {foilList, foilColorScale} from "./components/foils.js";

const runCsv = await fetchMeta(() => FileAttachment('data/runs.csv'));
const latestRun = runCsv[runCsv.findIndex(d => d.ts === d3.max(runCsv, d => d.ts))];

const foils = foilList(runCsv);
const foilColor = foilColorScale(runCsv);
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
```

```js
function bestOf(rows, field) {
  return rows.reduce((best, d) => (d[field] > (best?.[field] ?? -Infinity) ? d : best), null);
}

const foilStats = new Map(foils.map(f => {
  const rows = runCsv.filter(d => d.foil === f);
  return [f, {
    sessions: rows.length,
    time: d3.sum(rows, d => d.duration_sec),
    dist: d3.sum(rows, d => d.distance_km),
    paddle_ups: d3.sum(rows, d => d.paddle_up_count),
    avg_speed: d3.mean(rows, d => d.avg_speed_kmh),
    pct_dist_on_foil: d3.mean(rows, d => d.pct_dist_on_foil),
    max_speed: bestOf(rows, "max_speed_kmh"),
    max_speed_1k: bestOf(rows, "max_speed_1k"),
    longest_seg: bestOf(rows, "longest_segment_distance"),
    max_dist: bestOf(rows, "max_distance"),
    first: d3.min(rows, d => d.ts),
    last: d3.max(rows, d => d.ts)
  }];
}));

function foilBreakdown(items) {
  const sorted = items
    .filter(d => d.value != null)
    .sort((a, b) => d3.descending(a.value, b.value));
  return htl.html`<div class="foil-breakdown">${sorted.map(d => htl.html`
    <div class="foil-row">
      <span class="foil-swatch" style=${`background:${foilColor(d.foil)}`}></span>
      <span class="foil-name">${d.foil}</span>
      <span class="foil-value">${d.href ? htl.html`<a href=${d.href}>${d.text}</a>` : d.text}</span>
    </div>`)}</div>`;
}
```

<style>
  .foil-breakdown {
    margin-top: 0.6rem;
    padding-top: 0.4rem;
    border-top: solid 1px var(--theme-foreground-faintest);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.7rem;
  }
  .foil-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--theme-foreground-muted);
  }
  .foil-swatch {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    min-width: 0.6rem;
    border-radius: 50%;
  }
  .foil-name {
    flex: 1 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .foil-value {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .foil-value a {
    color: inherit;
  }
</style>

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Sessions</h2>
    <span class="big">${fmt.comma(totals.sessions)}</span>
    ${foilBreakdown(foils.map(f => ({
      foil: f, value: foilStats.get(f).sessions, text: fmt.comma(foilStats.get(f).sessions)
    })))}
  </div>
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">${fmt.seconds(totals.time)}</span>
    ${foilBreakdown(foils.map(f => ({
      foil: f, value: foilStats.get(f).time, text: fmt.seconds(foilStats.get(f).time)
    })))}
  </div>
  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">${fmt.comma(totals.dist.toFixed(2))} km</span>
    ${foilBreakdown(foils.map(f => ({
      foil: f, value: foilStats.get(f).dist, text: fmt.comma(foilStats.get(f).dist.toFixed(2)) + " km"
    })))}
  </div>
  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">${fmt.comma(totals.paddle_ups)}</span>
    ${foilBreakdown(foils.map(f => ({
      foil: f, value: foilStats.get(f).paddle_ups, text: fmt.comma(foilStats.get(f).paddle_ups)
    })))}
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_speed_id}">
        ${totals.max_speed.toFixed(2)} kph</a>`}</span>
    ${foilBreakdown(foils.map(f => {
      const best = foilStats.get(f).max_speed;
      return best ? {
        foil: f, value: best.max_speed_kmh,
        text: `${best.max_speed_kmh.toFixed(2)} kph`,
        href: `/run.html?id=${best.id}`
      } : { foil: f, value: null };
    }))}
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_speed_1k_id}">
        ${fmt.pace(totals.max_speed_1k)}</a>`}</span>
    ${foilBreakdown(foils.map(f => {
      const best = foilStats.get(f).max_speed_1k;
      return best ? {
        foil: f, value: best.max_speed_1k,
        text: fmt.pace(best.max_speed_1k),
        href: `/run.html?id=${best.id}`
      } : { foil: f, value: null };
    }))}
  </div>
  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.longest_seg_id}">
        ${(totals.longest_seg / 1000).toFixed(2)} km</a>`}</span>
    ${foilBreakdown(foils.map(f => {
      const best = foilStats.get(f).longest_seg;
      return best ? {
        foil: f, value: best.longest_segment_distance,
        text: (best.longest_segment_distance / 1000).toFixed(2) + " km",
        href: `/run.html?id=${best.id}`
      } : { foil: f, value: null };
    }))}
  </div>
  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_dist_id}">
        ${(totals.max_dist / 1000).toFixed(2)} km</a>`}</span>
    ${foilBreakdown(foils.map(f => {
      const best = foilStats.get(f).max_dist;
      return best ? {
        foil: f, value: best.max_distance,
        text: (best.max_distance / 1000).toFixed(2) + " km",
        href: `/run.html?id=${best.id}`
      } : { foil: f, value: null };
    }))}
  </div>
</div>

I'm currently riding ${htl.html`<span style="color: ${foilColor(latestRun.foil)}">${latestRun.foil}</span>`},
last taken out ${fmt.relativeTime(latestRun.ts)}.

## Usage Over Time

```js
const foilOutings = d3.rollups(runCsv,
  rows => ({ total: rows.length,
             foilCounts: d3.rollup(rows, v => ({ count: v.length }), d => d.foil) }),
  d => d.month
).flatMap(([ts, { total, foilCounts }]) =>
  Array.from(foilCounts, ([foil, { count }]) => ({ ts, foil, count, total }))
);
```

<div class="card">${
  resize((width) => Plot.plot({
                      title: "Sessions by Month",
                      color: { domain: foils, range: foils.map(f => foilColor(f)), legend: true },
                      width, x: { interval: Plot.utcInterval("month"), label: "" },
                      marks: [
                        Plot.barY(foilOutings,{x:"ts",y:"count", fill: "foil",
                                           title: d => `${fmt.mmYYYY(d.ts)}\n${d.foil}\n${d.count} ` + (d.count == d.total ? `runs` : `of ${d.total} runs`)})
                      ]
                    })
                    )
}</div>

## By Foil

<div class="card">${
Inputs.table(
  foils.map(f => {
    const s = foilStats.get(f);
    return {
      foil: f,
      sessions: s.sessions,
      time: s.time,
      dist: s.dist,
      paddle_ups: s.paddle_ups,
      avg_speed: s.avg_speed,
      max_speed: { v: s.max_speed?.max_speed_kmh, id: s.max_speed?.id },
      max_speed_1k: { v: s.max_speed_1k?.max_speed_1k, id: s.max_speed_1k?.id },
      longest_seg: { v: s.longest_seg?.longest_segment_distance, id: s.longest_seg?.id },
      max_dist: { v: s.max_dist?.max_distance, id: s.max_dist?.id },
      pct_dist_on_foil: s.pct_dist_on_foil,
      first: s.first,
      last: s.last
    };
  }).sort((a, b) => d3.descending(a.sessions, b.sessions)),
  {
    columns: [
      "foil", "sessions", "time", "dist", "paddle_ups", "avg_speed",
      "max_speed", "max_speed_1k", "longest_seg", "max_dist",
      "pct_dist_on_foil", "first", "last"
    ],
    header: {
      foil: "Foil",
      sessions: "Sessions",
      time: "Total Time",
      dist: "Distance (km)",
      paddle_ups: "Paddle Ups",
      avg_speed: "Avg Speed",
      max_speed: "Max Speed",
      max_speed_1k: "Best 1k Pace",
      longest_seg: "Longest Segment",
      max_dist: "Furthest Land",
      pct_dist_on_foil: "Avg % on Foil",
      first: "First Used",
      last: "Last Used"
    },
    format: {
      foil: d => htl.html`<span style="color: ${foilColor(d)}">${d}</span>`,
      time: fmt.seconds,
      dist: d => d.toFixed(2),
      avg_speed: d => d ? `${d.toFixed(2)} kph` : "?",
      max_speed: d => d.v != null ? htl.html`<a href="/run.html?id=${d.id}">${d.v.toFixed(2)} kph</a>` : "?",
      max_speed_1k: d => d.v != null ? htl.html`<a href="/run.html?id=${d.id}">${fmt.pace(d.v)}</a>` : "?",
      longest_seg: d => d.v != null ? htl.html`<a href="/run.html?id=${d.id}">${(d.v / 1000).toFixed(2)} km</a>` : "?",
      max_dist: d => d.v != null ? htl.html`<a href="/run.html?id=${d.id}">${(d.v / 1000).toFixed(2)} km</a>` : "?",
      pct_dist_on_foil: d => d ? `${(d * 100).toFixed(0)}%` : "?",
      first: fmt.date,
      last: fmt.date
    }
  }
)
}</div>
