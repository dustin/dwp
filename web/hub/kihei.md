---
theme: dashboard
title: Kīhei conditions
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
  .kihei-col { max-width: 1100px; }
  .fc-days { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.75rem 0 0.25rem; }
  .fc-day { display: flex; flex-direction: column; min-width: 6.5rem; padding: 0.35rem 0.6rem; border-radius: 6px; font-size: 0.85rem;
    background: color-mix(in srgb, var(--wq) 16%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
  .fc-day b { font-size: 1rem; }
  .wq-badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.05rem 0.45rem; border-radius: 999px; vertical-align: 0.2rem;
    color: var(--wq); background: color-mix(in srgb, var(--wq) 16%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
</style>

# Kīhei

The top of the run (the Kīhei station at Sugar Beach), the bottom (Wailea's station, inland a bit, and the Grand Wailea cam), the run rating, the forecast for the rest of the day and the coming afternoons, and past runs in wind like now.

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, fetchRecentWind, fetchLiveWind, fetchCamReadings, fetchWindForecast} from "./components/data.js";
import {forecastCard} from "./components/forecast.js";
import {ratingCard, stationCard, similarRuns, similarRunsCard, camCard} from "./components/conditions.js";

const RIDER_NAMES = [["dustin", "Dustin"], ["walter", "Walter"], ["jeff", "Jeff"]];
// Top and bottom of a north run.
const STATIONS = [
  {site: "kihei", name: "Top: Kīhei", where: "Sugar Beach"},
  {site: "wailea", name: "Bottom: Wailea", where: "inland of Wailea Beach"},
];
// Cams down the coast, north to south (db/cams/cams.py), each with its cam_motion/cam_images
// published under its own site. px/s isn't comparable between cams, so only
// Wailea's has the −2 px/s line. left/right say where dx < 0 / > 0 goes.
const DOWN_COAST = {left: "toward Mākena", right: "toward Kīhei"};
const CAMS = [
  {site: "ulua", name: "Ulua cam", ...DOWN_COAST},
  {site: "wailea", name: "Grand Wailea cam", ...DOWN_COAST, mark: {dx: -2, label: "where the finish usually carries"}},
  {site: "poolenalena", name: "Poʻolenalena cam", left: "offshore", right: "inshore"},
];
const LIVE_STALE = 15 * 60e3;
const HOURS = 6;

async function loadWind() {
  const live = await fetchLiveWind();
  const since = Date.now() - HOURS * 3600e3;
  const stations = await Promise.all(STATIONS.map(async s => {
    const rows = live?.stations[s.site]?.filter(d => d.ts >= since) ?? [];
    if (rows.length && Date.now() - rows.at(-1).ts < LIVE_STALE) return {...s, rows, live: true};
    return fetchRecentWind(s.site, HOURS).then(rows => ({...s, rows})).catch(() => ({...s, rows: []}));
  }));
  return {stations, rating: live?.rating ?? null, vision: live?.cams ?? {}};
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
// HST days for today and yesterday, so the night still shows the last
// daylight readings.
const hstDay = t => new Date(t - 10 * 3600e3).toISOString().slice(0, 10);
const camDays = [hstDay(Date.now() - 86400e3), hstDay(Date.now())];
const cams = await Promise.all(CAMS.map(async c => {
  const readings = (await fetchCamReadings(c.site, camDays)).filter(d => d.ts <= Date.now());
  return {...c, readings};
}));
// Forecasts for today and the coming week, and the top station since
// before sunrise for the forecast card.
const forecastRows = await fetchWindForecast("kihei", d3.range(8).map(k => hstDay(Date.now() + k * 86400e3)));
const kiheiToday = await fetchRecentWind("kihei", 14).catch(() => []);
const allRuns = (await Promise.all(RIDER_NAMES.map(async ([slug, name]) =>
  (await fetchMeta(() => riderFile("runs.csv", slug)).catch(() => [])).map(d => ({...d, riderSlug: slug, riderName: name}))
))).flat();
```

```js
const {stations, rating, vision} = windNow;
const top = stations[0].rows.at(-1);
```

```js

```

<div class="grid grid-cols-1 kihei-col">${ratingCard(rating, "kihei")}</div>

<div class="grid grid-cols-1 kihei-col">${(() => {
  // The page's live readings are newer than the day's file; use them where they overlap.
  const live = stations[0].rows;
  const obs = [...kiheiToday.filter(d => !live.length || d.ts < live[0].ts), ...live];
  return forecastCard("kihei", forecastRows, obs, {name: "Kīhei forecast", resize});
})()}</div>

<div class="grid grid-cols-1 kihei-col">${(() => {
  // Same scales, one above the other, so the drop from top to bottom reads
  // straight down.
  const yMax = Math.max(25, d3.max(stations.flatMap(s => s.rows), d => d.wgust) ?? 0);
  const xDomain = [new Date(Date.now() - HOURS * 3600e3), new Date()];
  return stations.map(s => stationCard(s, yMax, xDomain, {resize, hours: HOURS}));
})()}</div>

<div class="grid grid-cols-1 kihei-col">${cams.map(c => camCard(c, vision[c.site], {resize}))}</div>

## Runs in wind like now

```js
const similar = similarRuns(allRuns, "Kihei", top);
```

${similarRunsCard(similar, top, {station: "Kīhei", region: "Kīhei"})}
