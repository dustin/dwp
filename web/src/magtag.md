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
import { fetchSwellPartitionWindow, parseHstParam } from "./components/data.js";
import { renderMagTag } from "./components/magtag.js";

const viewTime = parseHstParam(new URLSearchParams(location.search).get("t"));
const end = viewTime ?? new Date();
const readings = await fetchSwellPartitionWindow("pauwela", new Date(+end - 25 * 3600 * 1000), end);
const canvas = html`<canvas class="magtag" width="296" height="128"></canvas>`;
renderMagTag(canvas, readings, {now: end});
document.documentElement.dataset.ready = "";
display(canvas);
```
