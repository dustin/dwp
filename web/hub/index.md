---
theme: dashboard
title: downwind.pro
toc: false
---

# downwind.pro

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, ridersWith, fetchRecentWind, fetchLiveWind, fetchBuoySnapshot, fetchSwellPartitionWindow} from "./components/data.js";
import {compassPoint, renderSpectrumSparkline, renderMiniRose} from "./components/spectrum.js";
import {SPOTS, fetchExtremes, heightAt} from "./components/tides.js";
import {qualityStrip, qualityBadge, CLASSES} from "./components/wind-quality.js";
import {forecastMini, todayWindow, hstDay} from "./components/forecast.js";
import {fetchWindForecast} from "./components/data.js";

const RIDER_NAMES = (await ridersWith("hub")).map(r => [r.rider, r.name]);
const WIND_SITES = [["kihei", "Kīhei"], ["hookipa", "Hoʻokipa"]];
// Stations with a page of their own to dig into.
const WIND_PAGES = {kihei: "kihei.html", hookipa: "maliko.html"};

// Each station's last 6 hours: live/wind.json when the bot's feed is
// fresh, else the lake's half-hourly export. Refetched every minute while
// the page is visible, so the cards keep up on their own.
const LIVE_STALE = 15 * 60e3;
// Which side of Node-RED's run rating each station's card shows, and the
// rating's own name for it in rec ("Kīhei", "north shore").
const RATING_SIDE = {kihei: ["kihei", "Kīhei"], hookipa: ["ns", "north shore"]};
const RATING_STALE = 30 * 60e3;
async function loadWind() {
  const live = await fetchLiveWind();
  const since = Date.now() - 6 * 3600e3;
  const rating = live?.rating && !live.rating.dark && Date.now() - live.rating.ts < RATING_STALE ? live.rating : null;
  return Promise.all(WIND_SITES.map(async ([site, name]) => {
    const [side, recName] = RATING_SIDE[site] ?? [];
    const run = rating && side in rating
      ? {score: rating[side], best: rating.rec === recName || rating.rec.includes(`${recName} slightly better`)}
      : null;
    const rows = live?.stations[site]?.filter(d => d.ts >= since) ?? [];
    if (rows.length && Date.now() - rows.at(-1).ts < LIVE_STALE) return {site, name, rows, live: true, run};
    return fetchRecentWind(site, 6).then(rows => ({site, name, rows, run})).catch(() => ({site, name, rows: [], run}));
  }));
}
const windNow = (async function* () {
  while (true) {
    yield await loadWind();
    do await new Promise(resolve => setTimeout(resolve, 60e3));
    while (document.hidden);
  }
})();
// Each station's forecast for today and the next few days.
const forecasts = Promise.all(WIND_SITES.map(async ([site]) =>
  [site, await fetchWindForecast(site, d3.range(4).map(k => hstDay(Date.now() + k * 86400e3))).catch(() => [])]
)).then(Object.fromEntries);
const buoyNow = fetchBuoySnapshot(new Date()).catch(() => null);
// When the buoy's last report was, for the card when it's gone quiet.
const BUOY_LOOKBACK_DAYS = 7;
const buoyLastTs = buoyNow.then(b => b?.primary ? null
  : fetchSwellPartitionWindow("pauwela", new Date(Date.now() - BUOY_LOOKBACK_DAYS * 86400e3), new Date())
      .then(rows => rows.filter(d => d.values.some(v => v.rank === 1)).at(-1)?.ts ?? null)
      .catch(() => null));
const tidesNow = (async () => {
  const start = d3.timeDay(new Date()), end = d3.timeDay.offset(start, 1);
  const stations = [...new Set(SPOTS.map(s => s.station))];
  return Object.fromEntries(await Promise.all(stations.map(async s => [s, await fetchExtremes(s, start, end)])));
})().catch(() => null);
const riders = Promise.all(RIDER_NAMES.map(async ([slug, name]) => {
  const runs = await fetchMeta(() => riderFile("runs.csv", slug)).catch(() => []);
  return {slug, name, runs};
}));
```

```js
function riderHref(slug) {
  return `https://${slug}.downwind.pro/`;
}

// The run rating, quietly: "run 8/10" (out of 10, as the bot says it),
// in the focus color on the side the rating recommends.
function runHint(run) {
  if (!run) return "";
  const score = `run ${Math.round(run.score * 2.5)}/10`;
  return run.best ? htl.html`<span class="run-hint run-best">${score} · best bet</span>` : htl.html`<span class="run-hint">${score}</span>`;
}

function windCard({site, name, rows, live, run}) {
  const href = WIND_PAGES[site];
  const last = rows.at(-1);
  if (!last) return htl.html`<div class="card"><h2>${name} wind</h2><div class="nav-muted">No recent readings</div></div>`;
  const body = htl.html`
    <h2>${name} wind <span class="nav-age">${live ? htl.html`<span class="live-dot"></span>live · ` : ""}${fmt.relativeTime(last.ts)}${href ? htl.html` <span class="nav-card-arrow">→</span>` : ""}</span></h2>
    <div class="nav-lead">${last.wavg.toFixed(0)} <span class="unit">kn</span>${last.wgust == null ? "" : ` gusting ${last.wgust.toFixed(0)}`}${last.wdir == null ? "" : ` · ${compassPoint(last.wdir)} ${Math.round(last.wdir)}°`} ${qualityBadge(site, last)}</div>
    ${resize(width => Plot.plot({
      width, height: 70, margin: 2, marginBottom: 16, x: {type: "time", ticks: 3, tickFormat: fmt.clock, label: null}, y: {axis: null, domain: [-2.5, Math.max(30, d3.max(rows, d => d.wgust))]},
      marks: [
        qualityStrip(site, rows, {y1: -2.5, y2: -0.8}),
        Plot.areaY(rows, {x: "ts", y1: "wlull", y2: "wgust", fill: "var(--theme-foreground-focus)", fillOpacity: 0.15, curve: "basis"}),
        Plot.lineY(rows, {x: "ts", y: "wavg", stroke: "var(--theme-foreground-focus)", curve: "basis"}),
        Plot.ruleY([15], {stroke: "var(--theme-foreground-faint)", strokeDasharray: "2,3"})
      ]
    }))}
    <div class="nav-muted wind-foot"><span>last 6 hours · dashed line 15 kn</span>${runHint(run)}</div>`;
  return href
    ? htl.html`<a class="card nav-card wind-card" href=${href}>${body}</a>`
    : htl.html`<div class="card wind-card">${body}</div>`;
}

function buoyCard(b, lastTs) {
  if (!b?.primary) return htl.html`<a class="card nav-card" href="buoy.html"><h2>Pauwela buoy <span class="nav-card-arrow">→</span></h2><div class="nav-muted">${
    lastTs ? `No reports since ${fmt.minuteStamp(lastTs)} (${fmt.relativeTime(lastTs)})` : `No reports in the last ${BUOY_LOOKBACK_DAYS} days`}</div></a>`;
  return htl.html`<a class="card nav-card buoy-card" href="buoy.html">
    <div class="buoy-main">
      <h2>Pauwela buoy <span class="nav-age">${fmt.relativeTime(b.primaryTs)} <span class="nav-card-arrow">→</span></span></h2>
      <div class="nav-lead">${b.primary.height.toFixed(1)}′ @ ${b.primary.period.toFixed(0)}s ${compassPoint(b.primary.direction)}${
        b.primary.surflineKJ == null ? "" : htl.html` <span class="nav-age">${b.primary.surflineKJ.toFixed(0)} kJ</span>`}</div>
      <div class="buoy-spark">${resize((width, height) => renderSpectrumSparkline(b.spectrum, {width: Math.min(width, 220), height: Math.max(34, height)}))}</div>
    </div>
    <div class="buoy-side">${renderMiniRose(b.spectrum)}</div>
  </a>`;
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
    : ""}
    <div class="rider-host">${slug}.downwind.pro</div>
  </a>`;
}
```

## Conditions

<div class="grid grid-cols-4">
  ${windNow.map(windCard)}
  ${buoyCard(buoyNow, buoyLastTs)}
  ${tideCard(tidesNow)}
</div>

## Forecast

```js
// Which run looks best today: the station with the most rideable hours
// ahead (weighted by how good they are), and the routes ridden most in
// wind like its peak.
const RUN_REGION = {kihei: "Kihei", hookipa: "Maui North Shore"};
// What the pick calls each side: the run, not the station.
const RUN_NAME = {kihei: "Kīhei", hookipa: "Maliko"};
const dAngle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function pickCard(wind, forecasts, riders) {
  const now = new Date();
  const runs = riders.flatMap(r => r.runs);
  const opts = wind.map(({site, name, rows}) => {
    const w = todayWindow(site, forecasts[site] ?? [], rows, now);
    return {site, name: RUN_NAME[site] ?? name, w, score: d3.sum(w.ok, h => CLASSES[h.cls].rank)};
  }).sort((a, b) => b.score - a.score);
  const best = opts[0];
  if (!best?.score) {
    const dark = opts.every(o => now > o.w.set);
    return htl.html`<div class="card"><h2>Today's pick</h2>
      <div class="nav-lead">${dark ? "Dark, see you tomorrow" : "Nothing looks rideable today"}</div></div>`;
  }
  const {w} = best;
  const like = runs.filter(d => d.region === RUN_REGION[best.site] && d.avg_wavg != null && d.avg_wdir != null
    && Math.abs(d.avg_wavg - w.peak.wavg) <= 3 && dAngle(d.avg_wdir, w.peak.wdir) <= 20);
  const routes = d3.rollups(like, v => v.length, route).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const hl = h => `${String(new Date(+h.ts - 36e6).getUTCHours()).padStart(2, "0")}:00`;
  const other = opts[1];
  return htl.html`<div class="card pick-card">
    <h2>Today's pick</h2>
    <div class="nav-lead">${best.name} <span class="unit">${hl(w.ok[0])}–${hl(w.ok.at(-1))}, ~${Math.round(w.peak.wavg)} kn ${Math.round(w.peak.wdir)}°</span></div>
    ${routes.length ? htl.html`<div class="nav-muted">In wind like that: ${routes.map(([r, n], i) => htl.html`${i ? " or " : ""}<b class="pick-route">${r}</b> (${n})`)} of ${like.length} runs</div>` : htl.html`<div class="nav-muted">No past runs in wind quite like that</div>`}
    ${other ? htl.html`<div class="nav-muted">${other.name}: ${other.score ? `${hl(other.w.ok[0])}–${hl(other.w.ok.at(-1))}, ~${Math.round(other.w.peak.wavg)} kn` : "not rideable"}</div>` : ""}
  </div>`;
}
```

<div class="grid grid-cols-4">
  ${pickCard(windNow, forecasts, riders)}
  ${windNow.map(({site, name, rows}) => forecastMini(site, forecasts[site] ?? [], rows, {name, href: WIND_PAGES[site] && `${WIND_PAGES[site]}#forecast`}))}
</div>

## Riders <a class="riders-compare" href="versus.html">Compare two riders →</a>

<div class="grid grid-cols-4">
  ${riders.filter(r => r.runs.length).map(riderCard)}
</div>

```js
// Every rider's runs in one list, newest first.
const allRuns = riders.flatMap(r => r.runs.map(d => ({...d, riderName: r.name, riderSlug: r.slug})))
  .sort((a, b) => d3.descending(a.ts, b.ts));
const today = d3.timeDay(new Date());
const since90 = d3.timeDay.offset(today, -90);
const recent90 = allRuns.filter(d => d.ts >= since90);
const route = d => d.end_beach && d.end_beach !== d.start_beach ? `${d.start_beach} → ${d.end_beach}` : d.start_beach;
const runLink = d => `https://${d.riderSlug}.downwind.pro/run.html?id=${d.id}`;
```

## On the water

<div class="grid grid-cols-4" style="grid-auto-rows: auto;">
  <div class="card grid-colspan-2">
    <h2>Recent sessions</h2>
    <div class="feed">${allRuns.slice(0, 8).map(d => htl.html`<a class="feed-row" href=${runLink(d)}>
      <span class="feed-when">${fmt.relativeTime(d.ts)}</span>
      <span class="feed-who">${d.riderName}</span>
      <span class="feed-route">${route(d)}</span>
      <span class="feed-km">${d.distance_km.toFixed(1)} km</span>
      <span class="feed-wind">${d.avg_wavg == null ? "" : `${d.avg_wavg.toFixed(0)}–${d.max_wgust.toFixed(0)} kn`}</span>
    </a>`)}</div>
  </div>
  <div class="card">
    <h2>Last 90 days <span class="nav-age">${recent90.length} runs · ${fmt.comma(Math.round(d3.sum(recent90, d => d.distance_km)))} km</span></h2>
    ${resize(width => {
      const byDay = d3.rollup(recent90, v => ({km: d3.sum(v, d => d.distance_km), n: v.length, riders: new Set(v.map(d => d.riderName))}), d => +d3.timeDay(d.ts));
      const days = d3.timeDays(since90, d3.timeDay.offset(today, 1)).map(day => ({day, ...(byDay.get(+day) ?? {km: 0, n: 0, riders: new Set()})}));
      // Square cells: size them from the width, then size the plot from the cells.
      const weeks = d3.timeWeek.count(d3.timeWeek(since90), today) + 1;
      const cell = Math.max(10, Math.min(22, Math.floor((width - 24) / weeks)));
      return Plot.plot({
        width: 24 + cell * weeks, height: 4 + cell * 7 + 22, marginLeft: 24, marginRight: 0, marginTop: 4, marginBottom: 22, padding: 0.12,
        x: {type: "band", axis: "bottom", tickSize: 0, tickFormat: (w, i) => i % 4 ? "" : d3.timeFormat("%b %-d")(d3.timeWeek.offset(d3.timeWeek(since90), w)), label: null},
        y: {type: "band", domain: d3.range(7), tickFormat: d => "SMTWTFS"[d], label: null, tickSize: 0},
        color: {type: "linear", domain: [0, 40], range: ["#c6dbef", "#08519c"], clamp: true},
        marks: [Plot.cell(days, {
          x: d => d3.timeWeek.count(d3.timeWeek(since90), d.day), y: d => d.day.getDay(),
          fill: "var(--theme-foreground-faintest)", inset: 0.5
        }), Plot.cell(days.filter(d => d.n), {
          x: d => d3.timeWeek.count(d3.timeWeek(since90), d.day), y: d => d.day.getDay(),
          fill: d => d.km, inset: 0.5,
          title: d => `${d3.timeFormat("%a %b %-d")(d.day)}\n${d.n ? `${d.n} runs · ${d.km.toFixed(1)} km · ${[...d.riders].join(", ")}` : "no runs"}`
        }), Plot.cell(days.filter(d => +d.day === +today), {
          x: d => d3.timeWeek.count(d3.timeWeek(since90), d.day), y: d => d.day.getDay(),
          fill: "none", stroke: "var(--theme-foreground)", inset: 0.5
        })]
      });
    })}
  </div>
  <div class="card">
    <h2>Popular routes <span class="nav-age">last 90 days</span></h2>
    ${resize(width => {
      const routes = d3.rollups(recent90, v => ({n: v.length, km: d3.sum(v, d => d.distance_km)}), route)
        .map(([name, v]) => ({name, ...v})).sort((a, b) => d3.descending(a.n, b.n)).slice(0, 8);
      return Plot.plot({
        width, height: routes.length * 26 + 20, marginLeft: Math.min(220, width * 0.45), marginRight: 40,
        x: {axis: null}, y: {domain: routes.map(d => d.name), label: null, tickSize: 0},
        marks: [
          Plot.barX(routes, {x: "n", y: "name", fill: "var(--theme-foreground-focus)", fillOpacity: 0.8}),
          Plot.text(routes, {x: "n", y: "name", text: d => `${d.n}`, dx: 4, textAnchor: "start", fill: "var(--theme-foreground)"})
        ]
      });
    })}
  </div>
</div>

<style>
  .feed { display: grid; gap: 0.1rem; }
  .feed a.feed-row, .feed a.feed-row span { color: var(--theme-foreground); }
  .feed a.feed-row .feed-when, .feed a.feed-row .feed-wind { color: var(--theme-foreground-muted); }
  .feed-row { display: grid; grid-template-columns: 6.5rem 4rem 1fr auto 4.5rem; gap: 0.6rem; padding: 0.25rem 0;
    color: var(--theme-foreground); text-decoration: none; font-size: 0.9rem; border-bottom: 1px solid var(--theme-foreground-faintest); }
  .feed-row:hover .feed-route { color: var(--theme-foreground-focus); }
  .feed-when, .feed-wind { color: var(--theme-foreground-muted); }
  .feed-km, .feed-wind { font-variant-numeric: tabular-nums; text-align: right; }
  .feed-route { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 640px) {
    .feed-row { grid-template-columns: 1fr auto; }
    .feed-when, .feed-who { grid-column: 1; font-size: 0.8rem; }
    .feed-route { grid-column: 1; }
    .feed-km { grid-row: 1; grid-column: 2; }
    .feed-wind { grid-column: 2; }
  }
</style>

<style>
  h2 { margin: 0 0 0.3rem; display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
  .nav-lead { font-size: 1.25rem; font-weight: 600; }
  .unit { font-size: 0.9rem; font-weight: 400; color: var(--theme-foreground-muted); }
  .nav-muted, .nav-age { color: var(--theme-foreground-muted); font-size: 0.85rem; font-weight: 400; }
  .nav-rows { display: grid; gap: 0.15rem; }
  .nav-row { display: grid; grid-template-columns: 1fr auto 1.2em; gap: 0.6rem; font-size: 0.9rem; }
  .nav-row-value { font-variant-numeric: tabular-nums; }
  .tide-ok { color: var(--theme-green, #3ca951); }
  .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px;
    background: var(--theme-green, #3ca951); animation: live-pulse 2s ease-in-out infinite; }
  @keyframes live-pulse { 50% { opacity: 0.35; } }
  .wind-foot { display: flex; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
  .run-hint { white-space: nowrap; }
  .wq-badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.05rem 0.45rem; border-radius: 999px; vertical-align: 0.2rem;
    color: var(--wq); background: color-mix(in srgb, var(--wq) 16%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
  .run-best { color: var(--theme-foreground-focus); }
  a.nav-card { color: var(--theme-foreground); text-decoration: none; display: flex; flex-direction: column; gap: 0.3rem;
    background: color-mix(in srgb, var(--theme-foreground-focus) 6%, var(--theme-background-alt));
    border-color: color-mix(in srgb, var(--theme-foreground-focus) 25%, transparent); }
  a.nav-card:hover { border-color: var(--theme-foreground-focus); }
  .nav-card-arrow { color: var(--theme-foreground-focus); }
  a.nav-card.buoy-card { flex-direction: row; gap: 0.75rem; }
  .buoy-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .buoy-spark { flex: 1; min-height: 34px; }
  .fc-strip { position: relative; height: 10px; border-radius: 3px; overflow: hidden; background: var(--theme-foreground-faintest); margin-top: 0.2rem; }
  .fc-strip span { position: absolute; top: 0; bottom: 0; }
  .fc-strip i { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--theme-foreground); }
  .fc-strip-ends { display: flex; justify-content: space-between; font-size: 0.75rem; }
  .fc-minidays { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  .fc-miniday { font-size: 0.8rem; padding: 0.05rem 0.5rem; border-radius: 999px; white-space: nowrap;
    background: color-mix(in srgb, var(--wq) 14%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
  .pick-card { display: flex; flex-direction: column; gap: 0.3rem; }
  .pick-route { font-weight: 600; color: var(--theme-foreground); }
  .riders-compare { font-size: 0.9rem; font-weight: 400; margin-left: 0.6rem; }
  .rider-host { margin-top: auto; padding-top: 0.4rem; font-size: 0.8rem; color: var(--theme-foreground-focus); }
</style>
