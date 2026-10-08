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
  .ach-star { color: var(--badge); }
  .ach-badge.matched { border-style: dashed; background: none; }
  .ach-badge b, .ach-prev { white-space: nowrap; }
  .ach-badge b { font-variant-numeric: tabular-nums; }
  .ach-prev { color: var(--theme-foreground-muted); font-size: 0.72rem; font-variant-numeric: tabular-nums; }
  .ach-year { margin: 1.6rem 0 0.2rem; scroll-margin-top: 1rem; }
  #current { scroll-margin-top: 1rem; }
  .ach-count { font-size: 0.9rem; font-weight: normal; color: var(--theme-foreground-muted); }
  .ach-nav { margin-bottom: 0.5rem; font-variant-numeric: tabular-nums; }
  .ach-summary { max-width: 760px; box-sizing: border-box; padding: 0.5rem 0.8rem; font-size: 0.85rem; }
  .ach-summary .row { display: grid; grid-template-columns: 0.6rem 1fr auto 5.5rem; align-items: baseline; gap: 0.6rem; padding: 0.15rem 0; color: inherit; text-decoration: none; }
  .ach-summary a.row[href]:hover .name { text-decoration: underline; }
  .ach-summary .name { min-width: 0; }
  .ach-summary b { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ach-summary .ach-sub { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ach-summary .row.quiet { color: var(--theme-foreground-muted); }
  .ach-swatch { width: 0.6rem; height: 0.6rem; border-radius: 50%; align-self: center; }
  a.ach-run { scroll-margin-top: 1rem; }
  a.ach-run:target { border-color: var(--theme-foreground-focus); box-shadow: 0 0 0 2px var(--theme-foreground-focus); }
</style>

# Achievements

Every run that beat or matched the previous best in at least one category, newest first.

```js
import * as d3 from "npm:d3";
import * as fmt from "./components/formatters.js";
import {fetchMeta} from "./components/data.js";
import {beachColorScale} from "./components/beaches.js";
import {categories, computeAchievements} from "./components/achievements.js";

const allRuns = await fetchMeta(() => FileAttachment("data/runs.csv"));
const beachColor = beachColorScale(allRuns);
```

```js
const achievements = computeAchievements(allRuns);
```

```js
const route = d => htl.html`<span style=${`color: ${beachColor(d.start_beach)}`}>${d.start_beach}</span>${
  d.end_beach !== d.start_beach ? htl.html` → <span style=${`color: ${beachColor(d.end_beach)}`}>${d.end_beach}</span>` : ""}`;

// A record still holds if nothing has beaten it since (a tie still holds).
const holds = ({category: c, group, value}) =>
  c.score(value) === c.score(snapshots.at(-1).best.get(`${c.key}:${group ?? ""}`).value);

const badge = r => {
  const {category: c, group, value, prev, matched} = r;
  const current = holds(r);
  return htl.html`<span class=${`ach-badge${matched ? " matched" : ""}`} style=${`--badge: ${c.color}`}
    title=${current ? "Still the record" : "Since beaten"}>
  ${current ? htl.html`<span class="ach-star">★</span>` : ""}${c.label}${group ? ` (${group})` : ""} <b>${c.fmt(value)}</b>${prev != null ? htl.html`<span class="ach-prev">${matched ? "matched" : `was ${c.fmt(prev)}`}</span>` : ""}</span>`;
};

const card = ({run, records}) => htl.html`<a class="card ach-run" id=${`run-${run.id}`} href=${`/run.html?id=${run.id}`}>
  <div class="ach-head">
    <span class="ach-date">${shortDate(run.ts)}</span>
    <span class="ach-route">${route(run)}</span>
    <span class="ach-sub">${run.distance_km.toFixed(1)} km · ${run.foil}</span>
  </div>
  <div class="ach-badges">${records.map(badge)}</div>
</a>`;

// Bests as they stood after each run, walking oldest first. A tie doesn't
// take the record; the run that first reached the value keeps it.
const snapshots = (() => {
  const best = new Map();
  const out = [];
  for (const {run, records} of [...achievements].reverse()) {
    for (const r of records)
      if (!r.matched) best.set(`${r.category.key}:${r.group ?? ""}`, {...r, run});
    out.push({ts: run.ts, best: new Map(best)});
  }
  return out;
})();
const bestAsOf = ts => [...snapshots].reverse().find(s => s.ts <= ts)?.best ?? new Map();
const ordered = best => categories.flatMap(c => d3.sort([...best.values()].filter(r => r.category === c), r => r.group));
const shortDate = d3.timeFormat("%b %-d, %Y");

// One line per category: the best, and when (linking to that run's card).
// `since` marks lines that didn't move since then as quiet and shows the
// earlier value, for the yearly summaries.
const summary = (best, since, sinceTs) => htl.html`<div class="card ach-summary">${ordered(best).map(r => {
  const before = since?.get(`${r.category.key}:${r.group ?? ""}`);
  const moved = !since || r.run.ts >= sinceTs;
  // One <a> either way (no href when quiet): htl wraps multi-node fragments
  // in a <span>, which would break the row's grid.
  return htl.html`<a class=${`row${moved ? "" : " quiet"}`} href=${moved ? `#run-${r.run.id}` : null}>
    <span class="ach-swatch" style=${`background: ${r.category.color}`}></span>
    <span class="name">${r.category.label}${r.group ? ` (${r.group})` : ""}</span>
    <b>${r.category.fmt(r.value)}</b>
    <span class="ach-sub">${!since ? shortDate(r.run.ts) : !moved ? "no change" : before ? `from ${r.category.fmt(before.value)}` : "new"}</span>
  </a>`;
})}</div>`;

// Where each best stood at the end of the year, against the start of it.
const yearSummary = year => {
  const start = new Date(year, 0, 1);
  return summary(bestAsOf(new Date(year + 1, 0, 1, 0, 0, -1)), bestAsOf(new Date(start - 1)), start);
};

const runsPerYear = d3.rollup(allRuns, v => v.length, d => d.ts.getFullYear());
const byYear = d3.groups(achievements, d => d.run.ts.getFullYear());
display(htl.html`<nav class="ach-nav"><a href="#current">Current</a>${byYear.map(([year]) => htl.html` · <a href=${`#y${year}`}>${year}</a>`)}</nav>`);
display(htl.html`<h2 id="current">Current</h2>`);
display(summary(bestAsOf(new Date())));
display(htl.html`<div class="ach-list">${byYear.map(([year, rows]) => htl.html`
  <h2 class="ach-year" id=${`y${year}`}>${year} <span class="ach-count">${rows.length} of ${runsPerYear.get(year)} runs set or matched a record</span></h2>
  ${yearSummary(year)}
  ${rows.map(card)}`)}</div>`);
```
