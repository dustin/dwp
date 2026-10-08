---
title: compare track
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
  .track-bar-compare .track-title { display: flex; flex-direction: column; gap: 2px; }
  .track-route { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track-sub { color: #bbb; font-size: 12px; font-weight: 400; margin-left: 0.4em; }
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
  .track-readout-compare { flex-direction: column; gap: 2px; }
  .track-readout-compare b { font-size: 15px; }
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
  /* Which run a callout belongs to, matching that run's track color. */
  .track-callout-run1 { border-color: hsl(140, 80%, 45%); }
  .track-callout-run1::after { border-top-color: hsl(140, 80%, 45%); }
  .track-callout-run2 { border-color: hsl(30, 85%, 55%); }
  .track-callout-run2::after { border-top-color: hsl(30, 85%, 55%); }
  .track-buoy { padding: 0; border: 0; background: none; cursor: pointer; pointer-events: none; }
  .track-buoy svg { display: block; overflow: visible; }
  .track-buoy svg > * { pointer-events: visiblePainted; }
  .track-wind-area {
    position: absolute;
    left: 8px;
    top: calc(max(env(safe-area-inset-top), 8px) + 76px);
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
  .track-wind { background: rgba(17, 17, 17, 0.6); border-radius: 8px; padding: 4px; display: flex; flex-direction: column; gap: 4px; }
  .track-wind[hidden] { display: none; }
  .track-wind svg { display: block; }
  /* Keep Mapbox's controls clear of the bars. */
  .track-app .mapboxgl-ctrl-top-right { top: calc(max(env(safe-area-inset-top), 8px) + 68px); }
  .track-app .mapboxgl-ctrl-bottom-left { bottom: calc(var(--track-panel-height, 140px) - 6px); }
</style>

```js
import {fetchMeta, fetchRun, fetchWind, fetchSwell} from "./components/data.js";
import {compareTrackViewer} from "./components/compare-track-viewer.js";
import {findCallouts, findFastest1kSegment} from "./components/map.js";
import {compareColorizers} from "./components/color.js";
import {summarizeSwellPartition, formatIndividualSwells, representativeSwellReading, PAUWELA_BUOY} from "./components/swell.js";
import * as fmt from "./components/formatters.js";
import _ from "npm:lodash";

const allRuns = await fetchMeta(() => FileAttachment("data/runs.csv"));
const runMetaMap = allRuns.reduce((m, r) => { m[r.id] = r; return m; }, {});

const urlParams = new URLSearchParams(location.search);
const id1 = urlParams.get("id1");
const id2 = urlParams.get("id2");
const runMeta1 = runMetaMap[id1] ?? _.maxBy(allRuns, d => d.ts);
const runMeta2 = runMetaMap[id2] ?? _.maxBy(allRuns, d => d.ts);
const metas = [runMeta1, runMeta2];

const [runCsv1, runCsv2, wind1, wind2, swell1, swell2] = await Promise.all([
  fetchRun(runMeta1), fetchRun(runMeta2),
  fetchWind(runMeta1), fetchWind(runMeta2),
  fetchSwell(runMeta1), fetchSwell(runMeta2),
]);
const runs = [runCsv1, runCsv2];
const winds = [wind1, wind2];
const swells = [swell1, swell2];

const colorizers = compareColorizers(runCsv1, runCsv2);
const fastestSegments = runs.map(findFastest1kSegment);
// The same callouts as the run page's map (run.md), per run, tagged with
// which run they belong to so the marker is colored to match.
const callouts = metas.flatMap((m, i) =>
  findCallouts(m, runs[i], [fastestSegments[i]]).map(c => ({ ...c, run: i }))
);

// The Pauwela buoy only describes North Shore conditions. Both runs share
// the same buoy location, so at most one marker is drawn; its text lists
// whichever run(s) qualify, and its arrows come from the first that does.
const swellReadings = metas.map((m, i) => (m.region === "Maui North Shore" ? representativeSwellReading(swells[i], m) : null));
const firstReading = swellReadings.find(Boolean);
const buoy = firstReading && {
  ...PAUWELA_BUOY,
  summary: summarizeSwellPartition(firstReading.values),
  text: swellReadings
    .map((r, i) =>
      r
        ? `🌊 Pauwela buoy (run ${i + 1}), ${fmt.time(r.ts)}:\n${formatIndividualSwells(new Map(swells[i].map(({ ts, values }) => [ts.getTime(), values])), r.ts)}`
        : null
    )
    .filter(Boolean)
    .join("\n\n"),
};

const anyTrack = runs.some(r => r.filter(d => d.lat != null && d.lon != null).length > 0);
const pointsArr = runs.map(r => r.filter(d => d.lat != null && d.lon != null));

display(anyTrack
  ? compareTrackViewer(metas, pointsArr, colorizers, {
      invalidation,
      backHref: `compare.html?id1=${runMeta1.id}&id2=${runMeta2.id}`,
      callouts,
      fastestSegments,
      winds,
      buoy,
    })
  : html`<p style="padding: 1em">No track for either run. <a href="compare.html?id1=${runMeta1.id}&id2=${runMeta2.id}">Back to the comparison</a></p>`);
```
