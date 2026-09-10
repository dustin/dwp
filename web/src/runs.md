---
theme: dashboard
title: overlay downwind runs
toc: true
---

```js
import {renderRun, findCallouts, findFastest1kSegment} from "./components/map.js";
import _ from "npm:lodash";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";
import {csv} from "https://cdn.jsdelivr.net/npm/d3-fetch@3/+esm";
import {autoType} from "https://cdn.jsdelivr.net/npm/d3-dsv@3/+esm";
import {fetchMeta, fetchRun} from "./components/data.js";
import {beachColorScale} from "./components/beaches.js";
import {runsTableOptions} from "./components/runs-table.js";

const allRuns = await fetchMeta(() => FileAttachment('data/runs.csv'));

const beachColor = beachColorScale(allRuns);

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
const runLink = d => `/run.html?id=${d.id}`;
const selection = view(Inputs.table(allRuns.sort((a, b) => b.ts - a.ts), {
      ...runsTableOptions(beachColor, htl, {
        columns: [
          "date",
          "linkedDate",
          "region",
          "start_beach",
          "end_beach",
          "distance_km",
          "distance_on_foil",
          "duration_sec",
          "duration_on_foil",
          "max_speed_1k",
          "foil"
        ],
        linkHref: runLink
      }),
      required: false}))
```

```js
const csvs = await Promise.all(selection.map(d => fetchRun(d).then(r => ({id: d.id, ps: r}))));
const callouts = csvs.flatMap(o => findCallouts(runMetaMap[o.id], o.ps, [findFastest1kSegment(o.ps)]));
```

<div class="card">${resize(width => {
    if (csvs.length == 0) {
        return;
    }
    const fastestSegments = csvs.map(o => findFastest1kSegment(o.ps));
    return renderRun(width, csvs.map(c => c.ps), callouts, { fastestSegments: fastestSegments });
    })
}</div>
