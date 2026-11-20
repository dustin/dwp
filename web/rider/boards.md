---
theme: dashboard
title: downwind boards
toc: true
---

# Boards

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile} from "./components/data.js";
import {foilColorScale, boardList, boardColorScale} from "./components/foils.js";

const runCsv = await fetchMeta(() => riderFile('runs.csv'));
const latestRun = runCsv[runCsv.findIndex(d => d.ts === d3.max(runCsv, d => d.ts))];

const boards = boardList(runCsv);
const boardColor = boardColorScale(runCsv);
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

totals.foil_time = d3.sum(runCsv, d => d.duration_on_foil);
totals.foil_dist = d3.sum(runCsv, d => d.distance_on_foil) / 1000;
totals.foil_speed = d3.mean(runCsv, foilSpeed);
totals.best_foil_speed = bestBy(runCsv, foilSpeed);

totals.max_speed_id = runCsv.find(d => d.max_speed_kmh === totals.max_speed).id;
totals.max_speed_1k_id = runCsv.find(d => d.max_speed_1k === totals.max_speed_1k).id;
totals.longest_seg_id = runCsv.find(d => d.longest_segment_distance === totals.longest_seg).id;
totals.max_dist_id = runCsv.find(d => d.max_distance === totals.max_dist).id;
```

```js
function bestOf(rows, field) {
  return rows.reduce((best, d) => (d[field] > (best?.[field] ?? -Infinity) ? d : best), null);
}

// Average speed while up on foil, kph (achievements.js foil_speed).
const foilSpeed = d => d.duration_on_foil > 0 ? 3.6 * d.distance_on_foil / d.duration_on_foil : undefined;

function bestBy(rows, f) {
  return rows.reduce((best, d) => (f(d) > (best ? f(best) : -Infinity) ? d : best), null);
}

const boardStats = new Map(boards.map(f => {
  const rows = runCsv.filter(d => d.board === f);
  return [f, {
    sessions: rows.length,
    time: d3.sum(rows, d => d.duration_sec),
    dist: d3.sum(rows, d => d.distance_km),
    paddle_ups: d3.sum(rows, d => d.paddle_up_count),
    avg_speed: d3.mean(rows, d => d.avg_speed_kmh),
    pct_dist_on_foil: d3.mean(rows, d => d.pct_dist_on_foil),
    foil_time: d3.sum(rows, d => d.duration_on_foil),
    foil_dist: d3.sum(rows, d => d.distance_on_foil) / 1000,
    foil_speed: d3.mean(rows, foilSpeed),
    best_foil_speed: bestBy(rows, foilSpeed),
    max_speed: bestOf(rows, "max_speed_kmh"),
    max_speed_1k: bestOf(rows, "max_speed_1k"),
    longest_seg: bestOf(rows, "longest_segment_distance"),
    max_dist: bestOf(rows, "max_distance"),
    first: d3.min(rows, d => d.ts),
    last: d3.max(rows, d => d.ts)
  }];
}));

function boardBreakdown(items) {
  const sorted = items
    .filter(d => d.value != null)
    .sort((a, b) => d3.descending(a.value, b.value));
  return htl.html`<div class="board-breakdown">${sorted.map(d => htl.html`
    <div class="board-row">
      <span class="board-swatch" style=${`background:${boardColor(d.board)}`}></span>
      <span class="board-name">${d.board}</span>
      <span class="board-value">${d.href ? htl.html`<a href=${d.href}>${d.text}</a>` : d.text}</span>
    </div>`)}</div>`;
}
```

<style>
  .board-breakdown {
    margin-top: 0.6rem;
    padding-top: 0.4rem;
    border-top: solid 1px var(--theme-foreground-faintest);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.7rem;
  }
  .board-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--theme-foreground-muted);
  }
  .board-swatch {
    display: inline-block;
    width: 0.6rem;
    height: 0.6rem;
    min-width: 0.6rem;
    border-radius: 50%;
  }
  .board-name {
    flex: 1 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .board-value {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .board-value a {
    color: inherit;
  }
</style>

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Sessions</h2>
    <span class="big">${fmt.comma(totals.sessions)}</span>
    ${boardBreakdown(boards.map(f => ({
      board: f, value: boardStats.get(f).sessions, text: fmt.comma(boardStats.get(f).sessions)
    })))}
  </div>
  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">${fmt.comma(totals.paddle_ups)}</span>
    ${boardBreakdown(boards.map(f => ({
      board: f, value: boardStats.get(f).paddle_ups, text: fmt.comma(boardStats.get(f).paddle_ups)
    })))}
  </div>
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">${fmt.seconds(totals.time)}</span>
    ${boardBreakdown(boards.map(f => ({
      board: f, value: boardStats.get(f).time, text: fmt.seconds(boardStats.get(f).time)
    })))}
  </div>
  <div class="card">
    <h2>Time on Foil</h2>
    <span class="big">${fmt.seconds(totals.foil_time)}</span>
    ${boardBreakdown(boards.map(f => ({
      board: f, value: boardStats.get(f).foil_time, text: fmt.seconds(boardStats.get(f).foil_time)
    })))}
  </div>
  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">${fmt.comma(totals.dist.toFixed(2))} km</span>
    ${boardBreakdown(boards.map(f => ({
      board: f, value: boardStats.get(f).dist, text: fmt.comma(boardStats.get(f).dist.toFixed(2)) + " km"
    })))}
  </div>
  <div class="card">
    <h2>Distance on Foil</h2>
    <span class="big">${fmt.comma(totals.foil_dist.toFixed(2))} km</span>
    ${boardBreakdown(boards.map(f => ({
      board: f, value: boardStats.get(f).foil_dist, text: fmt.comma(boardStats.get(f).foil_dist.toFixed(2)) + " km"
    })))}
  </div>
  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.longest_seg_id}">
        ${(totals.longest_seg / 1000).toFixed(2)} km</a>`}</span>
    ${boardBreakdown(boards.map(f => {
      const best = boardStats.get(f).longest_seg;
      return best ? {
        board: f, value: best.longest_segment_distance,
        text: (best.longest_segment_distance / 1000).toFixed(2) + " km",
        href: `/run.html?id=${best.id}`
      } : { board: f, value: null };
    }))}
  </div>
  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_dist_id}">
        ${(totals.max_dist / 1000).toFixed(2)} km</a>`}</span>
    ${boardBreakdown(boards.map(f => {
      const best = boardStats.get(f).max_dist;
      return best ? {
        board: f, value: best.max_distance,
        text: (best.max_distance / 1000).toFixed(2) + " km",
        href: `/run.html?id=${best.id}`
      } : { board: f, value: null };
    }))}
  </div>
  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_speed_id}">
        ${totals.max_speed.toFixed(2)} kph</a>`}</span>
    ${boardBreakdown(boards.map(f => {
      const best = boardStats.get(f).max_speed;
      return best ? {
        board: f, value: best.max_speed_kmh,
        text: `${best.max_speed_kmh.toFixed(2)} kph`,
        href: `/run.html?id=${best.id}`
      } : { board: f, value: null };
    }))}
  </div>
  <div class="card">
    <h2>Avg Foiling Speed</h2>
    <span class="big">${totals.foil_speed.toFixed(2)} kph</span>
    ${boardBreakdown(boards.map(f => {
      const v = boardStats.get(f).foil_speed;
      return { board: f, value: v, text: v != null ? `${v.toFixed(2)} kph` : "" };
    }))}
  </div>
  <div class="card">
    <h2>Best Avg Foiling Speed</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.best_foil_speed.id}">
        ${foilSpeed(totals.best_foil_speed).toFixed(2)} kph</a>`}</span>
    ${boardBreakdown(boards.map(f => {
      const best = boardStats.get(f).best_foil_speed;
      return best ? {
        board: f, value: foilSpeed(best),
        text: `${foilSpeed(best).toFixed(2)} kph`,
        href: `/run.html?id=${best.id}`
      } : { board: f, value: null };
    }))}
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${htl.html`<a href="/run.html?id=${totals.max_speed_1k_id}">
        ${fmt.pace(totals.max_speed_1k)}</a>`}</span>
    ${boardBreakdown(boards.map(f => {
      const best = boardStats.get(f).max_speed_1k;
      return best ? {
        board: f, value: best.max_speed_1k,
        text: fmt.pace(best.max_speed_1k),
        href: `/run.html?id=${best.id}`
      } : { board: f, value: null };
    }))}
  </div>
</div>

I'm currently riding ${htl.html`<span style="color: ${boardColor(latestRun.board)}">${latestRun.board}</span>`},
last taken out ${fmt.relativeTime(latestRun.ts)}.

## Usage Over Time

```js
const boardOutings = d3.rollups(runCsv,
  rows => ({ total: rows.length,
             boardCounts: d3.rollup(rows, v => ({ count: v.length }), d => d.board) }),
  d => d.month
).flatMap(([ts, { total, boardCounts }]) =>
  Array.from(boardCounts, ([board, { count }]) => ({ ts, board, count, total }))
);
```

<div class="card">${
  resize((width) => Plot.plot({
                      title: "Sessions by Month",
                      color: { domain: boards, range: boards.map(f => boardColor(f)), legend: true },
                      width, x: { interval: Plot.utcInterval("month"), label: "" },
                      marks: [
                        Plot.barY(boardOutings,{x:"ts",y:"count", fill: "board",
                                           title: d => `${fmt.mmYYYY(d.ts)}\n${d.board}\n${d.count} ` + (d.count == d.total ? `runs` : `of ${d.total} runs`)})
                      ]
                    })
                    )
}</div>

```js
const boardMiles = boards.flatMap(b => {
  let km = 0;
  return runCsv.filter(d => d.board === b).sort((x, y) => d3.ascending(x.ts, y.ts))
    .map(d => ({ ts: d.ts, board: b, km: (km += d.distance_km) }));
});
const boardFoils = d3.rollups(runCsv.filter(d => d.board),
  v => d3.sum(v, d => d.distance_km), d => d.board, d => d.foil || "unknown"
).flatMap(([board, fs]) => fs.map(([foil, km]) => ({ board, foil, km })));
```

<div class="grid grid-cols-2">
<div class="card">${
  resize((width) => Plot.plot({
    title: "Mileage by Board",
    width, color: { domain: boards, range: boards.map(f => boardColor(f)), legend: true },
    x: { label: "" }, y: { label: "km", grid: true },
    marks: [
      Plot.lineY(boardMiles, { x: "ts", y: "km", stroke: "board", curve: "step-after" }),
      Plot.tip(boardMiles, Plot.pointerX({ x: "ts", y: "km", z: "board",
        title: d => `${d.board}\n${fmt.date(d.ts)}\n${fmt.comma(d.km.toFixed(0))} km` }))
    ]
  }))
}</div>
<div class="card">${
  resize((width) => Plot.plot({
    title: "Foils Ridden on Each Board (km)",
    width, marginLeft: 160, color: { domain: foilColor.domain(), range: foilColor.range(), unknown: "#999", legend: true },
    x: { label: "km", grid: true }, y: { label: "", domain: boards },
    marks: [
      Plot.barX(boardFoils, { y: "board", x: "km", fill: "foil", sort: { fill: "-x" },
        title: d => `${d.board}\n${d.foil}\n${fmt.comma(d.km.toFixed(0))} km` })
    ]
  }))
}</div>
</div>

## By Board

<div class="card">${
Inputs.table(
  boards.map(f => {
    const s = boardStats.get(f);
    return {
      board: f,
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
      "board", "sessions", "time", "dist", "paddle_ups", "avg_speed",
      "max_speed", "max_speed_1k", "longest_seg", "max_dist",
      "pct_dist_on_foil", "first", "last"
    ],
    header: {
      board: "Board",
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
      board: d => htl.html`<span style="color: ${boardColor(d)}">${d}</span>`,
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
