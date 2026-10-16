---
theme: dashboard
title: Maliko conditions
toc: false
---

<style>
  .muted { color: var(--theme-foreground-muted); }
  .lead { font-size: 1.6rem; font-weight: 600; line-height: 1.2; }
  .lead .unit { font-size: 1rem; font-weight: normal; color: var(--theme-foreground-muted); }
  .rating-row { display: flex; flex-wrap: wrap; gap: 0.25rem 1.5rem; align-items: baseline; }
  .rating-best { color: var(--theme-foreground-focus); }
  .cam-img { width: 100%; border-radius: 4px; display: block; margin-top: 0.5rem; }
  .similar { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .similar td, .similar th { padding: 0.25rem 0.5rem 0.25rem 0; text-align: left; white-space: nowrap; }
  .similar th { font-weight: normal; color: var(--theme-foreground-muted); }
  .similar .num { text-align: right; }
  .similar-wrap { overflow-x: auto; }
  /* One width for every card, so the wind charts don't stretch across a wide screen. */
  .spot-col { max-width: 1100px; }
  .fc-days { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.75rem 0 0.25rem; }
  .fc-day { display: flex; flex-direction: column; min-width: 6.5rem; padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.85rem;
    background: color-mix(in srgb, var(--wq) 16%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
  .fc-day b { font-size: 1rem; }
  .wq-badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.05rem 0.45rem; border-radius: 999px; vertical-align: 0.2rem;
    color: var(--wq); background: color-mix(in srgb, var(--wq) 16%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
</style>

# Maliko

The north shore run from Maliko to Kahului: the Hoʻokipa station, the run rating, the forecast for the rest of the day and the coming afternoons, the Pauwela buoy, and past runs in buoy and wind like now.

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, fetchRecentWind, fetchLiveWind, fetchWindForecast, fetchSwellPartitionWindow, fetchBuoySnapshot, runBuoySnapshots} from "./components/data.js";
import {forecastCard} from "./components/forecast.js";
import {ratingCard, stationCard, similarRuns, similarRunsCard, similarBuoyRuns, BUOY_LIMITS} from "./components/conditions.js";
import {snapshotCard} from "./components/buoy-snapshot.js";
import {directionColor} from "./components/spectrum.js";

const RIDER_NAMES = [["dustin", "Dustin"], ["walter", "Walter"], ["jeff", "Jeff"]];
const STATION = {site: "hookipa", name: "Hoʻokipa", where: "Hoʻokipa Beach Park"};
const LIVE_STALE = 15 * 60e3;
const HOURS = 6;
// How far back to look for the buoy's last report when it's been offline.
const BUOY_LOOKBACK_DAYS = 7;

async function loadWind() {
  const live = await fetchLiveWind();
  const since = Date.now() - HOURS * 3600e3;
  const rows = live?.stations[STATION.site]?.filter(d => d.ts >= since) ?? [];
  const station = rows.length && Date.now() - rows.at(-1).ts < LIVE_STALE
    ? {...STATION, rows, live: true}
    : await fetchRecentWind(STATION.site, HOURS).then(rows => ({...STATION, rows})).catch(() => ({...STATION, rows: []}));
  return {station, rating: live?.rating ?? null};
}
const windNow = (async function* () {
  while (true) {
    yield await loadWind();
    do await new Promise(resolve => setTimeout(resolve, 60e3));
    while (document.hidden);
  }
})();
```

```js
const hstDay = t => new Date(t - 10 * 3600e3).toISOString().slice(0, 10);
const forecastRows = await fetchWindForecast("hookipa", d3.range(8).map(k => hstDay(Date.now() + k * 86400e3)));
const hookipaToday = await fetchRecentWind("hookipa", 14).catch(() => []);
// The buoy's readings over the last week (NDBC's own summary, rank 1),
// and the spectrum at its last report, however old.
const buoyReadings = (await fetchSwellPartitionWindow("pauwela", new Date(Date.now() - BUOY_LOOKBACK_DAYS * 86400e3), new Date()).catch(() => []))
  .map(d => ({ts: d.ts, ...d.values.find(v => v.rank === 1)}))
  .filter(d => d.height != null);
const buoyLast = buoyReadings.at(-1);
const buoySnap = buoyLast ? await fetchBuoySnapshot(buoyLast.ts).catch(() => null) : null;
const nsRuns = (await Promise.all(RIDER_NAMES.map(async ([slug, name]) =>
  (await fetchMeta(() => riderFile("runs.csv", slug)).catch(() => []))
    .filter(d => d.region === "Maui North Shore")
    .map(d => ({...d, riderSlug: slug, riderName: name}))
))).flat();
// Each run's mid-run buoy report (run_buoy.csv), merged across riders.
const runBuoy = new Map((await Promise.all(RIDER_NAMES.map(([slug]) =>
  runBuoySnapshots(riderFile("run_buoy.csv", slug), nsRuns.filter(d => d.riderSlug === slug)).catch(() => new Map())
))).flatMap(m => [...m]));
// The buoy counts as "now" only while it's reporting.
const BUOY_FRESH = 3 * 3600e3;
const buoyNow = buoyLast && Date.now() - buoyLast.ts < BUOY_FRESH ? buoyLast : null;
```

```js
const {station, rating} = windNow;
const top = station.rows.at(-1);
```

```js
// NDBC's height, period and direction over the last two days of reports.
function buoyCard(readings, snap) {
  const last = readings.at(-1);
  if (!last) return html`<div class="card"><h2>Pauwela buoy</h2><div class="muted">No reports in the last ${BUOY_LOOKBACK_DAYS} days.</div></div>`;
  const stale = Date.now() - last.ts > 3 * 3600e3;
  const recent = readings.filter(d => d.ts >= +last.ts - 48 * 3600e3);
  return html`<div class="card">
    <h2><a href="buoy.html">Pauwela buoy</a> <span class="muted" style="font-weight: normal">${stale ? `No reports since ${fmt.minuteStamp(last.ts)} (${fmt.relativeTime(last.ts)})` : fmt.relativeTime(last.ts)}</span></h2>
    <div class="lead">${last.height.toFixed(1)}′ <span class="unit">@ ${last.period.toFixed(0)}s from ${Math.round(last.direction)}°</span></div>
    ${resize(width => Plot.plot({
      width, height: 140, marginLeft: 28, marginRight: 28, marginBottom: 20,
      x: {type: "time", ticks: 6, tickFormat: fmt.timeTick, label: null},
      y: {label: "ft", grid: true, domain: [0, Math.max(6, d3.max(recent, d => d.height))]},
      marks: [
        Plot.lineY(recent, {x: "ts", y: "height", stroke: "var(--theme-foreground-focus)", curve: "basis"}),
        Plot.dot(recent, {x: "ts", y: "height", r: d => d.period / 3, fill: d => directionColor(d.direction), fillOpacity: 0.7}),
        Plot.tip(recent, Plot.pointerX({x: "ts", y: "height", title: d => `${fmt.minuteStamp(d.ts)}  ${d.height.toFixed(1)}′ @ ${d.period.toFixed(0)}s from ${Math.round(d.direction)}°`})),
      ],
    }))}
    <div class="muted" style="font-size: 0.85em">${stale ? "The 48 hours before the last report" : "Last 48 hours"}: height, dots sized by period and colored by direction.</div>
  </div>`;
}
```

<div class="grid grid-cols-1 spot-col">${ratingCard(rating, "ns")}</div>

<div class="grid grid-cols-1 spot-col">${(() => {
  // The page's live readings are newer than the day's file; use them where they overlap.
  const live = station.rows;
  const obs = [...hookipaToday.filter(d => !live.length || d.ts < live[0].ts), ...live];
  return forecastCard("hookipa", forecastRows, obs, {name: "Hoʻokipa forecast", resize});
})()}</div>

<div class="grid grid-cols-1 spot-col">${(() => {
  const yMax = Math.max(25, d3.max(station.rows, d => d.wgust) ?? 0);
  return stationCard(station, yMax, [new Date(Date.now() - HOURS * 3600e3), new Date()], {resize, hours: HOURS});
})()}</div>

<div class="grid grid-cols-1 spot-col">${buoyCard(buoyReadings, buoySnap)}</div>

<div class="grid grid-cols-1 spot-col">${buoySnap ? snapshotCard({...buoySnap, label: "Swells at the last report", color: "inherit"}, {resize}) : ""}</div>

## Runs in conditions similar to now

```js
const swellLike = similarBuoyRuns(nsRuns, runBuoy, buoyNow, top);
const windLike = similarRuns(nsRuns, "Maui North Shore", top).map(d => ({...d, buoy: runBuoy.get(d.id)?.primary}));
const withBuoy = nsRuns.filter(d => runBuoy.get(d.id)?.primary).length;
```

${buoyNow
  ? similarRunsCard(swellLike, top, {buoy: true, note: `Buoy like now: north shore runs whose mid-run Pauwela report was within ${BUOY_LIMITS.ft} ft, ${BUOY_LIMITS.s} s and ${BUOY_LIMITS.deg}° of ${buoyNow.height.toFixed(1)}′ @ ${buoyNow.period.toFixed(0)}s from ${Math.round(buoyNow.direction)}°: ${swellLike.length} of the ${withBuoy} runs with buoy data, closest ${Math.min(10, swellLike.length)} shown.`})
  : html`<div class="card"><div class="muted">Buoy like now: the Pauwela buoy isn't reporting${buoyLast ? ` (no reports since ${fmt.minuteStamp(buoyLast.ts)}, ${fmt.relativeTime(buoyLast.ts)})` : ""}, so there's nothing to match. ${withBuoy} north shore runs have buoy data.</div></div>`}

${similarRunsCard(windLike, top, {station: "Hoʻokipa", region: "North shore", buoy: true})}
