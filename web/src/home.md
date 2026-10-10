---
theme: dashboard
title: downwind.pro
toc: false
---

# downwind.pro

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, fetchRecentWind, fetchBuoySnapshot} from "./components/data.js";
import {compassPoint, renderSpectrumSparkline, renderMiniRose} from "./components/spectrum.js";
import {SPOTS, fetchExtremes, heightAt} from "./components/tides.js";

const RIDER_NAMES = [["dustin", "Dustin"], ["walter", "Walter"]];
const WIND_SITES = [["kihei", "Kīhei"], ["hookipa", "Hoʻokipa"]];

const windNow = Promise.all(WIND_SITES.map(([site, name]) =>
  fetchRecentWind(site, 6).then(rows => ({site, name, rows})).catch(() => ({site, name, rows: []}))));
const buoyNow = fetchBuoySnapshot(new Date()).catch(() => null);
const tidesNow = (async () => {
  const start = d3.timeDay(new Date()), end = d3.timeDay.offset(start, 1);
  const stations = [...new Set(SPOTS.map(s => s.station))];
  return Object.fromEntries(await Promise.all(stations.map(async s => [s, await fetchExtremes(s, start, end)])));
})().catch(() => null);
const riders = Promise.all(RIDER_NAMES.map(async ([slug, name]) => {
  const runs = await fetchMeta(() => riderFile("runs.csv", slug === "dustin" ? FileAttachment("data/runs.csv") : null, slug)).catch(() => []);
  return {slug, name, runs};
}));
```

```js
function riderHref(slug) {
  return location.hostname.endsWith("downwind.pro") ? `https://${slug}.downwind.pro/` : `index.html?rider=${slug}`;
}

function windCard({name, rows}) {
  const last = rows.at(-1);
  if (!last) return htl.html`<div class="card"><h2>${name} wind</h2><div class="nav-muted">No recent readings</div></div>`;
  return htl.html`<div class="card wind-card">
    <h2>${name} wind <span class="nav-age">${fmt.relativeTime(last.ts)}</span></h2>
    <div class="nav-lead">${last.wavg.toFixed(0)} <span class="unit">kn</span> gusting ${last.wgust.toFixed(0)} · ${compassPoint(last.wdir)}</div>
    ${resize(width => Plot.plot({
      width, height: 70, margin: 2, marginBottom: 16, x: {type: "time", ticks: 3, tickFormat: fmt.clock, label: null}, y: {axis: null, domain: [0, Math.max(30, d3.max(rows, d => d.wgust))]},
      marks: [
        Plot.areaY(rows, {x: "ts", y1: "wlull", y2: "wgust", fill: "var(--theme-foreground-focus)", fillOpacity: 0.15, curve: "basis"}),
        Plot.lineY(rows, {x: "ts", y: "wavg", stroke: "var(--theme-foreground-focus)", curve: "basis"}),
        Plot.ruleY([15], {stroke: "var(--theme-foreground-faint)", strokeDasharray: "2,3"})
      ]
    }))}
    <div class="nav-muted">last 6 hours · dashed line 15 kn</div>
  </div>`;
}

function buoyCard(b) {
  if (!b?.primary) return htl.html`<div class="card"><h2>Pauwela buoy</h2><div class="nav-muted">No recent report</div></div>`;
  return htl.html`<div class="card buoy-card">
    <div class="buoy-main">
      <h2>Pauwela buoy <span class="nav-age">${fmt.relativeTime(b.primaryTs)}</span></h2>
      <div class="nav-lead">${b.primary.height.toFixed(1)}′ @ ${b.primary.period.toFixed(0)}s ${compassPoint(b.primary.direction)}${
        b.primary.surflineKJ == null ? "" : htl.html` <span class="nav-age">${b.primary.surflineKJ.toFixed(0)} kJ</span>`}</div>
      <div class="buoy-spark">${resize((width, height) => renderSpectrumSparkline(b.spectrum, {width: Math.min(width, 220), height: Math.max(34, height)}))}</div>
    </div>
    <div class="buoy-side">${renderMiniRose(b.spectrum)}</div>
  </div>`;
}

function tideCard(ex) {
  const now = new Date();
  const rows = ex ? SPOTS.map(spot => {
    const e = ex[spot.station];
    const h = e ? heightAt(e, now) : null;
    if (h == null) return null;
    const rising = heightAt(e, new Date(+now + 6e5)) > h;
    const ok = spot.enough == null ? null : h >= spot.enough;
    return htl.html`<div class="nav-row"><span class="nav-row-name">${spot.name}</span>
      <span class="nav-row-value">${h.toFixed(1)}′ ${rising ? "↑" : "↓"}</span>
      <span class=${ok ? "tide-ok" : "nav-muted"}>${ok == null ? "" : ok ? "✓" : "·"}</span></div>`;
  }) : [];
  return htl.html`<a class="card nav-card" href="tides.html"><h2>Tides <span class="nav-card-arrow">→</span></h2>
    ${rows.some(Boolean) ? htl.html`<div class="nav-rows">${rows}</div>` : htl.html`<div class="nav-muted">Tide predictions unavailable</div>`}</a>`;
}

function riderCard({slug, name, runs}) {
  const latest = d3.greatest(runs, d => d.ts);
  const year = runs.filter(d => d.ts.getFullYear() === new Date().getFullYear());
  return htl.html`<a class="card nav-card rider-card" href=${riderHref(slug)}>
    <h2>${name} <span class="nav-card-arrow">→</span></h2>
    ${latest ? htl.html`
      <div class="nav-lead">${latest.start_beach}${latest.end_beach !== latest.start_beach ? ` → ${latest.end_beach}` : ""}</div>
      <div class="nav-muted">Last run ${fmt.relativeTime(latest.ts)} · ${latest.distance_km.toFixed(1)} km</div>
      <div class="nav-muted">${year.length} runs · ${fmt.comma(Math.round(d3.sum(year, d => d.distance_km)))} km this year</div>`
    : htl.html`<div class="nav-muted">No runs yet</div>`}
    <div class="rider-host">${slug}.downwind.pro</div>
  </a>`;
}
```

## Conditions

<div class="grid grid-cols-4">
  ${windNow.map(windCard)}
  ${buoyCard(buoyNow)}
  ${tideCard(tidesNow)}
</div>

## Riders

<div class="grid grid-cols-4">
  ${riders.map(riderCard)}
</div>

<style>
  h2 { margin: 0 0 0.3rem; display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
  .nav-lead { font-size: 1.25rem; font-weight: 600; }
  .unit { font-size: 0.9rem; font-weight: 400; color: var(--theme-foreground-muted); }
  .nav-muted, .nav-age { color: var(--theme-foreground-muted); font-size: 0.85rem; font-weight: 400; }
  .nav-rows { display: grid; gap: 0.15rem; }
  .nav-row { display: grid; grid-template-columns: 1fr auto 1.2em; gap: 0.6rem; font-size: 0.9rem; }
  .nav-row-value { font-variant-numeric: tabular-nums; }
  .tide-ok { color: var(--theme-green, #3ca951); }
  a.nav-card { color: var(--theme-foreground); text-decoration: none; display: flex; flex-direction: column; gap: 0.3rem;
    background: color-mix(in srgb, var(--theme-foreground-focus) 6%, var(--theme-background-alt));
    border-color: color-mix(in srgb, var(--theme-foreground-focus) 25%, transparent); }
  a.nav-card:hover { border-color: var(--theme-foreground-focus); }
  .nav-card-arrow { color: var(--theme-foreground-focus); }
  .buoy-card { display: flex; gap: 0.75rem; }
  .buoy-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .buoy-spark { flex: 1; min-height: 34px; }
  .rider-host { margin-top: auto; padding-top: 0.4rem; font-size: 0.8rem; color: var(--theme-foreground-focus); }
</style>
