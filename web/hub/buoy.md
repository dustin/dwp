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
import {fetchSwellSpectrumWindow, fetchSwellPartitionWindow, fetchBuoySnapshot, BUOY_DATA_START, toHstParam, parseHstParam, spectrumSampleTime, reportTimes} from "./components/data.js";
import {renderSpectrumHistogram, renderSpectrumWaterfall, readingNear} from "./components/spectrum.js";
import {partitionReading, spectralPartitions, swellKJShares} from "./components/spectral-partitions.js";
import {renderPartitionBubbles, renderPartitionCompass} from "./components/partitions.js";
import {swellLine, primaryLine, compassValues, buoyComparison} from "./components/buoy-snapshot.js";
import {timePicker} from "./components/time-picker.js";
import {renderSwellEnergy, wavePower} from "./components/swell-energy.js";

const COLORS = {view: "#3b82f6", time: "hsl(280, 70%, 60%)"};
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
// A time to compare against (?c=).
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
  <div class="muted" style="font-size: 0.85em;">Arrows point the way the swell is travelling. Distance out is period; the dashed gray arrow is NDBC's overall reading.</div>
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
    ? resize(renderSwellEnergy(spectralPartitions(swellSpectrum), swell))
    : html`<p>No energy readings in this window.</p>`
}
<div class="muted" style="font-size: 0.85em;">Surfline-style kJ: height² × period², so long-period swell counts for a lot more. The line is the total; the bars split it by swell, colored by direction.</div>
</div>

## Compare

Compare ${viewTime ? "the view time" : "the latest readings"} with another time.

```js
{
  const input = timePicker({label: "Compare with a time", value: compareTime, min: BUOY_DATA_START, max: new Date(), onChange: setCompareTime});
  const clear = Object.assign(html`<button>Clear</button>`, {onclick: () => setCompareTime(null), disabled: compareTime == null});
  // Quick pick: 24 hours before the reading being shown, not the view time
  // (or now), which can run an hour or more ahead of the latest spectrum.
  // Its hourly slot, so the nearest slot a day earlier is the same one.
  const yesterday = Object.assign(html`<button>This time yesterday</button>`, {
    onclick: () => setCompareTime(new Date((now.spectrumTs ?? viewTime ?? new Date()).getTime() - 24 * 3600 * 1000))
  });
  display(html`<div class="time-controls">${input}${yesterday}${clear}</div>`);
}
```

```js
const compareSnapshot = compareTime ? await fetchBuoySnapshot(compareTime) : null;
```

```js
// Whether the URL has been brought in line with the page yet. The first
// sync (on load) only tidies the URL; after that, changes add history
// entries. This cell has no inputs, so it runs once.
const urlSync = {loaded: false};
```

```js
// Keep the view and compare times in the URL so either can be linked to.
// Each change adds a history entry, so Back steps back through the times
// viewed (see the popstate handler below).
{
  const params = new URLSearchParams(location.search);
  for (const k of ["t", "c"]) params.delete(k);
  if (viewTime) params.set("t", toHstParam(viewTime));
  if (compareTime) params.set("c", toHstParam(compareTime));
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
const comparison = compareSnapshot?.spectrum.length > 0
  ? [{...now, label: viewLabel, color: COLORS.view}, {...compareSnapshot, label: shortStamp(compareTime), color: COLORS.time}]
  : [];
```

<div>${
  comparison.length === 0
    ? html`<p class="muted">${compareTime ? "No buoy spectra near that time." : ""}</p>`
    : buoyComparison(comparison, {resize})
}</div>
