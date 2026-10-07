---
theme: dashboard
title: tides
toc: false
---

<style>
  .tide-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 1em; }
  .tide-head h2 { margin: 0; }
  .tide-now { font-weight: 600; }
  .muted { color: var(--theme-foreground-muted); }
</style>

# Tides

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
for (const spot of SPOTS) {
  const ex = extremes[spot.station];
  display(html`<div class="card">
    <div class="tide-head">
      <h2>${spot.name}</h2>
      ${now >= start && now < end ? html`<span class="tide-now">${fmt.clock(now)} ${nowSummary(spot, ex, now)}</span>` : ""}
    </div>
    ${resize(width => renderTideChart(spot, ex, {start, end, now, width}))}
    <div class="muted">${STATIONS[spot.station].name}${spot.enough == null ? "" : ` · enough at ${spot.enough}′`}</div>
  </div>`);
}
```

<p class="muted">NOAA CO-OPS predictions, feet above MLLW.</p>
