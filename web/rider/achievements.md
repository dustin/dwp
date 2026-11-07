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
  .ach-summary .row.sub { padding: 0.05rem 0; font-size: 0.8rem; }
  .ach-summary .row.sub .name { padding-left: 0.8rem; }
  .ach-summary .row.l2 .name { padding-left: 1.6rem; }
  .ach-summary .row.sub .ach-swatch { display: inline-block; margin-right: 0.4rem; }
  .ach-summary .group { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--theme-foreground-muted); margin: 0.7rem 0 0.1rem; }
  .ach-summary .group:first-child { margin-top: 0.1rem; }
  .ach-summary .row.quiet { color: var(--theme-foreground-muted); }
  .ach-swatch { width: 0.6rem; height: 0.6rem; border-radius: 50%; align-self: center; }
  a.ach-run { scroll-margin-top: 1rem; }
  a.ach-run:target { border-color: var(--theme-foreground-focus); box-shadow: 0 0 0 2px var(--theme-foreground-focus); }
</style>

# Achievements

Every run that beat or matched the previous best in at least one category, or marked a first or an anniversary, newest first.

```js
import * as d3 from "npm:d3";
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile} from "./components/data.js";
import {beachColorScale} from "./components/beaches.js";
import {regionList, regionColorOf} from "./components/regions.js";
import {categories, computeAchievements} from "./components/achievements.js";

const allRuns = await fetchMeta(() => riderFile('runs.csv'));
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

// How long a record stood, in rough human units.
const heldFor = (from, to) => {
  const days = Math.round((to - from) / 864e5);
  return days < 1 ? "under a day" : days < 60 ? `${days} day${days === 1 ? "" : "s"}`
    : days < 730 ? `${Math.round(days / 30.4)} months` : `${(days / 365.25).toFixed(1)} years`;
};
const recordRef = r => `${r.category.fmt(r.value)} on ${shortDate(r.run.ts)} (${r.run.start_beach}${
  r.run.end_beach !== r.run.start_beach ? ` → ${r.run.end_beach}` : ""})`;

// Hover text: what this record replaced and how long that stood, and what
// happened to this one after.
const badgeTitle = (r, current) => {
  if (r.category.event) return r.note;
  const lines = [];
  const p = r.prevRecord;
  if (p) lines.push(r.matched
    ? `Matched ${recordRef(p)}, the record for ${heldFor(p.run.ts, r.run.ts)} by then`
    : `Beat ${recordRef(p)}, which stood ${heldFor(p.run.ts, r.run.ts)}`);
  else lines.push("First in this category");
  const now = new Date();
  if (r.matched) {
    if (!current) lines.push(`Beaten by ${recordRef(p.beatenBy)}`);
  } else if (r.beatenBy) {
    lines.push(`Stood ${heldFor(r.run.ts, r.beatenBy.run.ts)}, until ${recordRef(r.beatenBy)}`);
  } else {
    lines.push(`Still the record, ${heldFor(r.run.ts, now)} so far`);
  }
  return lines.join("\n");
};

const badge = r => {
  const {category: c, group, value, prev, matched} = r;
  const current = !c.event && holds(r);
  return htl.html`<span class=${`ach-badge${matched ? " matched" : ""}`} style=${`--badge: ${c.color}`}
    title=${badgeTitle(r, current)}>
  ${current ? htl.html`<span class="ach-star">★</span>` : ""}${c.label}${group ? ` (${group})` : ""} ${c.event && !c.fmt(value) ? "" : htl.html`<b>${c.fmt(value)}</b>`}${prev != null && !c.event ? htl.html`<span class="ach-prev">${matched ? "matched" : `was ${c.fmt(prev)}`}</span>` : ""}</span>`;
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
const shortDate = d3.timeFormat("%b %-d, %Y");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const regionOrder = new Map(regionList(allRuns).map((r, i) => [r, i]));

// One summary line. Sub-lines (level 1 and 2) are indented and carry their
// swatch next to the name. Always one <a> (no href when quiet): htl wraps
// multi-node fragments in a <span>, which would break the row's grid.
const line = ({level = 0, color, name, value = "", note = "", moved = true, href = null}) => {
  const swatch = color ? htl.html`<span class="ach-swatch" style=${`background: ${color}`}></span>` : "";
  return htl.html`<a class=${`row${level ? ` sub l${level}` : ""}${moved ? "" : " quiet"}`} href=${moved ? href : null}>
    ${level ? htl.html`<span></span>` : swatch || htl.html`<span></span>`}
    <span class="name">${level ? swatch : ""}${name}</span>
    <b>${value}</b>
    <span class="ach-sub">${note}</span>
  </a>`;
};

// A best: its value and when, or (yearly) what it moved from.
const recordLine = (r, ctx, opts = {}) => {
  const before = ctx.since?.get(`${r.category.key}:${r.group ?? ""}`);
  const moved = !ctx.since || r.run.ts >= ctx.sinceTs;
  return line({color: r.category.color, name: r.category.label, value: r.category.fmt(r.value),
    note: !ctx.since ? shortDate(r.run.ts) : !moved ? "no change" : before ? `from ${r.category.fmt(before.value)}` : "new",
    moved, href: `#run-${r.run.id}`, ...opts});
};
const of = (best, key) => [...best.values()].filter(r => r.category.key === key);
const rec = key => ctx => {
  const r = ctx.best.get(`${key}:`);
  return r ? recordLine(r, ctx) : "";
};

// Furthest from land: the furthest anywhere, then each region's.
const furthestRows = ctx => {
  const rs = d3.sort(of(ctx.best, "max_dist"), r => regionOrder.get(r.group) ?? 99);
  if (!rs.length) return "";
  const top = d3.greatest(rs, r => r.value);
  const was = ctx.since && d3.max(of(ctx.since, "max_dist"), r => r.value);
  const moved = !ctx.since || top.run.ts >= ctx.sinceTs;
  return [
    line({color: top.category.color, name: top.category.label, value: top.category.fmt(top.value),
      note: !ctx.since ? shortDate(top.run.ts) : !moved ? "no change" : was ? `from ${top.category.fmt(was)}` : "new",
      moved, href: `#run-${top.run.id}`}),
    ...rs.map(r => recordLine(r, ctx, {level: 1, color: regionColorOf(r.group), name: r.group})),
  ];
};

// First dry runs: the very first, then one in each region (with dry runs
// so far there) and on each foil.
const firstDryRows = ctx => {
  const foils = d3.sort(of(ctx.best, "foil_dry"), r => r.run.ts);
  if (!foils.length) return "";
  const regions = d3.sort(of(ctx.best, "region_dry"), r => regionOrder.get(r.group) ?? 99);
  const runs = ctx.untilTs ? allRuns.filter(d => d.ts <= ctx.untilTs) : allRuns;
  const dry = d3.rollup(runs.filter(d => d.dry), v => v.length, d => d.region);
  const isNew = r => !ctx.since || r.run.ts >= ctx.sinceTs;
  const first = foils[0];
  const subset = (label, rs, unit) => {
    const added = rs.filter(isNew);
    return line({level: 1, name: label, value: plural(rs.length, unit), moved: added.length > 0,
      note: !ctx.since ? shortDate(d3.greatest(rs, r => r.run.ts).run.ts) : added.length ? `${added.length} new` : "no change"});
  };
  const firstLine = r => ({moved: isNew(r), href: `#run-${r.run.id}`, note: shortDate(r.run.ts)});
  return [
    line({color: first.category.color, name: "First dry run", moved: isNew(first), href: `#run-${first.run.id}`,
      note: shortDate(first.run.ts)}),
    subset("By region", regions, "region"),
    ...regions.map(r => line({level: 2, color: regionColorOf(r.group), name: r.group,
      value: `${dry.get(r.group) ?? 0} dry`, ...firstLine(r)})),
    subset("By foil", foils, "foil"),
    ...foils.map(r => line({level: 2, name: r.group, ...firstLine(r)})),
  ];
};

// New routes don't get a line each; this counts them instead, linking to
// the newest.
const routesRow = ctx => {
  const all = of(ctx.best, "route");
  if (!all.length) return "";
  const latest = d3.greatest(all, r => r.run.ts);
  const added = ctx.since ? all.length - of(ctx.since, "route").length : null;
  const moved = !ctx.since || added > 0;
  return line({color: latest.category.color, name: "Distinct routes", value: all.length, moved,
    href: `#run-${latest.run.id}`, note: !ctx.since ? shortDate(latest.run.ts) : moved ? `${added} new` : "no change"});
};

// What the summary shows, in order. A best category not listed here lands
// under "Other" so a new one is never lost.
const GROUPS = [
  ["Foiling", ["seg_dist", "seg_time", "foil_dist"]],
  ["Speed", ["max_speed", "best_1k", "foil_speed"]],
  ["Heart rate", ["avg_hr", "min_hr"]],
  ["Conditions", ["light_wind", furthestRows]],
  ["Dry runs", ["dry", "dry_streak", "dry_month", firstDryRows]],
  ["Streaks and totals", ["streak", "odometer", "hours", routesRow]],
];
const listed = new Set(GROUPS.flatMap(([, items]) => items.filter(i => typeof i === "string")).concat(["max_dist"]));
const OTHER = categories.filter(c => !c.event && !listed.has(c.key)).map(c => c.key);
const groups = OTHER.length ? [...GROUPS, ["Other", OTHER]] : GROUPS;

// The bests, grouped, each with when it was set (linking to that run's
// card). `since` marks lines that didn't move since then as quiet and shows
// the earlier value, for the yearly summaries; `untilTs` ends their span.
const summary = (best, since, sinceTs, untilTs) => {
  const ctx = {best, since, sinceTs, untilTs};
  return htl.html`<div class="card ach-summary">${groups.flatMap(([title, items]) => {
    const rows = items.flatMap(i => (typeof i === "string" ? rec(i) : i)(ctx)).filter(r => r);
    return rows.length ? [htl.html`<div class="group">${title}</div>`, ...rows] : [];
  })}</div>`;
};

// Where each best stood at the end of the year, against the start of it.
const yearSummary = year => {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1, 0, 0, -1);
  return summary(bestAsOf(end), bestAsOf(new Date(start - 1)), start, end);
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
