---
theme: dashboard
title: a downwind run
toc: true
---

```js
import {renderRun, findCallouts} from "./components/map.js";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";
import {csv} from "https://cdn.jsdelivr.net/npm/d3-fetch@3/+esm";
import {autoType} from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";
import {fetchMeta, fetchRun} from "./components/data.js";

const allRuns = await fetchMeta(() => FileAttachment('data/runs.csv'));

const beaches = [...new Set(allRuns.map(d => d.start_beach))].sort();
const beachColor = d3.scaleOrdinal(d3.schemeObservable10).domain(beaches);

const runMetaMap = allRuns.reduce((m, r) => {
  m[r.id] = r
  return m;
}, {});

const urlParams = new URLSearchParams(window.location.search);
const thisId = urlParams.get("id");

const runMeta = runMetaMap[thisId] || _.maxBy(allRuns, d => d.ts);
```

# Overlay All The Things

Select runs to map.

```js
const selection = view(Inputs.table(allRuns.sort((a, b) => b.ts - a.ts), {
    columns: [
      "date",
      "linkedDate",
      "start_beach",
      "end_beach",
      "distance_km",
      "distance_on_foil",
      "duration_sec",
      "duration_on_foil",
      "max_speed_1k",
      "foil"
    ],
    header: {
      date: "Date",
      linkedDate: "Time",
      start_beach: "Start Beach",
      end_beach: "End Beach",
      distance_km: "Run Distance (km)",
      distance_on_foil: "On Foil (km)",
      duration_sec: "Run Duration",
      duration_on_foil: "On Foil",
      max_speed_1k: "Fastest km Pace",
      foil: "Foil"
      },
      format: {
        date: fmt.date,
        linkedDate: d => htl.html`<a href="/compare.html?id1=${thisId}&id2=${d.id}">${fmt.time(d.date)}</a>`,
        distance_on_foil: d => (d / 1000).toFixed(2),
        duration_on_foil: fmt.seconds,
        duration_sec: fmt.seconds,
        start_beach: d => htl.html`<span style="color: ${beachColor(d)}">${d}</span>`,
        max_speed_1k: d => fmt.pace(d).split(' ')[0]
      },
      required: false}))
```

```js
const csvs = await Promise.all(selection.map(d => fetchRun(d.id).then(r => ({id: d.id, ps: r}))));
const callouts = csvs.flatMap(o => findCallouts(runMetaMap[o.id], o.ps));
```

<div class="card">${resize(width => {
    if (csvs.length == 0) {
        return;
    }
    return renderRun(width, csvs.map(c => c.ps), callouts, {});
    })
}</div>
