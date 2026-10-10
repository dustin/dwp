---
theme: dashboard
title: compare downwind runs
toc: true
---

<style>
  .run1 {
    color: hsl(140, 80%, 45%);
    font-weight: 600;
  }
  .run2 {
    color: hsl(30, 85%, 55%);
    font-weight: 600;
  }
</style>

```js
import {renderRun, findCallouts, findFastest1kSegment} from "./components/map.js";
import {compareColorizers, FOIL_THRESHOLD_KPH} from "./components/color.js";
import {windRoseOrigin, windRoseScale, addWindRose, WIND_SPEED_COLORS} from "./components/wind-rose.js";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";
import {fetchMeta, riderFile, rider, RIDERS, withRider, fetchRun, fetchWind, fetchSwell, toRelative} from "./components/data.js";
import {primarySwell} from "./components/swell.js";
import {fetchBuoySnapshot, hasBuoyData, buoySite, runMidpoint, BUOY_DATA_START} from "./components/data.js";
import {buoyComparison} from "./components/buoy-snapshot.js";

const urlParams = new URLSearchParams(window.location.search);

const id1 = urlParams.get("id1");
const id2 = urlParams.get("id2");

// r1/r2 name each run's rider (default: this site's), so two riders who
// rode together can be compared.
const r1 = RIDERS.includes(urlParams.get("r1")) ? urlParams.get("r1") : rider;
const r2 = RIDERS.includes(urlParams.get("r2")) ? urlParams.get("r2") : rider;
const runsOf = who => fetchMeta(() => riderFile('runs.csv', FileAttachment('data/runs.csv'), who))
  .then(data => withRider(data, who));
const [runs1, runs2] = await Promise.all([runsOf(r1), r2 === r1 ? null : runsOf(r2)]);
const byId = rows => Object.fromEntries(rows.map(r => [r.id, r]));
const meta1 = byId(runs1)[id1], meta2 = byId(runs2 ?? runs1)[id2];
const csvFetches = [meta1, meta2].map(fetchRun);
// Two riders: name them; one rider: tell the runs apart by date.
const together = r1 !== r2;
const cap = s => s[0].toUpperCase() + s.slice(1);
const label1 = together ? cap(r1) : fmt.timestamp(meta1.ts);
const label2 = together ? cap(r2) : fmt.timestamp(meta2.ts);
const theFoil = (m, cls) => /^unknown/.test(m.foil)
  ? html`an <span class=${cls}>unknown foil</span>`
  : html`the <span class=${cls}>${m.foil}</span>`;

const runMeta1 = meta1;
const runMeta2 = meta2;

const windFetches = [meta1, meta2].map(m => fetchWind(m).then(toRelative));
const swellFetches = [meta1, meta2].map(m => fetchSwell(m).then(primarySwell).then(toRelative));
// Buoy conditions at each run's midpoint (null where there's no buoy data).
const buoyFetches = [runMeta1, runMeta2].map(m =>
  hasBuoyData(m) ? fetchBuoySnapshot(runMidpoint(m), buoySite(m)) : Promise.resolve(null)
);
```

# ${together ? html`<span class="run1">${label1}</span> and <span class="run2">${label2}</span> on ${fmt.date(runMeta1.ts)}, ${runMeta1.start_beach} → ${runMeta1.end_beach}` : html`Comparing a run on <span class="run1">${fmt.date(runMeta1.ts)}</span> to a run on <span class="run2">${fmt.date(runMeta2.ts)}</span>`}

<div>On ${theFoil(runMeta1, "run1")} and ${theFoil(runMeta2, "run2")} · ${html`<a href="comparetrack.html?id1=${id1}&id2=${id2}">Open map</a>`}</div>

${Object.assign(html`<button title="Swap which run is first (and which color each gets)">⇄ Swap</button>`, {
  // A new page load with id1/id2 exchanged; Back undoes it.
  onclick: () => {
    const params = new URLSearchParams(location.search);
    params.set("id1", id2);
    params.set("id2", id1);
    if (together) {
      params.set("r1", r2);
      params.set("r2", r1);
    }
    location.assign(`${location.pathname}?${params}${location.hash}`);
  }
})}

```js
const [runCsv1, runCsv2] = await Promise.all(csvFetches);

const colorizers = compareColorizers(runCsv1, runCsv2);

// Riding together: at each moment both were recording, how much further
// down the course rider 1 was. Progress is each position projected onto
// the line from rider 1's first point to their last, so GPS distance
// differences between devices (and wiggles) don't count.
const gap = (() => {
  if (!together) return [];
  const pts = runCsv1.filter(d => d.lat != null);
  if (pts.length < 2) return [];
  const [s0, s1] = [pts[0], pts[pts.length - 1]];
  const kx = 111320 * Math.cos(s0.lat * Math.PI / 180), ky = 110540;
  const ux = (s1.lon - s0.lon) * kx, uy = (s1.lat - s0.lat) * ky;
  const len = Math.hypot(ux, uy);
  const along = d => ((d.lon - s0.lon) * kx * ux + (d.lat - s0.lat) * ky * uy) / len;
  const bis = d3.bisector(d => d.ts).left;
  const other = runCsv2.filter(d => d.lat != null);
  return pts.filter((d, i) => i % 5 === 0).flatMap(d => {
    const i = bis(other, d.ts);
    return i > 0 && i < other.length ? [{ts: d.ts, gap: along(d) - along(other[i])}] : [];
  });
})();
// Stats that come from the GPS track are empty for a run entered by hand.
const known = (v, f) => (v == null || Number.isNaN(v) ? "—" : f(v));
// Mean speed over the points on foil, as on the run page.
const foilSpeed = csv => d3.mean(csv, d => (d.speed > FOIL_THRESHOLD_KPH ? d.speed : undefined));
const [foilSpeed1, foilSpeed2] = [runCsv1, runCsv2].map(foilSpeed);

const fastestSegments = [
  findFastest1kSegment(runCsv1),
  findFastest1kSegment(runCsv2),
];

const callouts = [[runMeta1, runCsv1], [runMeta2, runCsv2]].flatMap(([m,c,i]) => findCallouts(m, c, fastestSegments));
const [wind1, wind2] = await windFetches;
const [swell1, swell2] = await swellFetches;

function aRose(d3, svg, width, height, wind, idx, colors, off) {
  const scale = windRoseScale(width);
  const { centerX, centerY } = windRoseOrigin(16, 130, off, scale);
  const inset = addWindRose(d3, svg, wind, {
    x: centerX,
    y: centerY,
    title: "Wind Speed " + idx + " (knots)",
    scheme: [0, 15, 20, 25, 30].map(colors),
    scale
  });
  return {
    updateOnZoom: null,
    update: () => {
      inset.update({ x: centerX, y: centerY });
    }
  };
}
```

<div class="card">${resize(width => renderRun(width, [runCsv1, runCsv2], callouts, {
  colorizers: colorizers,
  additionalMarks: ({ d3, svg, width, height }) => {
    // Riders out together had the same wind, so one rose does.
    if (together) {
      const scale = windRoseScale(width);
      const { centerX, centerY } = windRoseOrigin(16, 130, 0, scale);
      addWindRose(d3, svg, wind1, {x: centerX, y: centerY, title: "Wind (avg)", scheme: WIND_SPEED_COLORS, scale});
      return;
    }
    aRose(d3, svg, width, height, wind1, 1, colorizers[0], 0);
    aRose(d3, svg, width, height, wind2, 2, colorizers[1], 300)
  },
  fastestSegments: fastestSegments,
}))}</div>

## At a Glance

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">
      <span class="run1">${fmt.seconds(runMeta1.duration_sec)}</span>
      /<br/>
      <span class="run2">${fmt.seconds(runMeta2.duration_sec)}</span>
    </span>
  </div>

  <div class="card">
      <h2>Time on Foil</h2>
      <span class="big">
          <span class="run1">${known(runMeta1.duration_on_foil, d => `${fmt.seconds(d)} (${(runMeta1.pct_time_on_foil * 100).toFixed(0)}%)`)}</span>
          /<br/>
          <span class="run2">${known(runMeta2.duration_on_foil, d => `${fmt.seconds(d)} (${(runMeta2.pct_time_on_foil * 100).toFixed(0)}%)`)}</span>
      </span>
  </div>

  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">
      <span class="run1">${runMeta1.distance_km.toFixed(2)} km</span>
      /<br/>
      <span class="run2">${runMeta2.distance_km.toFixed(2)} km</span>
    </span>
  </div>

  <div class="card">
    <h2>Distance Traveled on Foil</h2>
    <span class="big">
      <span class="run1">
        ${known(runMeta1.distance_on_foil, d => `${(d / 1000).toFixed(2)} km (${(runMeta1.pct_dist_on_foil * 100).toFixed(0)}%)`)}
      </span>
      /<br/>
      <span class="run2">
        ${known(runMeta2.distance_on_foil, d => `${(d / 1000).toFixed(2)} km (${(runMeta2.pct_dist_on_foil * 100).toFixed(0)}%)`)}
      </span>
    </span>
  </div>

  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">
      <span class="run1">${known(runMeta1.longest_segment_distance, d => `${(d / 1000).toFixed(2)} km`)}</span>
      /<br/>
      <span class="run2">${known(runMeta2.longest_segment_distance, d => `${(d / 1000).toFixed(2)} km`)}</span>
    </span>
  </div>

  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">
      <span class="run1">${known(runMeta1.max_distance, d => `${(d / 1000).toFixed(2)} km`)}</span>
      /<br/>
      <span class="run2">${known(runMeta2.max_distance, d => `${(d / 1000).toFixed(2)} km`)}</span>
    </span>
  </div>

  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">
      <span class="run1">${runMeta1.paddle_up_count || 0}</span>
      /<br/>
      <span class="run2">${runMeta2.paddle_up_count || 0}</span>
    </span>
  </div>

  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">
      <span class="run1">${known(runMeta1.max_speed_1k, fmt.pace)}</span>
      /<br/>
      <span class="run2">${known(runMeta2.max_speed_1k, fmt.pace)}</span>
    </span>
  </div>

  <div class="card">
    <h2>Average Foiling Speed</h2>
    <span class="big">
      <span class="run1">${known(foilSpeed1, d => `${fmt.speed(d)} (${fmt.pace(d)})`)}</span>
      /<br/>
      <span class="run2">${known(foilSpeed2, d => `${fmt.speed(d)} (${fmt.pace(d)})`)}</span>
    </span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">
      <span class="run1">${runMeta1.max_speed_kmh.toFixed(2)} kph</span>
      /<br/>
      <span class="run2">${runMeta2.max_speed_kmh.toFixed(2)} kph</span>
    </span>
  </div>

  <div class="card">
    <h2>Min Foiling Heart Rate</h2>
    <span class="big">
      <span class="run1">${known(runMeta1.min_foiling_hr, fmt.hr)}</span>
      /<br/>
      <span class="run2">${known(runMeta2.min_foiling_hr, fmt.hr)}</span>
    </span>
  </div>

  <div class="card">
    <h2>Average Foiling Heart Rate</h2>
    <span class="big">
      <span class="run1">${known(runMeta1.avg_foiling_hr, fmt.hr)}</span>
      /<br/>
      <span class="run2">${known(runMeta2.avg_foiling_hr, fmt.hr)}</span>
    </span>
  </div>

</div>

<div>${together ? html`<h2>Who's Ahead</h2>
<div class="card">${resize(width => Plot.plot({
  title: `Distance ${label1} is ahead of ${label2} (negative: behind)`,
  width, height: 240,
  x: {type: "time", label: null},
  y: {label: "meters", grid: true},
  marks: [
    Plot.ruleY([0]),
    Plot.areaY(gap, {x: "ts", y: d => Math.max(0, d.gap), fill: "hsl(140, 80%, 45%)", fillOpacity: 0.3}),
    Plot.areaY(gap, {x: "ts", y: d => Math.min(0, d.gap), fill: "hsl(30, 85%, 55%)", fillOpacity: 0.3}),
    Plot.lineY(gap, {x: "ts", y: "gap", strokeWidth: 1.5}),
    Plot.tip(gap, Plot.pointerX({x: "ts", y: "gap",
      title: d => `${fmt.timestamp(d.ts)}\n${d.gap >= 0 ? label1 : label2} ahead by ${Math.abs(d.gap).toFixed(0)} m`}))
  ]
}))}</div>` : ""}</div>

## Speed

<div class="card">${
resize(width => Plot.plot({
    title: "Speed",
    width, x: {tickFormat: fmt.distanceM},
    marks: [
        Plot.lineY(runCsv1, { x: "distance", y: "speed", stroke: "green",
                             opacity: 0.5, strokeWidth: 1 }),
        Plot.lineY(runCsv1, { x: "distance", y: "avg_speed_1k", stroke: "green",
                              opacity: 1, strokeWidth: 2 }),
        Plot.crosshair(runCsv1, {x: "distance", y: "speed"}),
        Plot.lineY(runCsv2, { x: "distance", y: "speed", stroke: "orange",
                             opacity: 0.5, strokeWidth: 1 }),
        Plot.lineY(runCsv2, { x: "distance", y: "avg_speed_1k", stroke: "orange",
                                                   opacity: 1, strokeWidth: 2 }),
        Plot.crosshair(runCsv2, {x: "distance", y: "speed"}),
        Plot.tip(runCsv1, Plot.pointer({
            x: "distance",
            y: "speed", fontSize: 15,
        }))
    ]
}))
}</div>

## Conditions

```js
const windymax = Math.max(
  d3.max(wind1, d => Math.max(d.wavg, d.wgust)),
  d3.max(wind2, d => Math.max(d.wavg, d.wgust))
) * 1.1;

const swellymax = Math.max(
  d3.max(swell1, d => d.wave_height),
  d3.max(swell2, d => d.wave_height)
) * 1.1;
```

```js
// Same run, same wind: the charts would just repeat each other.
const windChart = (w, other, idx, label) => w?.length > 0 && other?.length > 0
  ? resize(width => Plot.plot({
      title: `Wind Speed (${label})`,
      width,
      color: { legend: false },
      y: { domain: [0, windymax], label: "knots" },
      x: { tickFormat: d => fmt.seconds(d / 1000) },
      marks: tl.makeWindMarks(w, other, idx, `wind${idx + 1}`, colorizers),
    }))
  : html`<p>No wind data found for this run.</p>`;
if (!together) display(html`<div class="grid grid-cols-2">
  <div class="card">${windChart(wind1, wind2, 0, label1)}</div>
  <div class="card">${windChart(wind2, wind1, 1, label2)}</div>
</div>`);
```

<div>${
  // Swell height comes from the Pauwela buoy (North Shore only), and each
  // chart overlays the other run's swell, so it needs data for both runs.
  !(swell1?.length > 0 && swell2?.length > 0) ? "" : html`<div class="grid grid-cols-2">
<div class="card">${
  swell1 && swell2 && swell1.length > 0 && swell2.length > 0
    ? resize((width) => {
        return Plot.plot({
          title: `Swell Height (${label1})`,
          width,
          color: { legend: false },
          y: { domain: [0, swellymax], label: "feet" },
          x: { tickFormat: d => fmt.seconds(d / 1000) },
          marks: tl.makeSwellMarks(swell1, swell2, 0, "swell1", colorizers),
        });
      })
    : html`<p>No swell data found for this run.</p>`
}</div>
<div class="card">${
  swell1 && swell2 && swell1.length > 0 && swell2.length > 0
    ? resize((width) => {
        return Plot.plot({
          title: `Swell Height (${label2})`,
          width,
          color: { legend: false },
          y: { domain: [0, swellymax], label: "feet" },
          x: { tickFormat: d => fmt.seconds(d / 1000) },
          marks: tl.makeSwellMarks(swell2, swell1, 1, "swell2", colorizers),
        });
      })
    : html`<p>No swell data found for this run.</p>`
}</div>
</div>`
}</div>

```js
const buoySnapshots = (await Promise.all(buoyFetches))
  .map((snapshot, i) => {
    const meta = [runMeta1, runMeta2][i];
    return snapshot && {
      ...snapshot,
      meta,
      label: `${fmt.date(meta.ts)} ${meta.start_beach} \u2192 ${meta.end_beach}`,
      color: ["hsl(140, 80%, 45%)", "hsl(30, 85%, 55%)"][i],
    };
  });
```

<div>${
  // The Pauwela buoy only describes North Shore conditions, so the whole
  // section is skipped unless at least one run is on the North Shore.
  [runMeta1, runMeta2].every(m => buoySite(m) == null) ? "" : html`
<h2 id="buoy">Buoy</h2>
${buoySnapshots.every(s => s == null)
  ? html`<p>No Pauwela buoy spectra for these runs (captured since ${fmt.date(BUOY_DATA_START)}).</p>`
  : html`${buoySnapshots.some(s => s == null)
      ? html`<p>Only one of these runs has Pauwela buoy spectra.</p>`
      : html`<p>Spectral swell partitions from the Pauwela buoy at each run's midpoint. See also <a href="buoy.html?a=${id1}&b=${id2}#compare">this comparison on the buoy page</a>.</p>`
    }${buoyComparison(buoySnapshots.filter(Boolean), {resize})}`}`
}</div>

## Splits

```js
function pace(speed) {
  return (60/speed);
}

const splits1 = tl.computeSplits(runCsv1);
const splits2 = tl.computeSplits(runCsv2);

const maxSplitY = Math.max(
  ...splits1.map(d => d.max_speed),
  ...splits2.map(d => d.max_speed)
);

const maxPaceY = Math.min(5, Math.max(
  ...splits1.map(d => d.avg_pace),
  ...splits2.map(d => d.avg_pace)
));

const maxHRY = Math.max(
  ...splits1.map(d => d.max_hr),
  ...splits2.map(d => d.max_hr)
);
```

<div class="grid grid-cols-2">
<div class="card">${
resize((width) => Plot.plot({
      title: `Speed (${label1})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxSplitY] },
      marks: [
        Plot.rect(splits1,{x:"split",y1:"min_speed",y2:"max_speed", fill: "green", opacity: 0.2,
          title: d => `${d.min_speed.toFixed(2)} - ${d.max_speed.toFixed(2)} kph\n${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph avg`
        }),
        Plot.line(splits1, {x: "split", y: "avg_speed", stroke: "green", strokeWidth: 2}),
        Plot.line(splits2, {x: "split", y: "avg_speed", stroke: "orange", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>
<div class="card">${
  resize((width) => Plot.plot({
      title: `Speed (${label2})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxSplitY] },
      marks: [
        Plot.rect(splits2,{x:"split",y1:"min_speed",y2:"max_speed", fill: "orange", opacity: 0.2,
          title: d => `${d.min_speed.toFixed(2)} - ${d.max_speed.toFixed(2)} kph\n${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph avg`
        }),
        Plot.line(splits2, {x: "split", y: "avg_speed", stroke: "orange", strokeWidth: 2}),
        Plot.line(splits1, {x: "split", y: "avg_speed", stroke: "green", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>
</div>

<div class="grid grid-cols-2">

<div class="card">${
resize((width) => Plot.plot({
      title: `Pace (${label1})`,
      color: { legend: true },
      clip: true,
      width, x: { interval: 1, label: "km" }, y: { domain: [1, maxPaceY] },
      marks: [
      Plot.line(splits1, {x: "split", y: "avg_pace", stroke: "green", strokeWidth: 2}),
      Plot.line(splits2, {x: "split", y: "avg_pace", stroke: "orange", strokeWidth: 2, strokeDasharray: "4,4"}),
        Plot.barY(splits1,{x:"split",y:"avg_pace", fill: "green", opacity: 0.2,
          title: (d => `${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph`) }),
      ]
    })
    )
}</div>
<div class="card">${
  resize((width) => Plot.plot({
      title: `Pace (${label2})`,
      color: { legend: true },
      clip: true,
      width, x: { interval: 1, label: "km" }, y: { domain: [1, maxPaceY] },
      marks: [
        Plot.barY(splits2,{x:"split",y:"avg_pace", fill: "orange", opacity: 0.2,
          title: (d => `${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph`) }),
          Plot.line(splits2, {x: "split", y: "avg_pace", stroke: "orange", strokeWidth: 2}),
          Plot.line(splits1, {x: "split", y: "avg_pace", stroke: "green", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>

</div>

<div class="grid grid-cols-2">

<div class="card">${
resize((width) => Plot.plot({
      title: `Heart Rate (${label1})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxHRY] },
      marks: [
        Plot.rect(splits1,{x:"split",y1:"min_hr",y2:"max_hr", fill: 'green', opacity: 0.2,
          title: d => `${d.min_hr} - ${d.max_hr} bpm`
        }),
        Plot.line(splits1, {x: "split", y: "avg_hr", stroke: "green", strokeWidth: 2}),
        Plot.line(splits2, {x: "split", y: "avg_hr", stroke: "darkorange", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>
<div class="card">${
  resize((width) => Plot.plot({
      title: `Heart Rate (${label2})`,
      color: { legend: true },
      width, x: { interval: 1, label: "km" }, y: { domain: [0, maxHRY] },
      marks: [
        Plot.rect(splits2,{x:"split",y1:"min_hr",y2:"max_hr", fill: 'darkorange', opacity: 0.2,
          title: d => `${d.min_hr} - ${d.max_hr} bpm`
        }),
        Plot.line(splits2, {x: "split", y: "avg_hr", stroke: "darkorange", strokeWidth: 2}),
        Plot.line(splits1, {x: "split", y: "avg_hr", stroke: "green", strokeWidth: 2, strokeDasharray: "4,4"})
      ]
    })
    )
}</div>

</div>
