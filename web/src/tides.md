---
theme: dashboard
title: Maui Tides
toc: false
---

<style>
  .tide-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 1em; }
  .tide-head h2 { margin: 0; }
  .tide-now { font-weight: 600; }
  .muted { color: var(--theme-foreground-muted); }
  .tide-region { margin: 1.2em 0 0.4em; }
  .tide-chart { position: relative; }
  .tide-handle {
    position: absolute; right: 0; transform: translateY(-50%);
    padding: 2px 8px; border-radius: 999px; cursor: ns-resize; touch-action: none; user-select: none;
    font: 600 12px var(--sans-serif); color: #fff; background: var(--theme-red, #ff725c);
  }
  .tide-handle.unset { opacity: 0.5; }
</style>

# Maui Tides

```js
import * as d3 from "npm:d3";
import * as fmt from "./components/formatters.js";
import {STATIONS, SPOTS, fetchExtremes, renderTideChart, nowSummary} from "./components/tides.js";
```

```js
const day = view(Inputs.date({label: "Day", value: d3.timeDay(new Date())}));
```

```js
// Inputs.date gives UTC midnight; we want that calendar day in local time.
const start = day ? new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) : d3.timeDay(new Date());
const end = d3.timeDay.offset(start, 1);
const now = new Date();
const stations = [...new Set(SPOTS.map(s => s.station))];
const extremes = Object.fromEntries(await Promise.all(
  stations.map(async s => [s, await fetchExtremes(s, start, end)])
));
```

```js
// Each spot's "enough" level can be dragged by its handle; a level you
// set is remembered in this browser. Double-click the handle to reset.
const savedLevel = spot => { try { const v = localStorage.getItem(`tide-enough:${spot.name}`); return v == null ? null : +v; } catch { return null; } };
const saveLevel = (spot, v) => { try { v == null ? localStorage.removeItem(`tide-enough:${spot.name}`) : localStorage.setItem(`tide-enough:${spot.name}`, v); } catch {} };

const card = spot => {
  const ex = extremes[spot.station];
  let level = savedLevel(spot) ?? spot.enough;
  const head = html`<span class="tide-now"></span>`;
  const foot = html`<div class="muted"></div>`;
  const slot = html`<div></div>`;
  const handle = html`<div class="tide-handle" title="Drag to set your height; double-click to reset"></div>`;
  // The handle stays put across redraws so a drag keeps its pointer capture.
  const holder = html`<div class="tide-chart">${slot}${handle}</div>`;
  let svg = null;
  const draw = () => {
    const s = {...spot, enough: level};
    svg = renderTideChart(s, ex, {start, end, now, width: holder.clientWidth || 640});
    slot.replaceChildren(svg);
    head.textContent = now >= start && now < end ? `${fmt.clock(now)} ${nowSummary(s, ex, now)}` : "";
    foot.textContent = `${STATIONS[spot.station].name}${level == null ? "" : ` · enough at ${level.toFixed(1)}′`}`;
    // A spot without a level still gets a handle, parked at 1′, to add one.
    handle.textContent = level == null ? "⇕ set" : `⇕ ${level.toFixed(1)}′`;
    handle.classList.toggle("unset", level == null);
    handle.style.top = `${svg.scale("y").apply(level ?? 1)}px`;
  };
  const levelAt = clientY => {
    const y = svg.scale("y");
    const [lo, hi] = y.domain;
    const v = y.invert(clientY - svg.getBoundingClientRect().top);
    return Math.round(Math.min(hi, Math.max(lo, v)) * 10) / 10;
  };
  handle.onpointerdown = e => { handle.setPointerCapture(e.pointerId); e.preventDefault(); };
  handle.onpointermove = e => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const v = levelAt(e.clientY);
    if (v !== level) { level = v; draw(); }
  };
  handle.onpointerup = e => { handle.releasePointerCapture(e.pointerId); if (level !== (savedLevel(spot) ?? spot.enough)) saveLevel(spot, level === spot.enough ? null : level); };
  handle.ondblclick = () => { level = spot.enough; saveLevel(spot, null); draw(); };
  new ResizeObserver(() => draw()).observe(holder);
  requestAnimationFrame(draw);
  return html`<div class="card">
    <div class="tide-head"><h2>${spot.name}</h2>${head}</div>
    ${holder}
    ${foot}
  </div>`;
};
// Two charts a row per region, one on narrow screens.
for (const [region, spots] of d3.group(SPOTS, s => s.region)) {
  display(html`<h2 class="tide-region">${region}</h2>`);
  display(html`<div class="grid grid-cols-2">${spots.map(card)}</div>`);
}
```

<p class="muted">NOAA CO-OPS predictions, feet above MLLW.</p>
