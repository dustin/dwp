---
theme: dashboard
title: buoy analysis
toc: true
---

# Buoy Analysis

Live conditions from the Pauwela buoy (NDBC 51205), off Maui's North Shore.

```js
import * as fmt from "./components/formatters.js";
import {fetchRecentSwellSpectrum, fetchRecentSwellPartition} from "./components/data.js";
import {summarizeSwellPartition, formatPrimaryLine, formatComponentLine} from "./components/swell.js";
import {renderSpectrumHeatmap, renderSpectrumHistogram, readingNear} from "./components/spectrum.js";
import {renderPartitionBubbles, renderPartitionCompass} from "./components/partitions.js";
```

```js
const lookbackHours = view(Inputs.select([6, 12, 24, 48, 72], {
  label: "Lookback window",
  format: h => `${h} hours`,
  value: 24
}));
```

```js
const [swell, swellSpectrum] = await Promise.all([
  fetchRecentSwellPartition(lookbackHours),
  fetchRecentSwellSpectrum(lookbackHours)
]);

const latest = swell.length > 0 ? swell[swell.length - 1] : null;
const latestSpectrumReading = readingNear(swellSpectrum);
```

## Current Conditions

<div class="grid grid-cols-2">
  <div class="card">
    <h2>Dominant Wave</h2>
    <span class="big">${
      latest
        ? formatPrimaryLine(summarizeSwellPartition(latest.values).primary)
        : "No recent data"
    }</span>
    <div style="margin-top: 0.5em; color: var(--theme-foreground-muted);">
      ${latest ? `as of ${fmt.time(latest.ts)}` : ""}
    </div>
  </div>
  <div class="card">
    <h2>Individual Swells</h2>
    ${
      latest
        ? html`<ul style="margin: 0.25em 0 0 1em;">${
            summarizeSwellPartition(latest.values).components.map(d => html`<li>${formatComponentLine(d)}</li>`)
          }</ul>`
        : html`<p>No recent data.</p>`
    }
  </div>
</div>

<div class="card">${
  latest
    ? resize(renderPartitionCompass(latest.values, { title: `Current Swell \u2014 ${fmt.time(latest.ts)}` }))
    : html`<p>No recent data.</p>`
}</div>

## Wave Partitions

CDIP-style view of each distinct wave system over time -- size is height, vertical position is period, color is direction.

<div class="card">${
  swell.length > 0
    ? resize(renderPartitionBubbles(swell, { height: 380 }))
    : html`<p>No swell partition data in this window.</p>`
}</div>

## Spectrum

CDIP-style spectral energy. The histogram below shows the most recent reading; the spectrogram shows how the spectrum has evolved across the lookback window.

<div class="card">${
  latestSpectrumReading.length > 0
    ? resize(renderSpectrumHistogram(latestSpectrumReading, {
        title: `Spectral Energy \u2014 ${fmt.time(latestSpectrumReading[0].ts)}`
      }))
    : html`<p>No spectral data in this window.</p>`
}</div>

<div class="card">${
  swellSpectrum.length > 0
    ? resize(renderSpectrumHeatmap(swellSpectrum, { height: 360 }))
    : html`<p>No spectral data in this window.</p>`
}</div>
