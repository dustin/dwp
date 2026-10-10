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
  .track-details { color: #bbb; font-size: 12px; margin: -2px 0 6px; font-variant-numeric: tabular-nums; }
  .track-info .mapboxgl-popup-content {
    color: #111;
    font-size: 13px;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: pre-line;
  }
  .track-info.mapboxgl-popup-anchor-left .mapboxgl-popup-tip { border-right-color: rgba(17, 17, 17, 0.9); }
  .track-info.mapboxgl-popup-anchor-right .mapboxgl-popup-tip { border-left-color: rgba(17, 17, 17, 0.9); }
  .track-callout {
    width: 30px;
    height: 30px;
    margin-bottom: 7px;
    padding: 0;
    border: 1.5px solid #333;
    border-radius: 50%;
    background: #fff;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  /* The tail pointing at the spot. */
  .track-callout::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -8px;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top: 5px solid #333;
  }
  .track-buoy { padding: 0; border: 0; background: none; cursor: pointer; pointer-events: none; }
  .track-buoy svg { display: block; overflow: visible; }
  .track-buoy svg > * { pointer-events: visiblePainted; }
  .track-wind-area {
    position: absolute;
    left: 8px;
    top: calc(max(env(safe-area-inset-top), 8px) + 60px);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .track-wind-toggle {
    font: 600 12px var(--sans-serif);
    color: #fff;
    background: rgba(17, 17, 17, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 14px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .track-wind-toggle[aria-pressed="true"] { background: rgba(255, 255, 255, 0.85); color: #111; }
  .track-wind { background: rgba(17, 17, 17, 0.6); border-radius: 8px; padding: 4px; }
  .track-wind[hidden] { display: none; }
  .track-wind svg { display: block; }
  /* Keep Mapbox's controls clear of the bars. */
  .track-app .mapboxgl-ctrl-top-right { top: calc(max(env(safe-area-inset-top), 8px) + 52px); }
  .track-app .mapboxgl-ctrl-bottom-left { bottom: calc(var(--track-panel-height, 140px) - 6px); }
</style>

```js
import {fetchMeta, riderFile, fetchRun, fetchWind, fetchSwell} from "./components/data.js";
import {trackViewer} from "./components/track-viewer.js";
import {findCallouts, findFastest1kSegment} from "./components/map.js";
import {summarizeSwellPartition, formatIndividualSwells, representativeSwellReading, PAUWELA_BUOY} from "./components/swell.js";
import * as fmt from "./components/formatters.js";

const allRuns = await fetchMeta(() => riderFile('runs.csv', FileAttachment("data/runs.csv")));
const id = new URLSearchParams(location.search).get("id");
const meta = allRuns.find(d => d.id === id) ?? d3.greatest(allRuns, d => d.ts);
const [run, wind, swell] = await Promise.all([fetchRun(meta), fetchWind(meta), fetchSwell(meta)]);
const points = run.filter(d => d.lat != null && d.lon != null);

// The same annotations as the run page's map (run.md).
const fastestSegment = findFastest1kSegment(points);
const callouts = findCallouts(meta, points, [fastestSegment]);
const swellReading = meta.region === "Maui North Shore" ? representativeSwellReading(swell, meta) : null;
const buoy = swellReading && {
  ...PAUWELA_BUOY,
  summary: summarizeSwellPartition(swellReading.values),
  text: `🌊 Pauwela buoy, ${fmt.time(swellReading.ts)}:\n${formatIndividualSwells(new Map(swell.map(({ts, values}) => [ts.getTime(), values])), swellReading.ts)}`,
};

display(points.length > 0
  ? trackViewer(meta, points, {invalidation, backHref: `run.html?id=${meta.id}`, callouts, fastestSegment, wind, buoy})
  : html`<p style="padding: 1em">No track for this run. <a href="run.html?id=${meta.id}">Back to the run</a></p>`);
```
