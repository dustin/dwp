---
title: track
toc: false
sidebar: false
header: false
footer: false
pager: false
---

<style>
  /* The viewer covers the whole screen; nothing behind it should scroll. */
  html, body { overflow: hidden; overscroll-behavior: none; }
  #observablehq-main { margin: 0; padding: 0; min-height: 0; }
  .track-app {
    position: fixed;
    inset: 0;
    background: #111;
    color: #fff;
    font: 14px/1.3 var(--sans-serif);
  }
  .track-map { position: absolute; inset: 0; }
  .track-bar, .track-panel {
    position: absolute;
    left: 0;
    right: 0;
    background: rgba(17, 17, 17, 0.78);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .track-bar {
    top: 0;
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: max(env(safe-area-inset-top), 8px) 56px 8px 8px;
  }
  .track-app a.track-back, .track-app a.track-back:visited {
    color: #fff;
    text-decoration: none;
    font-size: 30px;
    line-height: 1;
    padding: 0 10px 4px;
  }
  .track-title { min-width: 0; }
  .track-route { font-weight: 600; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track-sub { color: #bbb; font-size: 12px; }
  .track-panel {
    bottom: 0;
    padding: 8px 12px max(env(safe-area-inset-bottom), 10px);
  }
  .track-readout {
    display: flex;
    justify-content: space-between;
    gap: 0.75em;
    font-variant-numeric: tabular-nums;
    margin-bottom: 6px;
  }
  .track-readout b { font-size: 17px; }
  .track-strip { touch-action: none; cursor: ew-resize; height: 64px; }
  .track-strip svg { display: block; }
  .track-note { color: #bbb; font-size: 13px; padding: 4px 0; }
  /* Keep Mapbox's controls clear of the bars. */
  .track-app .mapboxgl-ctrl-top-right { top: calc(max(env(safe-area-inset-top), 8px) + 52px); }
  .track-app .mapboxgl-ctrl-bottom-left { bottom: calc(max(env(safe-area-inset-bottom), 10px) + 104px); }
</style>

```js
import {fetchMeta, fetchRun} from "./components/data.js";
import {trackViewer} from "./components/track-viewer.js";
import _ from "npm:lodash";

const allRuns = await fetchMeta(() => FileAttachment("data/runs.csv"));
const id = new URLSearchParams(location.search).get("id");
const meta = allRuns.find(d => d.id === id) ?? _.maxBy(allRuns, d => d.ts);
const points = (await fetchRun(meta)).filter(d => d.lat != null && d.lon != null);
display(points.length > 0
  ? trackViewer(meta, points, {invalidation, backHref: `run.html?id=${meta.id}`})
  : html`<p style="padding: 1em">No track for this run. <a href="run.html?id=${meta.id}">Back to the run</a></p>`);
```
