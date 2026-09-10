---
theme: dashboard
title: a downwind run
toc: true
---

```js
import {renderRun, findCallouts, createBuoySwellMarker, findFastest1kSegment} from "./components/map.js";
import {beachColorScale} from "./components/beaches.js";
import {runsTableOptions} from "./components/runs-table.js";
import {FOIL_THRESHOLD_KPH} from "./components/color.js";
import {windRoseOrigin, addWindRose, WIND_SPEED_COLORS} from "./components/wind-rose.js";
import {summarizeSwellPartition, formatPrimaryLine, formatComponentLine, formatIndividualSwells as formatSwells, representativeSwellReading, PAUWELA_BUOY} from "./components/swell.js";
import _ from "npm:lodash";
import * as fmt from "./components/formatters.js";
import * as tl from "./components/timeline.js";
import {fetchMeta, fetchRun, fetchWind, fetchSwell, fetchSwell2} from "./components/data.js";

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

# From ${runMeta.start_beach} to ${runMeta.end_beach}

<div>
    ${fmt.date(runMeta.ts)} at ${fmt.time(runMeta.ts)}
    on the ${runMeta.foil}
</div>

```js
const [runCsv, wind, swell, swell2] = await Promise.all([fetchRun(runMeta), fetchWind(runMeta), fetchSwell(runMeta), fetchSwell2(runMeta)]);

const fastestSegment = findFastest1kSegment(runCsv);

const callouts = findCallouts(runMeta, runCsv, [fastestSegment]);

const swellPartitionsByTimestamp = new Map(
  swell2.map(({ts, values}) => [ts.getTime(), values])
);

function formatIndividualSwells(ts) {
  return formatSwells(swellPartitionsByTimestamp, ts);
}
```

<div class="card">${resize(width => renderRun(width, [runCsv], callouts, {
  additionalMarks: ({ d3, svg, width, height }) => {
    const { size, centerX, centerY } = windRoseOrigin();
    const inset = addWindRose(d3, svg, wind, {
      x: centerX,
      y: centerY,
      title: "Wind (avg)",
      scheme: WIND_SPEED_COLORS
    });
    let buoyMarker = null;
    if (swell2.length > 0 && (runMeta.region === 'Maui North Shore')) {
      const reading = representativeSwellReading(swell2, runMeta);
      const summary = summarizeSwellPartition(reading.values);
      if (reading) {
        buoyMarker = createBuoySwellMarker(d3, svg, {
          lon: PAUWELA_BUOY.lon,
          lat: PAUWELA_BUOY.lat,
          summary: summary,
          tooltipText: `${fmt.time(reading.ts)}:\n${formatIndividualSwells(reading.ts)}`,
        });
      }
    }
    return {
      updateOnZoom: ({ transform, width, height }) => {
        buoyMarker?.update({ transform, width, height });
      },
      update: () => {
        inset.update({ x: centerX, y: centerY });
      }
    };
  },
  fastestSegments: [fastestSegment],
}))}</div>

## At a Glance

<div class="grid grid-cols-4">
  <div class="card">
    <h2>Total Time</h2>
    <span class="big">${fmt.seconds(runMeta.duration_sec)}</span>
  </div>
  <div class="card">
    <h2>Foiling Time</h2>
    <span class="big">
        ${fmt.seconds(runMeta.duration_on_foil)}
        (${(runMeta.pct_time_on_foil * 100).toFixed(0)}%)
    </span>
  </div>
  <div class="card">
    <h2>Distance Traveled</h2>
    <span class="big">${runMeta.distance_km.toFixed(2)} km</span>
  </div>
  <div class="card">
    <h2>Distance Traveled on Foil</h2>
    <span class="big">${(runMeta.distance_on_foil / 1000).toFixed(2)} km
        (${(runMeta.pct_dist_on_foil * 100).toFixed(0)}%)</span>
  </div>
  <div class="card">
    <h2>First Paddle Up</h2>
    <span class="big">${runMeta.distance_to_first_paddle_up ? (runMeta.distance_to_first_paddle_up).toFixed(0) + " meters" : "LOL"}</span>
  </div>
  <div class="card">
    <h2>Paddle Ups</h2>
    <span class="big">${runMeta.paddle_up_count || 0}</span>
  </div>

  <div class="card">
    <h2>Max Speed</h2>
    <span class="big">${runMeta.max_speed_kmh.toFixed(2)} kph</span>
  </div>
  <div class="card">
    <h2>Best 1k Pace</h2>
    <span class="big">${fmt.pace(runMeta.max_speed_1k)}</span>
  </div>
  <div class="card">
    <h2>Longest Continuous Foiling Segment</h2>
    <span class="big">
        ${(runMeta.longest_segment_distance / 1000).toFixed(2)} km
        / ${fmt.timeDiff(runMeta.longest_segment_start, runMeta.longest_segment_end)}
    </span>
  </div>
  <div class="card">
    <h2>Furthest From Land</h2>
    <span class="big">${(runMeta.max_distance / 1000).toFixed(2)} km</span>
  </div>
  <div class="card">
    <h2>Foiling Heart Rate</h2>
    <span class="big">${fmt.hr(runMeta.avg_foiling_hr || 0)} (min: ${fmt.hr(runMeta.min_foiling_hr || 0)})</span>
  </div>
  <div class="card">
      <h2>Conditions</h2>
      <span class="big">
          ${fmt.wind(runMeta.avg_wavg, runMeta.avg_wgust, runMeta.avg_wdir)}
      </span>
  </div>
</div>

## Speed

```js
const [onFoil, offFoil] = _.unzip(
  _.map(runCsv, d => {
    const on = d.speed > FOIL_THRESHOLD_KPH;
    return [ { ...d, speed: on ? d.speed : null, }, { ...d, speed: on ? null : d.speed }
    ]
  })
);

const segments = tl.computeSegments(runCsv);
```

<div class="card">${
    resize(width => Plot.plot({
        title: "Speed",
        width, x: {tickFormat: d3.timeFormat("%H:%M")},
        marks: [
            Plot.areaY(runCsv, { x: "ts", y: d => d.speed <= FOIL_THRESHOLD_KPH ? d.speed : null, fill: "#500", stroke: "none" }),
            Plot.areaY(runCsv, { x: "ts", y: d => d.speed > FOIL_THRESHOLD_KPH  ? d.speed : null, fill: "#030", stroke: "none" }),
            Plot.lineY(onFoil, { x: "ts", y: "speed", stroke: "#050" }),
            Plot.lineY(offFoil, { x: "ts", y: "speed", stroke: "#900" }),
            Plot.lineY(runCsv, { x: "ts", y: "avg_speed_1k", stroke: "#808",
                                 opacity: 0.5, strokeWidth: 5 }),
            Plot.crosshair(runCsv, {x: "ts", y: "speed"}),
            Plot.tip(runCsv, Plot.pointer({
                x: "ts",
                y: "speed", fontSize: 15,
                title: d => {
                    const seg = segments.find(s => d.ts >= s.start && d.ts <= s.end);
                    if (!seg) return null;
                    const speeds = seg.data.map(d => d.speed);
                    const hrs = seg.data.map(d => d.hr).filter(h => h !== null);
                    const [mindist, maxdist] = d3.extent(seg.data.map(d => d.distance));
                    const dist = maxdist - mindist;
                    const landdist = d3.mean(seg.data, d => d.distance_to_land);
                    const desc = [
                        `${seg.onFoil ? 'On' : 'Off'} foil segment`,
                        `Duration: ${fmt.timeDiff(seg.start, seg.end)}`,
                        `Distance Traveled: ${fmt.distanceM(dist)}`,
                        `Nearest Land: ${fmt.distanceM(landdist)}`,
                        `Max speed: ${fmt.speed(d3.max(speeds))}`,
                        `Average speed: ${fmt.speed(d3.mean(speeds))}`,
                        `Pace: ${fmt.pace(d3.mean(speeds))}`,
                        `Average HR: ${fmt.hr(d3.mean(hrs))}`,
                        `Max HR: ${fmt.hr(d3.max(hrs))}`,
                        `Min HR: ${fmt.hr(d3.min(hrs))}`
                    ];
                    return desc.join('\n');
                }
            }))
        ]
    }))
}</div>

```js
const foilingSpeeds = runCsv.map(d => d.speed).filter(d => d > FOIL_THRESHOLD_KPH);
```

<div class="grid grid-cols-4">
    <div class="card">
      <h2>Average Speed</h2>
      <span class="big">${fmt.speed(runMeta.avg_speed_kmh)}</span>
    </div>
    <div class="card">
      <h2>Average Foiling Speed</h2>
      <span class="big">${fmt.speed(d3.mean(foilingSpeeds))} (${fmt.pace(d3.mean(foilingSpeeds))})</span>
    </div>
    <div class="card">
      <h2>Max Speed</h2>
      <span class="big">${fmt.speed(runMeta.max_speed_kmh)}</span>
    </div>
    <div class="card">
      <h2>Best 1k Pace</h2>
      <span class="big">${fmt.pace(runMeta.max_speed_1k)}</span>
    </div>
</div>

## Conditions

<div class="card">${
wind && wind.length > 0
  ? resize((width) => Plot.plot({
      title: "Wind",
      color: { legend: true },
      width,
      x: {tickFormat: d3.timeFormat("%H:%M")},
      y: { domain: [0, d3.max(wind, d => Math.max(d.wavg, d.wgust)) * 1.1] },
      marks: [
        Plot.areaY(wind, { x: "ts", y: "wgust", curve: 'basis', fill: "#dbeafe", fillOpacity: 0.3 }),
        Plot.areaY(wind, { x: "ts", y: "wavg",  curve: 'basis', fill: "#93c5fd", fillOpacity: 0.4 }),
        Plot.areaY(wind, { x: "ts", y: "wlull",  curve: 'basis', fill: "#3b82f6", fillOpacity: 0.5 }),
        //
        Plot.lineY(wind, { x: "ts", y: "wlull", curve: 'basis', stroke: "#2563eb", strokeWidth: 2 }),
        Plot.lineY(wind, { x: "ts", y: "wavg",  curve: 'basis', stroke: "#1e40af",  strokeWidth: 2.5 }),
        Plot.lineY(wind, { x: "ts", y: "wgust", curve: 'basis', stroke: "#1e3a8a", strokeWidth: 2 }),
        Plot.vector(wind, { x: "ts", y: "wavg",
          length: 30,
          rotate: d => d.wdir + 180,
          anchor: "middle",
          stroke: "#dc2626",
          strokeWidth: 4
        }),
        Plot.tip(wind, Plot.pointer({
          x: "ts",
          y: "wavg",
          fontSize: 15,
          title: d => `${fmt.time(d.ts)}: ${d.wavg.toFixed(1)} knots @ ${Math.round(d.wdir)}°`
        }))
      ]
    }))
  : html`<p>No wind data found for this run.</p>`
}</div>

<div class="card">${
swell && swell.length > 0
  ? resize((width) => Plot.plot({
      title: "Swell",
      color: { legend: true },
      width,
      x: {tickFormat: d3.timeFormat("%H:%M")},
      y: { domain: [0, d3.max(swell, d => d.wave_height * 1.1)] },
      marks: [
        Plot.areaY(swell, { x: "ts", y: "wave_height", curve: 'basis', fill: "#3b82f6", fillOpacity: 0.5 }),
        Plot.lineY(swell, { x: "ts", y: "wave_height", curve: 'basis', stroke: "#2563eb", strokeWidth: 2 }),
        Plot.vector(swell, { x: "ts", y: "wave_height",
          length: 30,
          rotate: d => d.wave_direction + 180,
          anchor: "middle",
          stroke: "#dc2626",
          strokeWidth: 4
        }),
        Plot.tip(swell, Plot.pointer({
          x: "ts",
          y: "wave_height",
          fontSize: 15,
          title: d => [
            `${fmt.time(d.ts)}:`,
            formatIndividualSwells(d.ts)
          ].filter(Boolean).join("\n")
        }))
      ]
    }))
  : html`<p>No swell data found for this run.</p>`
}</div>

<div class="card">${
swell2.length > 0
  ? html`<h2>Individual Swells</h2><div>${
      swell2.map(({ts, values}) => {
        const { primary, components } = summarizeSwellPartition(values);
        return html`
        <div style="margin-bottom: 1em;">
          <strong>${fmt.time(ts)}${primary ? html` — ${formatPrimaryLine(primary)}` : ''}</strong>
          <ul style="margin: 0.25em 0 0 1em;">
            ${components.map(d => html`
              <li>${formatComponentLine(d)}</li>
            `)}
          </ul>
        </div>
      `})
    }</div>`
  : html`<p>No individual swell data found for this run.</p>`
}</div>


## Splits

```js
const splits = tl.computeSplits(runCsv);
```

```js
Inputs.table(splits, {
  columns: [
    "split",
    "avg_pace",
    "min_speed",
    "avg_speed",
    "max_speed",
    "max_hr",
    "min_hr",
    "avg_hr"
  ],
  header: {
    split: "Split",
    avg_pace: "Avg Pace",
    min_speed: "Min Speed",
    avg_speed: "Avg Speed",
    max_speed: "Max Speed",
    max_hr: "Max HR",
    min_hr: "Min HR",
    avg_hr: "Avg HR"
  },
  format: {
    split: d => `${d} km`,
    avg_pace: fmt.minutes,
    min_speed: fmt.speed,
    avg_speed: fmt.speed,
    max_speed: fmt.speed,
    max_hr: fmt.hr,
    min_hr: fmt.hr,
    avg_hr: fmt.hr
  }})
```

<div class="card">${
  resize((width) => Plot.plot({
      title: "Speed",
      color: { legend: true },
      width, x: { interval: 1, label: "km" },
      marks: [
        Plot.rect(splits,{x:"split",y1:"min_speed",y2:"max_speed", fill: "green", opacity: 0.2,
          title: d => `${d.min_speed.toFixed(2)} - ${d.max_speed.toFixed(2)} kph\n${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph avg`
        }),
        Plot.line(splits, {x: "split", y: "avg_speed", stroke: "green", strokeWidth: 2})
      ]
    })
    )
}</div>

<div class="card">${
  resize((width) => Plot.plot({
      title: "Pace",
      color: { legend: true },
      clip: true,
      y: { domain: [1, Math.min(5, Math.max(...splits.map(d => d.avg_pace)))]},
      width, x: { interval: 1, label: "km" },
      marks: [
        Plot.barY(splits,{x:"split",y:"avg_pace", fill: "green", opacity: 0.2,
          title: (d => `${fmt.pace(d.avg_speed.toFixed(2))}\n${d.avg_speed.toFixed(2)} kph`) }),
        // Plot.line(splits, {x: "split", y: "max_pace", stroke: "green", strokeWidth: 2})
      ]
    })
    )
}</div>

<div class="card">${
  resize((width) => Plot.plot({
      title: "Heart Rate",
      color: { legend: true },
      width, x: { interval: 1, label: "km" },
      marks: [
        Plot.rect(splits,{x:"split",y1:"min_hr",y2:"max_hr", fill: 'red', opacity: 0.2,
          title: d => `${d.min_hr} - ${d.max_hr} bpm`
        }),
        Plot.line(splits, {x: "split", y: "avg_hr", stroke: "red", strokeWidth: 2})
      ]
    })
    )
}</div>

<div class="card">${
resize((width) => {
  const maxSpeed = d3.max([...onFoil, ...offFoil], d => d.speed);
  const maxHr = d3.max(runCsv, d => d.hr);
  const y2 = d3.scaleLinear([0, maxHr], [0, maxSpeed]);
  return Plot.plot({
    title: "Heart Rate vs. Speed",
    color: { legend: true },
    width,
    x: {tickFormat: d3.timeFormat("%H:%M"), interval: 1},
    y: { label: "Speed (knots)" },
    marks: [
    Plot.areaY(runCsv, { x: "ts", y: d => d.speed <= FOIL_THRESHOLD_KPH ? d.speed : null, fill: "#500", stroke: "none" }),
    Plot.areaY(runCsv, { x: "ts", y: d => d.speed > FOIL_THRESHOLD_KPH  ? d.speed : null, fill: "#030", stroke: "none" }),
    Plot.lineY(onFoil,  { x: "ts", y: "speed", stroke: "#050" }),
    Plot.lineY(offFoil, { x: "ts", y: "speed", stroke: "#900" }),
    Plot.axisY({ anchor: "left", label: "Speed (kph)" }),
      Plot.axisY(y2.ticks(), {
        anchor: "right",
        label: "Heart Rate (bpm)",
        y: y2,
        tickFormat: y2.tickFormat(),
        // color: "red"
      }),
      Plot.line(runCsv, Plot.mapY((D) => D.map(y2), {
        x: "ts",
        y: d => d.hr,
        stroke: "red",
        strokeWidth: 2
      })),
      Plot.tip(runCsv, Plot.pointer({
        x: "ts",
        y: d => y2(d.hr),
        fontSize: 15,
        title: d => `${fmt.time(d.ts)}\n${fmt.hr(d.hr)}\n${fmt.speed(d.speed)}`
      }))
    ]
  });
})
}</div>

<div class="grid grid-cols-4">
    <div class="card">
      <h2>Min Foiling Heart Rate</h2>
      <span class="big">${fmt.hr(runMeta.min_foiling_hr || 0)}</span>
    </div>
    <div class="card">
      <h2>Average Foiling Heart Rate</h2>
      <span class="big">${fmt.hr(runMeta.avg_foiling_hr || 0)}</span>
    </div>
    <div class="card">
      <h2>Overall Average Heart Rate</h2>
      <span class="big">${fmt.hr(d3.mean(runCsv.map(d => d.hr)))}</span>
    </div>
    <div class="card">
      <h2>Max Heart Rate</h2>
      <span class="big">${fmt.hr(d3.max(runCsv.map(d => d.hr)))}</span>
    </div>
</div>

## Compare

You can compare this run to a similar run by clicking on one of the timestamps below.

```js
const compares = view(Inputs.radio(["All", "Similar"],
                      {label: "Run Selection", value: 'Similar'}));

const compareFuns = {
    All: d => true,
    Similar: d => d.start_beach == runMeta.start_beach || d.end_beach == runMeta.end_beach,
};
```

<div class="card">${
Inputs.table(allRuns.filter(d => d.id != thisId && compareFuns[compares](d)).sort((a, b) => b.ts - a.ts),
  runsTableOptions(beachColor, htl, {
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
      "wind_data",
      "paddle_up_count",
      "foil"
    ],
    linkHref: d => `/compare.html?id1=${thisId}&id2=${d.id}`
  }))
}</div>
