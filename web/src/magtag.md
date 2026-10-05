---
title: magtag
toc: false
sidebar: false
header: false
footer: false
pager: false
---

<style>
  /* Exactly the panel: 296×128, nothing around it. */
  html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
  #observablehq-main { margin: 0; padding: 0; min-height: 0; max-width: none; }
  #observablehq-center { margin: 0; padding: 0; }
  #observablehq-main > .observablehq { margin: 0; }
  .magtag { display: block; width: 296px; height: 128px; image-rendering: pixelated; }
</style>

```js
// The Pauwela buoy on an Adafruit MagTag: a 296×128 card in the panel's
// four greys. Screenshot it at 296×128 (device scale 1) once
// <html data-ready> is set. ?t=2026-10-02T18:56 (HST) shows that time
// instead of the latest reading.
import { fetchSwellPartitionWindow, fetchSwellSpectrumWindow, parseHstParam, reportTimes, spectrumSampleTime } from "./components/data.js";
import { readingNear } from "./components/spectrum.js";
import { partitionReading } from "./components/spectral-partitions.js";
import { renderMagTag } from "./components/magtag.js";

const viewTime = parseHstParam(new URLSearchParams(location.search).get("t"));
const end = viewTime ?? new Date();
const start = new Date(+end - 6 * 3600 * 1000);
const [swell, spectra] = await Promise.all([
  fetchSwellPartitionWindow("pauwela", start, end),
  fetchSwellSpectrumWindow("pauwela", start, end),
]);
const spectrum = readingNear(spectra);
// NDBC's overall reading closest to the spectrum shown (the latest, if
// there's no spectrum).
const overalls = swell.filter(d => d.values.some(v => v.rank === 1)).map(d => d.values.find(v => v.rank === 1));
const target = spectrum.length ? +spectrum[0].ts : +end;
const overall = overalls.reduce((best, d) => (best == null || Math.abs(d.ts - target) < Math.abs(best.ts - target) ? d : best), null);
const canvas = html`<canvas class="magtag" width="296" height="128"></canvas>`;
renderMagTag(canvas, {
  spectrum,
  partitions: partitionReading(spectrum),
  sampleTs: spectrum.length ? spectrumSampleTime(spectrum[0].ts, reportTimes(swell)) : null,
  overall,
  now: end,
});
document.documentElement.dataset.ready = "";
display(canvas);
```
