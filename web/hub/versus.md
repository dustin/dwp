---
theme: dashboard
title: Rider vs rider
toc: false
---

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, RIDERS} from "./components/data.js";
import {categories, computeAchievements} from "./components/achievements.js";

// ?a=dustin&b=walter picks the two riders; the pickers below rewrite the URL
// in place so the comparison can be shared.
const params = new URLSearchParams(location.search);
const pick = (key, fallback) => RIDERS.includes(params.get(key)) ? params.get(key) : fallback;
const riderName = slug => slug[0].toUpperCase() + slug.slice(1);
```

```js
const pickAInput = Inputs.select(RIDERS, {value: pick("a", RIDERS[0]), format: riderName});
const pickA = Generators.input(pickAInput);
```

```js
const pickBInput = Inputs.select(RIDERS, {value: pick("b", RIDERS[1]), format: riderName});
const pickB = Generators.input(pickBInput);
```

```js
{
  const q = new URLSearchParams(location.search);
  q.set("a", pickA);
  q.set("b", pickB);
  history.replaceState(null, "", `?${q}`);
}
```

```js
const [runsA, runsB] = await Promise.all([pickA, pickB].map(slug =>
  fetchMeta(() => riderFile("runs.csv", null, slug)).catch(() => [])));
```

```js
const now = new Date();
const thisYear = now.getFullYear();
const since90 = d3.timeDay.offset(d3.timeDay(now), -90);
const route = d => d.end_beach && d.end_beach !== d.start_beach ? `${d.start_beach} → ${d.end_beach}` : d.start_beach;

// The rider's standing best in each achievement category (the same ones the
// rider site's achievements page tracks), as {value, run}. Per-region
// categories collapse to the best anywhere; milestones and events are left
// out since they aren't bests.
const recordCategories = categories.filter(c => !c.event && c.key !== "odometer");
function bestRecords(runs) {
  const records = computeAchievements(runs).flatMap(a => a.records).filter(r => !r.matched);
  return new Map(recordCategories.map(c => [c.key,
    d3.greatest(records.filter(r => r.category === c), r => c.score(r.value))]));
}

function averages(runs) {
  const hr = runs.filter(d => d.avg_foiling_hr > 0), minHr = runs.filter(d => d.min_foiling_hr > 0);
  const foiled = runs.filter(d => d.duration_on_foil > 0);
  return {
    speed: d3.mean(runs, d => d.avg_speed_kmh),
    foilSpeed: 3.6 * d3.sum(foiled, d => d.distance_on_foil) / d3.sum(foiled, d => d.duration_on_foil),
    topSpeed: d3.mean(runs, d => d.max_speed_kmh),
    km: d3.mean(runs, d => d.distance_km),
    onFoil: d3.sum(runs, d => d.distance_on_foil) / 1000 / d3.sum(runs, d => d.distance_km),
    segment: d3.mean(runs, d => d.longest_segment_distance),
    paddleUps: d3.mean(runs, d => d.paddle_up_count),
    hr: d3.mean(hr, d => d.avg_foiling_hr), minHr: d3.mean(minHr, d => d.min_foiling_hr),
    wind: d3.mean(runs.filter(d => d.avg_wavg != null), d => d.avg_wavg)
  };
}

function summarize(slug, runs) {
  const year = runs.filter(d => d.ts.getFullYear() === thisYear);
  const recent = runs.filter(d => d.ts >= since90);
  const best = f => d3.greatest(runs.filter(d => d[f] != null && !isNaN(d[f])), d => d[f]);
  const spots = d3.rollups(runs, v => v.length, route).sort((a, b) => d3.descending(a[1], b[1]));
  return {
    slug, name: riderName(slug), runs,
    first: d3.least(runs, d => d.ts), latest: d3.greatest(runs, d => d.ts),
    total: {n: runs.length, km: d3.sum(runs, d => d.distance_km), h: d3.sum(runs, d => d.duration_sec) / 3600,
      paddleUps: d3.sum(runs, d => d.paddle_up_count), avgKm: d3.mean(runs, d => d.distance_km),
      onFoil: d3.sum(runs, d => d.distance_on_foil) / 1000 / d3.sum(runs, d => d.distance_km)},
    year: {n: year.length, km: d3.sum(year, d => d.distance_km), h: d3.sum(year, d => d.duration_sec) / 3600},
    recent: {n: recent.length, km: d3.sum(recent, d => d.distance_km),
      days: new Set(recent.map(d => +d3.timeDay(d.ts))).size},
    longestRun: best("distance_km"),
    records: bestRecords(runs),
    avg: averages(runs),
    spots: spots.slice(0, 5), spotCount: spots.length
  };
}

const A = summarize(pickA, runsA);
const B = summarize(pickB, runsB);
const runHref = (who, d) => `https://${who.slug}.downwind.pro/run.html?id=${d.id}`;
const colorA = "var(--theme-foreground-focus)", colorB = "#e8743b";
```

# ${A.name} vs ${B.name}

<div class="pickers">${pickAInput}<span class="vs">vs</span>${pickBInput}</div>

```js
// One stat, both riders: the values either side of the label, the higher one
// highlighted, and a bar under each scaled to the larger of the two.
function versusRow(label, a, b, format, {lower = false, neutral = false} = {}) {
  const ok = v => v != null && !isNaN(v);
  const win = neutral || !ok(a) || !ok(b) || a === b ? 0 : (lower ? a < b : a > b) ? -1 : 1;
  const max = Math.max(ok(a) ? a : 0, ok(b) ? b : 0) || 1;
  const pct = v => ok(v) ? (lower ? Math.min(...[a, b].filter(ok)) / v : v / max) * 100 : 0;
  const cell = (v, side, w) => htl.html`<div class=${`vs-val vs-${side} ${win === w ? "vs-win" : ""}`}>
    <span>${ok(v) ? format(v) : "–"}</span>
    <span class="vs-bar"><span style=${`width:${pct(v)}%`}></span></span></div>`;
  return htl.html`<div class="vs-row">${cell(a, "a", -1)}<div class="vs-label">${label}</div>${cell(b, "b", 1)}</div>`;
}

// One achievement category, both riders' bests linked to the runs that set them.
function recordRow(c) {
  const ra = A.records.get(c.key), rb = B.records.get(c.key);
  const link = (who, r) => r ? htl.html`<a href=${runHref(who, r.run)}>${c.fmt(r.value)}</a>` : "–";
  // A category's score says which way is better (lower heart rate, say).
  const row = versusRow(c.label, ra?.value, rb?.value, c.fmt, {lower: c.score(1000) < c.score(100)});
  // Swap the plain values for links to the record runs.
  row.querySelector(".vs-a span").replaceWith(link(A, ra));
  row.querySelector(".vs-b span").replaceWith(link(B, rb));
  const sub = r => r ? `${route(r.run)} · ${d3.timeFormat("%b %-d, %Y")(r.run.ts)}` : "";
  return htl.html`<div>${row}<div class="vs-row vs-sub"><div class="vs-a">${sub(ra)}</div><div></div><div class="vs-b">${sub(rb)}</div></div></div>`;
}

const kph = v => `${v.toFixed(1)} kph`;
const bpm = v => `${Math.round(v)} bpm`;
const km = v => `${fmt.comma(Math.round(v))} km`;
const km1 = v => `${v.toFixed(1)} km`;
const hrs = v => `${fmt.comma(Math.round(v))} h`;
const n = v => fmt.comma(v);
```

<div class="grid grid-cols-2">
  <div class="card">
    <h2>All time</h2>
    <div class="vs-head"><span style=${`color:${colorA}`}>${A.name}</span><span></span><span style=${`color:${colorB}`}>${B.name}</span></div>
    ${versusRow("Runs", A.total.n, B.total.n, n)}
    ${versusRow("Distance", A.total.km, B.total.km, km)}
    ${versusRow("Time on water", A.total.h, B.total.h, hrs)}
    ${versusRow("Paddle ups", A.total.paddleUps, B.total.paddleUps, n)}
    ${versusRow("Routes ridden", A.spotCount, B.spotCount, n)}
    <div class="vs-foot">Since ${A.first ? fmt.mmYYYY(A.first.ts) : "–"} · since ${B.first ? fmt.mmYYYY(B.first.ts) : "–"}</div>
  </div>
  <div class="card">
    <h2>${thisYear} and lately</h2>
    <div class="vs-head"><span style=${`color:${colorA}`}>${A.name}</span><span></span><span style=${`color:${colorB}`}>${B.name}</span></div>
    ${versusRow(`Runs in ${thisYear}`, A.year.n, B.year.n, n)}
    ${versusRow(`Distance in ${thisYear}`, A.year.km, B.year.km, km)}
    ${versusRow(`Hours in ${thisYear}`, A.year.h, B.year.h, hrs)}
    ${versusRow("Runs, last 90 days", A.recent.n, B.recent.n, n)}
    ${versusRow("Distance, last 90 days", A.recent.km, B.recent.km, km)}
    ${versusRow("Days on water, last 90", A.recent.days, B.recent.days, n)}
    <div class="vs-foot">Last run ${A.latest ? fmt.relativeTime(A.latest.ts) : "–"} · ${B.latest ? fmt.relativeTime(B.latest.ts) : "–"}</div>
  </div>
</div>

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Average run</h2>
    <div class="vs-head"><span style=${`color:${colorA}`}>${A.name}</span><span></span><span style=${`color:${colorB}`}>${B.name}</span></div>
    ${versusRow("Distance", A.avg.km, B.avg.km, km1)}
    ${versusRow("Speed", A.avg.speed, B.avg.speed, kph)}
    ${versusRow("Foiling speed", A.avg.foilSpeed, B.avg.foilSpeed, kph)}
    ${versusRow("Top speed", A.avg.topSpeed, B.avg.topSpeed, kph)}
    ${versusRow("On foil", A.avg.onFoil, B.avg.onFoil, v => `${(v * 100).toFixed(0)}%`)}
    ${versusRow("Longest foil", A.avg.segment, B.avg.segment, v => `${(v / 1000).toFixed(1)} km`)}
    ${versusRow("Paddle ups", A.avg.paddleUps, B.avg.paddleUps, v => v.toFixed(1), {lower: true})}
    ${versusRow("Foiling HR", A.avg.hr, B.avg.hr, bpm, {lower: true})}
    ${versusRow("Min foiling HR", A.avg.minHr, B.avg.minHr, bpm, {lower: true})}
    ${versusRow("Wind", A.avg.wind, B.avg.wind, v => `${v.toFixed(0)} kn`, {neutral: true})}
  </div>
  <div class="card">
    <h2>Distance by month <span class="nav-age">last 12 months</span></h2>
    ${resize(width => {
      const start = d3.timeMonth.offset(d3.timeMonth(now), -11);
      const rows = [A, B].flatMap(r => d3.timeMonths(start, d3.timeMonth.offset(start, 12)).map(month => ({
        rider: r.name, month,
        km: d3.sum(r.runs.filter(d => +d.month === +month), d => d.distance_km)
      })));
      return Plot.plot({
        width, height: 220, marginLeft: 40, marginBottom: 24,
        fx: {tickFormat: d3.timeFormat("%b"), label: null, padding: 0.15},
        x: {axis: null, domain: [A.name, B.name], padding: 0.05},
        y: {grid: true, label: "km"},
        color: {domain: [A.name, B.name], range: [colorA, colorB], legend: true},
        marks: [
          Plot.barY(rows, {fx: "month", x: "rider", y: "km", fill: "rider", tip: true,
            title: d => `${d.rider} · ${d3.timeFormat("%b %Y")(d.month)}\n${d.km.toFixed(0)} km`}),
          Plot.ruleY([0])
        ]
      });
    })}
  </div>
</div>

<div class="card">
  <h2>Records</h2>
  <div class="vs-head records-head"><span style=${`color:${colorA}`}>${A.name}</span><span></span><span style=${`color:${colorB}`}>${B.name}</span></div>
  <div class="records-cols">
    ${recordCategories.map(recordRow)}
    ${(() => {
      const row = versusRow("Longest run", A.longestRun?.distance_km, B.longestRun?.distance_km, km1);
      const sub = r => r ? `${route(r)} · ${d3.timeFormat("%b %-d, %Y")(r.ts)}` : "";
      return htl.html`<div>${row}<div class="vs-row vs-sub"><div class="vs-a">${sub(A.longestRun)}</div><div></div><div class="vs-b">${sub(B.longestRun)}</div></div></div>`;
    })()}
  </div>
</div>

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Distance this year <span class="nav-age">cumulative</span></h2>
    ${resize(width => {
      const cum = r => {
        let total = 0;
        const rows = r.runs.filter(d => d.ts.getFullYear() === thisYear).sort((a, b) => d3.ascending(a.ts, b.ts))
          .map(d => ({rider: r.name, ts: d.ts, km: total += d.distance_km}));
        return [{rider: r.name, ts: new Date(thisYear, 0, 1), km: 0}, ...rows, ...(rows.length ? [{rider: r.name, ts: now, km: total}] : [])];
      };
      const rows = [...cum(A), ...cum(B)];
      return Plot.plot({
        width, height: 220, marginLeft: 48,
        x: {type: "time", domain: [new Date(thisYear, 0, 1), now], label: null},
        y: {grid: true, label: "km"},
        color: {domain: [A.name, B.name], range: [colorA, colorB], legend: true},
        marks: [
          Plot.lineY(rows, {x: "ts", y: "km", stroke: "rider", curve: "step-after", strokeWidth: 2}),
          Plot.ruleY([0])
        ]
      });
    })}
  </div>
  <div class="card">
    <h2>Favorite routes</h2>
    <div class="spots">
      ${[[A, colorA], [B, colorB]].map(([r, c]) => htl.html`<div>
        <div class="spots-who" style=${`color:${c}`}>${r.name}</div>
        ${r.spots.map(([name, count]) => htl.html`<div class="spot-row"><span class="spot-name">${name}</span><span class="spot-n">${count}</span></div>`)}
      </div>`)}
    </div>
  </div>
</div>

<style>
  h1 { margin-bottom: 0.3rem; }
  h2 { margin: 0 0 0.5rem; display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
  .nav-age { color: var(--theme-foreground-muted); font-size: 0.8rem; font-weight: 400; }
  .pickers { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 1rem; }
  .pickers form { width: auto; margin: 0; }
  .pickers .vs { color: var(--theme-foreground-muted); }
  .vs-head, .vs-row { display: grid; grid-template-columns: 1fr 11rem 1fr; gap: 0.8rem; align-items: center; }
  .vs-head { font-weight: 600; font-size: 0.85rem; margin-bottom: 0.2rem; }
  .vs-head span:first-child, .vs-a { text-align: right; }
  .vs-row { padding: 0.25rem 0; border-bottom: 1px solid var(--theme-foreground-faintest); }
  .vs-label { text-align: center; font-size: 0.8rem; color: var(--theme-foreground-muted); }
  .vs-val { font-variant-numeric: tabular-nums; display: flex; flex-direction: column; gap: 0.15rem; }
  .vs-a { align-items: flex-end; }
  .vs-win > :first-child { font-weight: 700; }
  .vs-a.vs-win > :first-child { color: var(--theme-foreground-focus); }
  .vs-b.vs-win > :first-child { color: #e8743b; }
  .vs-val a { color: inherit; }
  .vs-bar { display: block; width: 100%; height: 4px; background: var(--theme-foreground-faintest); border-radius: 2px; overflow: hidden; }
  .vs-bar span { display: block; height: 100%; }
  .vs-a .vs-bar { transform: scaleX(-1); }
  .vs-a .vs-bar span { background: var(--theme-foreground-focus); }
  .vs-b .vs-bar span { background: #e8743b; }
  .vs-sub { border-bottom: none; padding: 0 0 0.3rem; font-size: 0.7rem; color: var(--theme-foreground-muted); }
  .vs-foot { margin-top: 0.5rem; font-size: 0.75rem; color: var(--theme-foreground-muted); text-align: center; }
  .records-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr)); column-gap: 2.5rem; }
  .records-head { display: none; }
  .spots { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; }
  .spots-who { font-weight: 600; margin-bottom: 0.3rem; }
  .spot-row { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.85rem; padding: 0.15rem 0; border-bottom: 1px solid var(--theme-foreground-faintest); }
  .spot-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spot-n { font-variant-numeric: tabular-nums; color: var(--theme-foreground-muted); }
  @media (max-width: 640px) {
    .vs-head, .vs-row { grid-template-columns: 1fr 5.5rem 1fr; gap: 0.4rem; }
    .spots { grid-template-columns: 1fr; }
  }
</style>
