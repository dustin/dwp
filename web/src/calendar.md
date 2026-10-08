---
theme: dashboard
title: calendar
toc: false
---

```js
import {fetchMeta} from "./components/data.js";
import {regionList, regionColorScale} from "./components/regions.js";
import {runCalendar, isReverse, REVERSE_MIN_KM} from "./components/calendar.js";

const allRuns = await fetchMeta(() => FileAttachment("data/runs.csv"));
const regions = regionList(allRuns);
const regionColor = regionColorScale(allRuns);
const reverseCount = allRuns.filter(isReverse).length;
```

# When I Was Out

<div class="cal-legend">
  ${regions.map(r => html`<span><span class="cal-swatch" style=${`background:${regionColor(r)}`}></span> ${r}</span>`)}
  <span><svg width="14" height="12"><path d="M7,1L13,11L1,11Z" fill="var(--theme-foreground-faint)" stroke="var(--theme-foreground)"/></svg> reverse Kihei run (${reverseCount})</span>
  <span class="muted">dot size = distance</span>
</div>

```js
display(runCalendar(allRuns, regionColor));
```

<style>
.cal-legend { display: flex; flex-wrap: wrap; gap: 0.4rem 1.2rem; font-size: 0.85rem; margin-bottom: 1rem; align-items: center; }
.cal-legend span { display: inline-flex; gap: 0.35rem; align-items: center; }
.cal-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
.cal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1.25rem 1rem; }
.cal-month svg { display: block; overflow: visible; width: 100%; max-width: 260px; height: auto; }
.cal-title { font-size: 12px; font-weight: 600; fill: var(--theme-foreground); }
.cal-sum { font-size: 10px; fill: var(--theme-foreground-muted); }
.cal-dow { font-size: 9px; text-anchor: middle; fill: var(--theme-foreground-faint); }
.cal-num { font-size: 8px; text-anchor: middle; fill: var(--theme-foreground-faint); }
.cal-day { fill: var(--theme-foreground-faintest); }
.cal-day.on { fill: none; }
.cal-rev { stroke: var(--theme-foreground); stroke-width: 1; }
</style>
