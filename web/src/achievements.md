---
theme: dashboard
title: achievements
toc: false
---

<style>
  .ach-list { display: flex; flex-direction: column; gap: 0.6rem; max-width: 760px; }
  a.ach-run { display: block; color: inherit; text-decoration: none; padding: 0.6rem 0.8rem; }
  a.ach-run:hover { border-color: var(--theme-foreground-focus); }
  .ach-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.6rem; }
  .ach-date { font-weight: 600; font-variant-numeric: tabular-nums; }
  .ach-route { font-weight: 600; }
  .ach-sub { font-size: 0.8rem; color: var(--theme-foreground-muted); }
  .ach-badges { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.45rem; }
  .ach-badge { display: inline-flex; flex-wrap: wrap; align-items: baseline; column-gap: 0.35rem; font-size: 0.8rem; padding: 0.15rem 0.5rem;
    border-radius: 0.8rem; border: 1px solid var(--badge); background: color-mix(in srgb, var(--badge) 14%, transparent); }
  .ach-badge.matched { border-style: dashed; background: none; }
  .ach-badge b, .ach-prev { white-space: nowrap; }
  .ach-badge b { font-variant-numeric: tabular-nums; }
  .ach-prev { color: var(--theme-foreground-muted); font-size: 0.72rem; font-variant-numeric: tabular-nums; }
  .ach-year { margin: 1.2rem 0 0.2rem; font-size: 0.9rem; color: var(--theme-foreground-muted); font-weight: 600; }
  .ach-filter { margin-bottom: 0.8rem; }
</style>

# Achievements

Every run that beat or matched the previous best in at least one category, newest first.

```js
import * as d3 from "npm:d3";
import * as fmt from "./components/formatters.js";
import {fetchMeta} from "./components/data.js";
import {beachColorScale} from "./components/beaches.js";

const allRuns = await fetchMeta(() => FileAttachment("data/runs.csv"));
const beachColor = beachColorScale(allRuns);
```

```js
const km = m => `${(m / 1000).toFixed(2)} km`;
const kph = v => `${v.toFixed(1)} kph`;
const bpm = v => `${Math.round(v)} bpm`;

// Each category: how to read it off a run, how to show it, and a score
// (higher wins) at the precision shown, so a record has to beat the old
// one by enough to see, and a tie counts as matching it.
const categories = [
  {key: "seg_dist", label: "Longest foil (distance)", color: "#4269d0",
   value: d => d.longest_segment_distance, score: v => Math.round(v / 10), fmt: km},
  {key: "seg_time", label: "Longest foil (time)", color: "#6cc5b0",
   value: d => (d.longest_segment_end - d.longest_segment_start) / 1000, score: v => Math.round(v), fmt: fmt.seconds},
  {key: "avg_hr", label: "Lowest avg foiling HR", color: "#ff725c",
   value: d => d.avg_foiling_hr, score: v => -Math.round(v), fmt: bpm},
  {key: "min_hr", label: "Lowest min foiling HR", color: "#ff8ab7",
   value: d => d.min_foiling_hr, score: v => -Math.round(v), fmt: bpm},
  {key: "max_speed", label: "Top speed", color: "#efb118",
   value: d => d.max_speed_kmh, score: v => Math.round(v * 10), fmt: kph},
  {key: "best_1k", label: "Best 1 km", color: "#a463f2",
   value: d => d.max_speed_1k, score: v => -Math.floor(3600 / v + 1e-9), fmt: fmt.pace},
  {key: "avg_speed", label: "Best avg speed", color: "#97bbf5",
   value: d => d.avg_speed_kmh, score: v => Math.round(v * 10), fmt: kph},
  // Tracked per region: open-ocean runs would otherwise swamp the rest.
  {key: "max_dist", label: "Furthest from land", color: "#9c6b4e", group: d => d.region,
   value: d => d.max_distance, score: v => Math.round(v / 10), fmt: km},
];

// Walk runs in time order, tracking the best so far in each category.
const achievements = (() => {
  const best = new Map();
  const out = [];
  for (const run of d3.sort(allRuns.filter(d => d.has_track), d => d.ts)) {
    const records = [];
    for (const c of categories) {
      const v = c.value(run);
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      const group = c.group?.(run);
      const k = group == null ? c.key : `${c.key}:${group}`;
      const prev = best.get(k);
      const delta = prev == null ? 1 : c.score(v) - c.score(prev);
      if (delta > 0) best.set(k, v);
      if (delta >= 0) records.push({category: c, group, value: v, prev, matched: delta === 0});
    }
    if (records.length) out.push({run, records});
  }
  return out.reverse();
})();
```

```js
const route = d => htl.html`<span style=${`color: ${beachColor(d.start_beach)}`}>${d.start_beach}</span>${
  d.end_beach !== d.start_beach ? htl.html` → <span style=${`color: ${beachColor(d.end_beach)}`}>${d.end_beach}</span>` : ""}`;

const badge = ({category: c, group, value, prev, matched}) => htl.html`<span class=${`ach-badge${matched ? " matched" : ""}`} style=${`--badge: ${c.color}`}>
  ${c.label}${group ? ` (${group})` : ""} <b>${c.fmt(value)}</b>${prev != null ? htl.html`<span class="ach-prev">${matched ? "matched" : `was ${c.fmt(prev)}`}</span>` : ""}</span>`;

const card = ({run, records}) => htl.html`<a class="card ach-run" href=${`/run.html?id=${run.id}`}>
  <div class="ach-head">
    <span class="ach-date">${d3.timeFormat("%b %-d")(run.ts)}</span>
    <span class="ach-route">${route(run)}</span>
    <span class="ach-sub">${run.distance_km.toFixed(1)} km · ${run.foil}</span>
  </div>
  <div class="ach-badges">${records.map(badge)}</div>
</a>`;

const byYear = d3.groups(achievements, d => d.run.ts.getFullYear());
display(htl.html`<div class="ach-list">${byYear.map(([year, rows]) => htl.html`
  <div class="ach-year">${year} · ${rows.length} runs</div>
  ${rows.map(card)}`)}</div>`);
```
