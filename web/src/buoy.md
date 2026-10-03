---
theme: dashboard
title: buoy analysis
toc: true
---

<style>
  .swell-list { margin: 0.25em 0 0 1.1em; padding: 0; }
  .swell-list li { margin: 0.15em 0; }
  .muted { color: var(--theme-foreground-muted); }
</style>

# Buoy Analysis

Live conditions from the Pauwela buoy (NDBC 51205), off Maui's North Shore.

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, fetchSwellSpectrumWindow, fetchSwellPartitionWindow, fetchBuoySnapshot, hasBuoyData, buoySite, runMidpoint} from "./components/data.js";
import {renderSpectrumHeatmap, renderDirectionalSpectrogram, renderSpectrumHistogram, readingNear} from "./components/spectrum.js";
import {partitionReading, spectralPartitions, spectrumSimilarity} from "./components/spectral-partitions.js";
import {renderPartitionBubbles, renderPartitionCompass} from "./components/partitions.js";
import {swellLine, primaryLine, compassValues, buoyComparison} from "./components/buoy-snapshot.js";
```

```js
const lookbackHours = view(Inputs.select([6, 12, 24, 48, 72], {
  label: "Lookback window",
  format: h => `${h} hours`,
  value: 24
}));
```

```js
const windowEnd = new Date();
const windowStart = new Date(windowEnd.getTime() - lookbackHours * 3600 * 1000);
const [swell, swellSpectrum] = await Promise.all([
  fetchSwellPartitionWindow("pauwela", windowStart, windowEnd),
  fetchSwellSpectrumWindow("pauwela", windowStart, windowEnd)
]);

const latest = swell.findLast(d => d.values.some(v => v.rank === 1)) ?? null;
const latestSpectrumReading = readingNear(swellSpectrum);
const latestPartitions = partitionReading(latestSpectrumReading);
const now = {
  label: "Now",
  primary: latest?.values.find(v => v.rank === 1) ?? null,
  primaryTs: latest?.ts ?? null,
  spectrum: latestSpectrumReading,
  spectrumTs: latestSpectrumReading[0]?.ts ?? null,
};
```

## Current Conditions

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Overall Sea State</h2>
    <span class="big">${now.primary ? primaryLine(now.primary) : "No recent data"}</span>
    <div class="muted" style="margin-top: 0.25em;">
      ${now.primaryTs ? `NDBC summary as of ${fmt.timestamp(now.primaryTs)}` : ""}
    </div>
    <h2 style="margin-top: 1em;">Swell Systems</h2>
    ${
      latestPartitions.length > 0
        ? html`<ul class="swell-list">${latestPartitions.map(d => html`<li>${swellLine(d)}</li>`)}</ul>
          <div class="muted" style="margin-top: 0.5em; font-size: 0.85em;">Split out of the ${fmt.time(now.spectrumTs)} spectrum by direction and period.</div>`
        : html`<p>No recent spectral data.</p>`
    }
  </div>
  <div class="card">${
    now.primary || latestPartitions.length > 0
      ? resize(renderPartitionCompass(compassValues(now, latestPartitions), {
          title: `Swell Direction — ${fmt.time(now.spectrumTs ?? now.primaryTs)}`
        }))
      : html`<p>No recent data.</p>`
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

## Over the Last ${lookbackHours} Hours

Each distinct swell system over time: size is height, vertical position is period, color is the direction it comes from. The arrows point the way it travels.

<div class="card">${
  swellSpectrum.length > 0
    ? resize(renderPartitionBubbles(spectralPartitions(swellSpectrum), { height: 380 }))
    : html`<p>No spectral data in this window.</p>`
}</div>

The two spectrograms below show the same readings, colored by energy and then by the direction each period's energy comes from. Swells arriving from different directions at similar periods show up as different colors stacked close together.

<div class="card">${
  swellSpectrum.length > 0
    ? resize(renderSpectrumHeatmap(swellSpectrum, { height: 320 }))
    : html`<p>No spectral data in this window.</p>`
}</div>

<div class="card">${
  swellSpectrum.length > 0
    ? resize(renderDirectionalSpectrogram(swellSpectrum, { height: 320 }))
    : html`<p>No spectral data in this window.</p>`
}</div>

## Compare

North Shore runs with buoy data, ranked by how closely the buoy spectrum at mid-run matches now: the same energy at the same periods from the same directions. Select one run to compare it with now, or two to compare them with each other.

```js
const allRuns = await fetchMeta(() => FileAttachment("data/runs.csv"));
const buoyRuns = allRuns.filter(hasBuoyData);
const runSnapshots = await Promise.all(
  buoyRuns.map(meta => fetchBuoySnapshot(runMidpoint(meta), buoySite(meta)).then(snapshot => ({meta, snapshot})))
);
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

const urlParams = new URLSearchParams(window.location.search);
const initialIds = [urlParams.get("a"), urlParams.get("b")].filter(Boolean);
```

```js
const selectedRuns = view(Inputs.table(compareRows, {
  columns: ["when", "route", "distance_km", "conditions", "similarity"],
  header: {when: "Run", route: "Route", distance_km: "km", conditions: "Buoy at mid-run", similarity: "Match to now"},
  format: {
    when: d => fmt.timestamp(d).slice(0, 16),
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
// Keep the selection in the URL so a comparison can be linked to.
{
  const params = new URLSearchParams(window.location.search);
  params.delete("a");
  params.delete("b");
  const ids = selectedRuns.map(d => d.id).slice(0, 2);
  if (ids[0]) params.set("a", ids[0]);
  if (ids[1]) params.set("b", ids[1]);
  const qs = params.toString();
  history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
```

```js
const runLabel = r => `${fmt.date(r.meta.ts)} ${r.meta.start_beach} → ${r.meta.end_beach}`;
const picked = selectedRuns.slice(0, 2).sort((a, b) => a.when - b.when);
const comparison =
  picked.length === 0 ? [] :
  picked.length === 1
    ? [
        {...now, label: "Now", color: "#3b82f6"},
        {...picked[0].snapshot, label: runLabel(picked[0]), color: "hsl(140, 80%, 45%)", meta: picked[0].meta},
      ]
    : picked.map((r, i) => ({
        ...r.snapshot,
        label: runLabel(r),
        color: i === 0 ? "hsl(140, 80%, 45%)" : "hsl(30, 85%, 55%)",
        meta: r.meta,
      }));
```

<div>${
  comparison.length === 0
    ? html`<p class="muted">Select a run above to compare it with now.</p>`
    : html`${picked.length === 2
        ? html`<p><a href="compare.html?id1=${picked[0].id}&id2=${picked[1].id}">Compare these two runs in full</a> (tracks, speed, wind and buoy).</p>`
        : ""}${buoyComparison(comparison, {resize})}`
}</div>
