---
title: together track
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
  /* A rider's callout, ringed in their color. */
  .track-callout[style*="--c"] { border-color: var(--c); }
  .track-callout[style*="--c"]::after { border-top-color: var(--c); }
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
import {fetchMeta, riderFile, rider, ridersWith, withRider, fetchRun, fetchWind, fetchTogether} from "./components/data.js";
import {compareTrackViewer} from "./components/compare-track-viewer.js";
import {findCallouts, findFastest1kSegment} from "./components/map.js";
import {createColorizer} from "./components/color.js";
import * as fmt from "./components/formatters.js";

// The same riders as together.html (?id= or ?runs=rider:id,...).
const urlParams = new URLSearchParams(location.search);
const together = (await ridersWith("together")).map(r => r.rider);
const picked = urlParams.get("runs")
  ? urlParams.get("runs").split(",").map(s => s.split(":")).filter(([r]) => r === rider || together.includes(r))
  : [[rider, urlParams.get("id")],
     ...((await fetchTogether()).get(urlParams.get("id")) ?? []).map(t => [t.other_rider, t.other_id])];
const lists = new Map(await Promise.all([...new Set(picked.map(([r]) => r))].map(async r =>
  [r, new Map(withRider(await fetchMeta(() => riderFile('runs.csv', r)), r).map(m => [m.id, m]))])));
const metas = picked.map(([r, id]) => lists.get(r).get(id)).filter(Boolean);
const csvs = await Promise.all(metas.map(fetchRun));
const wind = await fetchWind(metas[0]);

// Same hues as together.html.
const HUES = [140, 30, 210, 280, 340, 55];
const hue = i => HUES[i % HUES.length];
const colors = metas.map((m, i) => `hsl(${hue(i)}, 80%, 55%)`);
const cap = s => s[0].toUpperCase() + s.slice(1);
const names = metas.map(m => cap(m.rider));
const colorizers = csvs.map((c, i) => createColorizer(c, hue(i)));
const fastestSegments = csvs.map(findFastest1kSegment);
const callouts = metas.flatMap((m, i) =>
  findCallouts(m, csvs[i], [fastestSegments[i]])
    .filter(c => !["💯", "🎉"].includes(c.icon))
    .map(c => ({...c, run: i, color: colors[i], text: `${names[i]}: ${c.text}`})));
const pointsArr = csvs.map(r => r.filter(d => d.lat != null && d.lon != null));
const back = `together.html?${urlParams}`;
const first = metas[0];
const titles = [
  html`<div class="track-route">${first.start_beach} → ${first.end_beach} <span class="track-sub">${fmt.date(first.ts)}</span></div>`,
  html`<div class="track-route" style="font-weight: 400">${metas.map((m, i) => html`<b style=${`color: ${colors[i]}`}>${names[i]}</b> `)}</div>`,
];

display(pointsArr.some(p => p.length)
  ? compareTrackViewer(metas, pointsArr, colorizers, {
      invalidation, backHref: back, backLabel: "Back to rode together",
      callouts, fastestSegments, winds: [wind], colors, names, titles, sameClock: true, trailSec: 180,
    })
  : html`<p style="padding: 1em">No tracks for these runs. <a href=${back}>Back</a></p>`);
```
