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
  .wq-badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.05rem 0.45rem; border-radius: 999px; vertical-align: 0.2rem;
    color: var(--wq); background: color-mix(in srgb, var(--wq) 16%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
</style>

# Kīhei

The top of the run (the Kīhei station at Sugar Beach), the bottom (Wailea's station, inland a bit, and the Grand Wailea cam), the run rating, and past runs in wind like now.

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, fetchRecentWind, fetchLiveWind, fetchCamReadings} from "./components/data.js";
import {compassPoint} from "./components/spectrum.js";
import {qualityStrip, qualityBadge} from "./components/wind-quality.js";

const RIDER_NAMES = [["dustin", "Dustin"], ["walter", "Walter"], ["jeff", "Jeff"]];
// Top and bottom of a north run.
const STATIONS = [
  {site: "kihei", name: "Top: Kīhei", where: "Sugar Beach"},
  {site: "wailea", name: "Bottom: Wailea", where: "inland of Wailea Beach"},
];
// Cams down the coast. More to come (Ulua, Poʻolenalena): each just needs
// its cam_motion/cam_images published under its own site.
const CAMS = [
  {site: "wailea", name: "Grand Wailea cam"},
];
const LIVE_STALE = 15 * 60e3;
const RATING_STALE = 30 * 60e3;
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
const allRuns = (await Promise.all(RIDER_NAMES.map(async ([slug, name]) =>
  (await fetchMeta(() => riderFile("runs.csv", slug)).catch(() => [])).map(d => ({...d, riderSlug: slug, riderName: name}))
))).flat();
```

```js
const {stations, rating, vision} = windNow;
const top = stations[0].rows.at(-1);
```

```js
function ratingCard(r) {
  if (!r) return html`<div class="card"><h2>Run rating</h2><div class="muted">No rating from Node-RED yet</div></div>`;
  const old = Date.now() - r.ts > RATING_STALE;
  const out10 = s => `${Math.round(s * 2.5)}/10`;
  const kiheiBest = r.rec === "Kīhei" || r.rec.includes("Kīhei slightly better");
  return html`<div class="card">
    <h2>Run rating <span class="muted" style="font-weight: normal">${old ? `as of ${fmt.clock(r.ts)}, not updated since` : `${fmt.relativeTime(r.ts)}`}</span></h2>
    <div class="rating-row" style=${old ? "opacity: 0.6" : ""}>
      <span class="lead ${kiheiBest ? "rating-best" : ""}">Kīhei ${out10(r.kihei)}</span>
      <span class="muted">North shore ${out10(r.ns)}</span>
      <span class="muted">Best bet: ${r.rec}</span>
    </div>
  </div>`;
}

function stationCard({site, name, where, rows, live}, yMax, xDomain) {
  const last = rows.at(-1);
  if (!last) return html`<div class="card"><h2>${name}</h2><div class="muted">No recent readings</div></div>`;
  return html`<div class="card">
    <h2>${name} <span class="muted" style="font-weight: normal">${where} · ${live ? "live · " : ""}${fmt.relativeTime(last.ts)}</span></h2>
    <div class="lead">${last.wavg.toFixed(0)} <span class="unit">kn</span>${last.wgust == null ? "" : ` g${last.wgust.toFixed(0)}`}${last.wdir == null ? "" : html` <span class="unit">${compassPoint(last.wdir)} ${Math.round(last.wdir)}°</span>`} ${qualityBadge(site, last)}</div>
    ${resize(width => Plot.plot({
      width, height: 110, marginLeft: 28, marginBottom: 20,
      x: {type: "time", domain: xDomain, ticks: 6, tickFormat: fmt.clock, label: null},
      y: {domain: [-2.5, yMax], ticks: [0, 10, 20, 30].filter(t => t <= yMax), label: null, grid: true},
      marks: [
        qualityStrip(site, rows, {y1: -2.5, y2: -0.8}),
        Plot.areaY(rows, {x: "ts", y1: d => d.wlull ?? d.wavg, y2: "wgust", fill: "var(--theme-foreground-focus)", fillOpacity: 0.15, curve: "basis"}),
        Plot.lineY(rows, {x: "ts", y: "wavg", stroke: "var(--theme-foreground-focus)", curve: "basis"}),
        Plot.ruleY([15], {stroke: "var(--theme-foreground-faint)", strokeDasharray: "2,3"}),
        Plot.tip(rows, Plot.pointerX({x: "ts", y: "wavg", title: d => `${fmt.clock(d.ts)}  ${d.wavg.toFixed(0)}${d.wgust == null ? "" : `g${d.wgust.toFixed(0)}`} kn ${d.wdir == null ? "" : `${Math.round(d.wdir)}°`}`}))
      ]
    }))}
    <div class="muted" style="font-size: 0.85em">last ${HOURS} hours · dashed line 15 kn</div>
  </div>`;
}

// dx < 0 is right to left in the picture: down the coast toward Mākena,
// the way a north run goes.
function camCard({name, site, readings}, read) {
  const measured = readings.filter(d => !d.skipped && d.dx != null);
  const last = readings.at(-1);
  const r = measured.at(-1);
  if (!r) return html`<div class="card"><h2>${name}</h2><div class="muted">No readings today or yesterday</div></div>`;
  const toward = r.dx < 0 ? "toward Mākena" : "toward Kīhei";
  const share = r.dx < 0 ? r.left : r.right;
  const img = r.images.flow ?? r.images.frame;
  const today = measured.filter(d => hstDay(d.ts) === hstDay(r.ts));
  return html`<div class="card">
    <h2>${name} <span class="muted" style="font-weight: normal">water motion · ${fmt.minuteStamp(r.ts)}</span></h2>
    <div class="lead">${Math.abs(r.dx).toFixed(1)} <span class="unit">px/s ${toward} · ${Math.round(100 * share)}% of the moving water${r.whitecaps == null ? "" : ` · ${r.whitecaps} whitecap${r.whitecaps === 1 ? "" : "s"}`}</span></div>
    ${last?.skipped ? html`<div class="muted">Not measuring since ${fmt.clock(last.ts)} (${last.skipped}).</div>` : ""}
    ${read ? html`<div class="muted" style="margin-top: 0.25rem">Vision read ${fmt.clock(new Date(read.stamp))}: ${read.sea}${read.shorebreak ? `, shorebreak ${read.shorebreak}` : ""}. ${read.description ?? ""}</div>` : ""}
    <div class="grid grid-cols-2" style="margin: 0.5rem 0 0">
      <div>${img ? html`<a href=${r.images.frame ?? img} target="_blank"><img class="cam-img" src=${img} alt="${name}: water with motion arrows"></a>` : ""}</div>
      <div>${resize(width => Plot.plot({
        width, height: 180, marginLeft: 32, marginBottom: 20,
        x: {type: "time", ticks: 4, tickFormat: fmt.clock, label: null},
        y: {label: "← toward Mākena (px/s)", grid: true, reverse: true},
        marks: [
          Plot.ruleY([0], {stroke: "var(--theme-foreground-faint)"}),
          Plot.ruleY([-2], {stroke: "var(--theme-foreground-faint)", strokeDasharray: "2,3"}),
          Plot.lineY(today, {x: "ts", y: "dx", stroke: "var(--theme-foreground-focus)", curve: "basis"}),
          Plot.dot(today, {x: "ts", y: "dx", r: d => Math.sqrt(d.whitecaps ?? 0), fill: "var(--theme-foreground-focus)", fillOpacity: 0.3}),
          Plot.tip(today, Plot.pointerX({x: "ts", y: "dx", title: d => `${fmt.clock(d.ts)}  ${d.dx.toFixed(1)} px/s, ${Math.round(100 * (d.dx < 0 ? d.left : d.right))}% ${d.dx < 0 ? "left" : "right"}${d.whitecaps == null ? "" : `, ${d.whitecaps} whitecaps`}`}))
        ]
      }))}
      <div class="muted" style="font-size: 0.85em">${fmt.date(r.ts)}: dots sized by whitecaps; dashed line −2 px/s, where the finish usually carries.</div></div>
    </div>
  </div>`;
}

// Past Kīhei runs whose average wind (Kīhei station) was close to the top
// station's last reading: within 3 kn and 20°, closest first.
function similarRuns(now) {
  if (!now) return [];
  const dAngle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  return allRuns
    .filter(d => d.region === "Kihei" && d.avg_wavg != null && d.avg_wdir != null)
    .map(d => ({...d, dKn: d.avg_wavg - now.wavg, dDeg: dAngle(d.avg_wdir, now.wdir)}))
    .filter(d => Math.abs(d.dKn) <= 3 && d.dDeg <= 20)
    .map(d => ({...d, score: Math.abs(d.dKn) / 3 + d.dDeg / 20}))
    .sort((a, b) => a.score - b.score);
}
const runLink = d => `https://${d.riderSlug}.downwind.pro/run.html?id=${d.id}`;
```

<div class="grid grid-cols-1">${ratingCard(rating)}</div>

<div class="grid grid-cols-1">${(() => {
  // Same scales, one above the other, so the drop from top to bottom reads
  // straight down.
  const yMax = Math.max(25, d3.max(stations.flatMap(s => s.rows), d => d.wgust) ?? 0);
  const xDomain = [new Date(Date.now() - HOURS * 3600e3), new Date()];
  return stations.map(s => stationCard(s, yMax, xDomain));
})()}</div>

${cams.map(c => camCard(c, vision[c.site]))}

## Runs in wind like now

```js
const similar = similarRuns(top);
const shown = similar.slice(0, 10);
```

<div class="card">
  <div class="muted" style="margin-bottom: 0.5rem">${top ? `Kīhei runs that averaged ${Math.max(0, top.wavg - 3).toFixed(0)}–${(top.wavg + 3).toFixed(0)} kn within 20° of ${Math.round(top.wdir)}° at the Kīhei station: ${similar.length} of them, closest ${shown.length} shown.` : "No current Kīhei reading."}</div>
  <div class="similar-wrap"><table class="similar">
    <thead><tr><th>Date</th><th>Rider</th><th>Route</th><th class="num">km</th><th class="num">on foil</th><th class="num">top km/h</th><th class="num">wind</th></tr></thead>
    <tbody>${shown.map(d => html`<tr>
      <td><a href=${runLink(d)}>${fmt.date(d.ts)} ${fmt.clock(d.ts)}</a></td>
      <td>${d.riderName}</td>
      <td>${d.start_beach}${d.end_beach !== d.start_beach ? ` → ${d.end_beach}` : ""}</td>
      <td class="num">${d.distance_km.toFixed(1)}</td>
      <td class="num">${d.distance_on_foil == null ? "" : `${Math.round(100 * d.distance_on_foil / (d.distance_km * 1000))}%`}</td>
      <td class="num">${d.max_speed_kmh == null ? "" : d.max_speed_kmh.toFixed(0)}</td>
      <td class="num">${d.avg_wavg.toFixed(0)}g${d.avg_wgust.toFixed(0)} ${Math.round(d.avg_wdir)}°</td>
    </tr>`)}</tbody>
  </table></div>
</div>
