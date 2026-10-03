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
import {fetchMeta, fetchSwellSpectrumWindow, fetchSwellPartitionWindow, fetchBuoySnapshot, hasBuoyData, buoySite, runMidpoint, BUOY_DATA_START, toHstParam, parseHstParam} from "./components/data.js";
import {renderSpectrumHistogram, renderSpectrumWaterfall, readingNear} from "./components/spectrum.js";
import {partitionReading, spectralPartitions, spectrumSimilarity} from "./components/spectral-partitions.js";
import {renderPartitionBubbles, renderPartitionCompass} from "./components/partitions.js";
import {swellLine, primaryLine, compassValues, buoyComparison} from "./components/buoy-snapshot.js";
import {timePicker} from "./components/time-picker.js";

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
const viewLabel = viewTime ? shortStamp(viewTime) : "Now";
const now = {
  label: viewLabel,
  primary: latest?.values.find(v => v.rank === 1) ?? null,
  primaryTs: latest?.ts ?? null,
  spectrum: latestSpectrumReading,
  spectrumTs: latestSpectrumReading[0]?.ts ?? null,
};
```

## Conditions ${viewTime ? `at ${shortStamp(viewTime)}` : "now"}

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Overall Sea State</h2>
    <span class="big">${now.primary ? primaryLine(now.primary) : "No data for this time"}</span>
    <div class="muted" style="margin-top: 0.25em;">
      ${now.primaryTs ? `NDBC summary as of ${fmt.timestamp(now.primaryTs)}` : ""}
    </div>
    <h2 style="margin-top: 1em;">Swell Systems</h2>
    ${
      latestPartitions.length > 0
        ? html`<ul class="swell-list">${latestPartitions.map(d => html`<li>${swellLine(d)}</li>`)}</ul>
          <div class="muted" style="margin-top: 0.5em; font-size: 0.85em;">Split out of the ${fmt.time(now.spectrumTs)} spectrum by direction and period.</div>`
        : html`<p>No spectral data for this time.</p>`
    }
  </div>
  <div class="card">${
    now.primary || latestPartitions.length > 0
      ? resize(renderPartitionCompass(compassValues(now, latestPartitions), {
          title: `Swell Direction — ${fmt.time(now.spectrumTs ?? now.primaryTs)}`
        }))
      : html`<p>No data for this time.</p>`
  }
  <div class="muted" style="font-size: 0.85em;">Arrows point the way the swell is travelling, from the direction it comes from. Distance out is period; the dashed gray arrow is NDBC's overall reading.</div>
  </div>
</div>

<div class="card">${
  latestSpectrumReading.length > 0
    ? resize(renderSpectrumHistogram(latestSpectrumReading, {
        title: `Spectral Energy — ${fmt.timestamp(now.spectrumTs)}`,
        partitions: latestPartitions
      }))
    : html`<p>No spectral data in this window.</p>`
}</div>

<div class="card">${
  swellSpectrum.length > 0
    ? resize(renderSpectrumWaterfall(swellSpectrum, {
        title: `Spectral Energy Over Time — newest in front, colored by direction; click an older one to view that time`,
        onSelect: setViewTime
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

## Compare

Compare ${viewTime ? "the view time" : "now"} with another time, or with North Shore runs, ranked below by how closely the buoy spectrum at mid-run matches ${viewTime ? "the view time" : "now"}: the same energy at the same periods from the same directions. Pick up to two things to compare; with only one, it's compared with ${viewTime ? "the view time" : "now"}.

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
    conditions: snapshot.primary ? primaryLine(snapshot.primary) : "",
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
const selectedRuns = view(Inputs.table(compareRows, {
  columns: ["when", "route", "distance_km", "conditions", "similarity"],
  header: {when: "Run", route: "Route", distance_km: "km", conditions: "Buoy at mid-run", similarity: viewTime ? "Match to view" : "Match to now"},
  format: {
    when: d => shortStamp(d),
    distance_km: d => d.toFixed(1),
    similarity: d => d == null ? "" : `${Math.round(d * 100)}%`,
  },
  width: {when: 140, route: 220, distance_km: 50, similarity: 90},
  sort: initialIds.length ? "when" : "similarity",
  reverse: true,
  multiple: true,
  required: false,
  value: initialIds.map(id => compareRows.find(d => d.id === id)).filter(Boolean),
  rows: 12,
}));
```

```js
// Keep the view time, compare time and run selection in the URL so any of
// it can be linked to. Changing a time adds a history entry, so Back steps
// back through the times viewed (see the popstate handler below); ticking
// runs in the table just updates the current entry.
{
  const current = new URLSearchParams(location.search);
  const params = new URLSearchParams(location.search);
  for (const k of ["t", "c", "a", "b"]) params.delete(k);
  if (viewTime) params.set("t", toHstParam(viewTime));
  if (compareTime) params.set("c", toHstParam(compareTime));
  const ids = selectedRuns.map(d => d.id).slice(0, 2);
  if (ids[0]) params.set("a", ids[0]);
  if (ids[1]) params.set("b", ids[1]);
  // Colons are fine in a query string; leaving them unescaped keeps the
  // times readable (t=2026-10-02T18:56).
  const qs = params.toString().replace(/%3A/gi, ":");
  const url = `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`;
  const timeChanged = ["t", "c"].some(k => (current.get(k) ?? "") !== (params.get(k) ?? ""));
  if (url !== `${location.pathname}${location.search}${location.hash}`) {
    if (timeChanged) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
  }
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
const runLabel = r => `${fmt.date(r.meta.ts)} ${r.meta.start_beach} → ${r.meta.end_beach}`;
const picked = selectedRuns.slice(0, 2).sort((a, b) => a.when - b.when);
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
    ? html`<p class="muted">${compareTime && !timeItem.length ? "No buoy spectra near that time. " : ""}Pick a time or select a run above to compare.</p>`
    : html`${picked.length === 2 && !timeItem.length
        ? html`<p><a href="compare.html?id1=${picked[0].id}&id2=${picked[1].id}">Compare these two runs in full</a> (tracks, speed, wind and buoy).</p>`
        : ""}${droppedRun ? html`<p class="muted">Comparing the time with the earlier run; clear the time to compare the two runs.</p>` : ""}${buoyComparison(comparison, {resize})}`
}</div>
