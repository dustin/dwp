---
theme: dashboard
title: buoy analysis
toc: true
---

<style>
  .swell-list { margin: 0.25em 0 0 1.1em; padding: 0; }
  .swell-list li { margin: 0.15em 0; }
  .muted { color: var(--theme-foreground-muted); }
  .time-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em; }
  .time-controls form { width: auto; }
</style>

# Buoy Analysis

Conditions from the Pauwela buoy (NDBC 51205), off Maui's North Shore: the latest readings, or any time back to ${fmt.date(BUOY_DATA_START)}.

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, fetchSwellSpectrumWindow, fetchSwellPartitionWindow, fetchBuoySnapshot, hasBuoyData, buoySite, runMidpoint, BUOY_DATA_START, toHstParam, parseHstParam, spectrumSampleTime, reportTimes} from "./components/data.js";
import {renderSpectrumHistogram, renderSpectrumWaterfall, readingNear} from "./components/spectrum.js";
import {partitionReading, spectralPartitions, spectrumSimilarity, swellKJShares} from "./components/spectral-partitions.js";
import {renderPartitionBubbles, renderPartitionCompass} from "./components/partitions.js";
import {swellLine, primaryLine, compassValues, buoyComparison} from "./components/buoy-snapshot.js";
import {timePicker} from "./components/time-picker.js";
import {renderSwellEnergy, wavePower} from "./components/swell-energy.js";

const COLORS = {view: "#3b82f6", time: "hsl(280, 70%, 60%)", runA: "hsl(140, 80%, 45%)", runB: "hsl(30, 85%, 55%)"};
const shortStamp = fmt.minuteStamp;
```

```js
// The moment the page is looking at: null means live (the latest readings).
// Seeded from ?t= so a particular time can be linked to.
const viewTime = Mutable(parseHstParam(new URLSearchParams(location.search).get("t")));
// Anything at or past now is just live.
const setViewTime = t => { viewTime.value = t == null || +t >= Date.now() ? null : new Date(t); };
```

```js
// An arbitrary time to compare against (?c=), alongside or instead of runs.
const compareTime = Mutable(parseHstParam(new URLSearchParams(location.search).get("c")));
const setCompareTime = t => { compareTime.value = t == null ? null : new Date(Math.min(+t, Date.now())); };
```

```js
{
  const input = timePicker({label: "View time", value: viewTime, min: BUOY_DATA_START, max: new Date(), onChange: setViewTime});
  const step = hours => setViewTime(new Date((viewTime ?? new Date()).getTime() + hours * 3600 * 1000));
  const button = (label, onclick, disabled = false) =>
    Object.assign(html`<button>${label}</button>`, {onclick, disabled});
  display(html`<div class="time-controls">
    ${input}
    ${button("◀ 1 h", () => step(-1))}
    ${button("1 h ▶", () => step(1), viewTime == null)}
    ${button("Latest", () => setViewTime(null), viewTime == null)}
    <span class="muted">${viewTime ? "" : "Showing the latest readings."}</span>
  </div>`);
}
```

```js
const lookbackHours = view(Inputs.select([6, 12, 24, 48, 72], {
  label: "Lookback window",
  format: h => `${h} hours`,
  value: 24
}));
```

```js
const windowEnd = viewTime ?? new Date();
const windowStart = new Date(windowEnd.getTime() - lookbackHours * 3600 * 1000);
const [swell, swellSpectrum] = await Promise.all([
  fetchSwellPartitionWindow("pauwela", windowStart, windowEnd),
  fetchSwellSpectrumWindow("pauwela", windowStart, windowEnd)
]);

// The latest readings in the window, i.e. as of the view time.
const latest = swell.findLast(d => d.values.some(v => v.rank === 1)) ?? null;
const latestSpectrumReading = readingNear(swellSpectrum);
const latestPartitions = partitionReading(latestSpectrumReading);
const viewLabel = viewTime ? shortStamp(viewTime) : "Latest";
// NDBC stamps spectra with an hourly slot; show when they were measured.
const knownReports = reportTimes(swell);
const sampleTime = ts => spectrumSampleTime(ts, knownReports);
const now = {
  label: viewLabel,
  primary: latest?.values.find(v => v.rank === 1) ?? null,
  primaryTs: latest?.ts ?? null,
  spectrum: latestSpectrumReading,
  spectrumTs: latestSpectrumReading[0]?.ts ?? null,
  sampleTs: latestSpectrumReading[0] ? sampleTime(latestSpectrumReading[0].ts) : null,
};
const latestKJ = swellKJShares(latestPartitions, now.primary?.surflineKJ);
```

## Conditions ${viewTime ? `at ${shortStamp(viewTime)}` : "(latest)"}

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Overall Sea State</h2>
    <span class="big">${now.primary ? primaryLine(now.primary) : "No data for this time"}</span>
    <div class="muted" style="margin-top: 0.25em;">
      ${now.primaryTs ? `NDBC's summary of the ${fmt.minuteStamp(now.primaryTs)} reading` : ""}
    </div>
    ${latestSpectrumReading.length > 0 ? html`<div style="margin-top: 0.25em;">Wave power ${wavePower(latestSpectrumReading).toFixed(1)} kW/m <span class="muted">(energy flux per meter of wave crest)</span></div>` : ""}
    <h2 style="margin-top: 1em;">Swell Systems</h2>
    ${
      latestPartitions.length > 0
        ? html`<ul class="swell-list">${latestPartitions.map((d, i) => html`<li>${swellLine(d, latestKJ[i])}</li>`)}</ul>
          <div class="muted" style="margin-top: 0.5em; font-size: 0.85em;">Split out of the spectrum measured at ${fmt.clock(now.sampleTs)}, by direction and period.</div>`
        : html`<p>No spectral data for this time.</p>`
    }
  </div>
  <div class="card">${
    now.primary || latestPartitions.length > 0
      ? resize(renderPartitionCompass(compassValues(now, latestPartitions), {
          title: `Swell Direction — ${fmt.clock(now.sampleTs ?? now.primaryTs)}`
        }))
      : html`<p>No data for this time.</p>`
  }
  <div class="muted" style="font-size: 0.85em;">Arrows point the way the swell is travelling, from the direction it comes from. Distance out is period; the dashed gray arrow is NDBC's overall reading.</div>
  </div>
</div>

<div class="card">${
  latestSpectrumReading.length > 0
    ? resize(renderSpectrumHistogram(latestSpectrumReading, {
        title: `Spectral Energy — measured ${fmt.minuteStamp(now.sampleTs)}`,
        partitions: latestPartitions
      }))
    : html`<p>No spectral data in this window.</p>`
}</div>

<div class="card">${
  swellSpectrum.length > 0
    ? resize(renderSpectrumWaterfall(swellSpectrum, {
        title: `Spectral Energy Over Time`,
        onSelect: setViewTime,
        sampleTime
      }))
    : html`<p>No spectral data in this window.</p>`
}</div>

## Leading Up

${viewTime ? `The ${lookbackHours} hours before ${shortStamp(viewTime)}` : `The last ${lookbackHours} hours`}. Each distinct swell system over time: size is height, vertical position is period, color is the direction it comes from. The arrows point the way it travels.

<div class="card">${
  swellSpectrum.length > 0
    ? resize(renderPartitionBubbles(spectralPartitions(swellSpectrum), { height: 380 }))
    : html`<p>No spectral data in this window.</p>`
}</div>

<div class="card">${
  swellSpectrum.length > 0 || swell.length > 0
    ? resize(renderSwellEnergy(spectralPartitions(swellSpectrum), swell, {
        runKJ: runSnapshots.map(d => d.snapshot?.primary?.surflineKJ)
      }))
    : html`<p>No energy readings in this window.</p>`
}
<div class="muted" style="font-size: 0.85em;">Surfline-style kJ: height² × period², so long-period swell counts for a lot more. The line is the total; the bars split it by swell, colored by direction. The shaded band is what you've usually been out in (mid-run, middle half of your North Shore runs).</div>
</div>

## Compare

Compare ${viewTime ? "the view time" : "the latest readings"} with another time or with runs (up to two at once).

```js
{
  const input = timePicker({label: "Compare with a time", value: compareTime, min: BUOY_DATA_START, max: new Date(), onChange: setCompareTime});
  const clear = Object.assign(html`<button>Clear</button>`, {onclick: () => setCompareTime(null), disabled: compareTime == null});
  display(html`<div class="time-controls">${input}${clear}</div>`);
}
```

```js
const compareSnapshot = compareTime ? await fetchBuoySnapshot(compareTime) : null;
```

```js
const allRuns = await fetchMeta(() => FileAttachment("data/runs.csv"));
const runSnapshots = await Promise.all(
  allRuns.filter(hasBuoyData).map(meta => fetchBuoySnapshot(runMidpoint(meta), buoySite(meta)).then(snapshot => ({meta, snapshot})))
);
```

```js
const compareRows = runSnapshots
  .filter(d => d.snapshot && d.snapshot.spectrum.length > 0)
  .map(({meta, snapshot}) => ({
    id: meta.id,
    meta,
    snapshot,
    when: meta.ts,
    route: `${meta.start_beach} → ${meta.end_beach}`,
    distance_km: meta.distance_km,
    duration_sec: meta.duration_sec,
    paddle_ups: meta.paddle_up_count,
    first_paddle_up_m: meta.distance_to_first_paddle_up,
    foil: meta.foil,
    // Heart rate while foiling.
    min_hr: meta.min_foiling_hr,
    avg_hr: meta.avg_foiling_hr,
    conditions: snapshot.primary ? primaryLine(snapshot.primary) : "",
    kj: snapshot.primary?.surflineKJ ?? null,
    similarity: latestSpectrumReading.length > 0 ? spectrumSimilarity(latestSpectrumReading, snapshot.spectrum) : null,
  }));
```

```js
// Rebuilt whenever the view time changes (the match column depends on it),
// so the selection is read back from the URL each time.
const initialIds = (() => {
  const params = new URLSearchParams(location.search);
  return [params.get("a"), params.get("b")].filter(Boolean);
})();
const runTable = Inputs.table(compareRows, {
  columns: ["when", "route", "distance_km", "duration_sec", "paddle_ups", "first_paddle_up_m", "min_hr", "avg_hr", "foil", "kj", "conditions", "similarity"],
  header: {
    when: "Run",
    route: "Route",
    distance_km: "km",
    duration_sec: "Duration",
    foil: "Foil",
    paddle_ups: "Paddle ups",
    first_paddle_up_m: "1st PU (m)",
    min_hr: "Min HR",
    avg_hr: "Avg HR",
    kj: "kJ",
    conditions: "Buoy at mid-run",
    similarity: viewTime ? "Match to view" : "Match to latest",
  },
  format: {
    when: (d, i, data) => html`<a href="run.html?id=${data[i].id}">${shortStamp(d)}</a>`,
    distance_km: d => d.toFixed(1),
    duration_sec: d => `${Math.floor(d / 3600)}:${String(Math.floor((d % 3600) / 60)).padStart(2, "0")}`,
    first_paddle_up_m: d => d == null ? "" : d.toFixed(0),
    min_hr: d => d == null ? "" : Math.round(d),
    avg_hr: d => d == null ? "" : Math.round(d),
    kj: d => d == null ? "" : Math.round(d),
    similarity: d => d == null ? "" : `${Math.round(d * 100)}%`,
  },
  // Size columns to their contents; with this many it scrolls sideways on
  // narrow screens rather than truncating headers.
  layout: "auto",
  sort: initialIds.length ? "when" : "similarity",
  reverse: true,
  multiple: true,
  required: false,
  value: initialIds.map(id => compareRows.find(d => d.id === id)).filter(Boolean),
  rows: 12,
});
const selectedRuns = view(runTable);
```

```js
// The picked runs in the order they were picked: the URL's a/b order for
// runs already there, newly ticked ones after. The order decides which run
// is first (green) here and on compare.html, so links between the two
// pages keep each run's color. (The table itself only reports its
// selection in table order.)
const pickedIds = (() => {
  const params = new URLSearchParams(location.search);
  const before = [params.get("a"), params.get("b")].filter(Boolean);
  const now = selectedRuns.map(d => d.id);
  return [...before.filter(id => now.includes(id)), ...now.filter(id => !before.includes(id))].slice(0, 2);
})();
```

```js
// Whether the URL has been brought in line with the page yet. The first
// sync (on load) only tidies the URL; after that, changes add history
// entries. This cell has no inputs, so it runs once.
const urlSync = {loaded: false};
```

```js
// Keep the view time, compare time and run selection in the URL so any of
// it can be linked to. Each change adds a history entry, so Back steps back
// through the times viewed and runs picked (see the popstate handlers
// below).
{
  const current = new URLSearchParams(location.search);
  const params = new URLSearchParams(location.search);
  for (const k of ["t", "c", "a", "b"]) params.delete(k);
  if (viewTime) params.set("t", toHstParam(viewTime));
  if (compareTime) params.set("c", toHstParam(compareTime));
  const ids = pickedIds;
  if (ids[0]) params.set("a", ids[0]);
  if (ids[1]) params.set("b", ids[1]);
  // Colons are fine in a query string; leaving them unescaped keeps the
  // times readable (t=2026-10-02T18:56).
  const qs = params.toString().replace(/%3A/gi, ":");
  const url = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) {
    if (urlSync.loaded) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
  urlSync.loaded = true;
}
```

```js
// Back/Forward: put the times back the way the URL now has them. That
// changes viewTime/compareTime, whose URL then already matches, so nothing
// new is pushed.
{
  const onPop = () => {
    const params = new URLSearchParams(location.search);
    setViewTime(parseHstParam(params.get("t")));
    setCompareTime(parseHstParam(params.get("c")));
  };
  addEventListener("popstate", onPop);
  invalidation.then(() => removeEventListener("popstate", onPop));
}
```

```js
// Back/Forward for the run selection: tick the runs the URL now has. The
// table only changes when the user picks, so set it and announce it as an
// input; the URL already matches, so nothing new is pushed. (When a time
// changed too, the table is rebuilt from the URL anyway.)
{
  const onPop = () => {
    const params = new URLSearchParams(location.search);
    const ids = [params.get("a"), params.get("b")].filter(Boolean);
    const current = runTable.value.map(d => d.id);
    if (ids.length === current.length && ids.every(id => current.includes(id))) return;
    runTable.value = ids.map(id => compareRows.find(d => d.id === id)).filter(Boolean);
    runTable.dispatchEvent(new Event("input", {bubbles: true}));
  };
  addEventListener("popstate", onPop);
  invalidation.then(() => removeEventListener("popstate", onPop));
}
```

```js
const runLabel = r => `${fmt.date(r.meta.ts)} ${r.meta.start_beach} → ${r.meta.end_beach}`;
const picked = pickedIds.map(id => selectedRuns.find(d => d.id === id));
const timeItem = compareSnapshot?.spectrum.length > 0
  ? [{...compareSnapshot, label: shortStamp(compareTime), color: COLORS.time}]
  : [];
// The compare time comes first; runs fill the rest, up to two items.
const others = [
  ...timeItem,
  ...picked.map((r, i) => ({...r.snapshot, label: runLabel(r), color: i === 0 ? COLORS.runA : COLORS.runB, meta: r.meta})),
].slice(0, 2);
const comparison =
  others.length === 0 ? [] :
  others.length === 1 ? [{...now, label: viewLabel, color: COLORS.view}, others[0]] :
  others;
const droppedRun = timeItem.length > 0 && picked.length === 2;
```

<div>${
  comparison.length === 0
    ? html`<p class="muted">${compareTime && !timeItem.length ? "No buoy spectra near that time." : ""}</p>`
    : html`${picked.length === 2 && !timeItem.length
        ? html`<p><a href="compare.html?id1=${picked[0].id}&id2=${picked[1].id}">Compare these two runs in full</a> (tracks, speed, wind and buoy).</p>`
        : ""}${droppedRun ? html`<p class="muted">Showing the time and the first run picked.</p>` : ""}${buoyComparison(comparison, {resize, runKJ: runSnapshots.map(d => d.snapshot?.primary?.surflineKJ)})}`
}</div>
