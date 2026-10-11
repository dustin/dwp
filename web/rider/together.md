---
theme: dashboard
title: rode together
toc: true
---

```js
import {renderRun, findCallouts, findFastest1kSegment} from "./components/map.js";
import {createColorizer, FOIL_THRESHOLD_KPH} from "./components/color.js";
import {windRoseOrigin, windRoseScale, addWindRose, WIND_SPEED_COLORS} from "./components/wind-rose.js";
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, rider, RIDERS, withRider, fetchRun, fetchWind, fetchTogether} from "./components/data.js";

const urlParams = new URLSearchParams(window.location.search);

// The riders out on one run: this site's rider's run (?id=) plus everyone
// together.csv says went with it. ?runs=rider:id,rider:id,... names them
// outright instead.
const picked = urlParams.get("runs")
  ? urlParams.get("runs").split(",").map(s => s.split(":")).filter(([r]) => RIDERS.includes(r))
  : [[rider, urlParams.get("id")],
     ...((await fetchTogether()).get(urlParams.get("id")) ?? []).map(t => [t.other_rider, t.other_id])];

const lists = new Map(await Promise.all([...new Set(picked.map(([r]) => r))].map(async r =>
  [r, new Map(withRider(await fetchMeta(() => riderFile('runs.csv', r)), r).map(m => [m.id, m]))])));
const metas = picked.map(([r, id]) => lists.get(r).get(id)).filter(Boolean);
const csvs = await Promise.all(metas.map(fetchRun));

// One hue per rider, in page order: the first two match compare.html.
const HUES = [140, 30, 210, 280, 340, 55];
const hue = i => HUES[i % HUES.length];
const colorOf = i => `hsl(${hue(i)}, 80%, 48%)`;
const cap = s => s[0].toUpperCase() + s.slice(1);
const riders = metas.map((m, i) => ({meta: m, csv: csvs[i], name: cap(m.rider), color: colorOf(i)}));
const colorizers = csvs.map((c, i) => createColorizer(c, hue(i)));
const first = metas[0];
// ?rider= shows another rider's run from any host.
const runLink = m => `run.html?id=${m.id}${m.rider === rider ? "" : `&rider=${m.rider}`}`;
const wind = await fetchWind(first);
```

# ${first.start_beach} → ${first.end_beach}, ${fmt.date(first.ts)}

<div class="riders">${riders.map(r => html`<span class="rider" style="--c: ${r.color}"><a href=${runLink(r.meta)}><b>${r.name}</b></a> on ${/^unknown/.test(r.meta.foil) ? "an unknown foil" : r.meta.foil}</span>`)}</div>

<style>
  .no-callouts .callouts { display: none; }
  .riders { display: flex; flex-wrap: wrap; gap: .4rem 1.2rem; margin: .5rem 0 1rem; }
  .rider b { color: var(--c); }
  .multi { display: grid; gap: .1rem; font-size: 1.15rem; font-weight: 600; margin-top: .3rem; }
  .multi .v { color: var(--c); font-variant-numeric: tabular-nums; }
  .multi .v.best::after { content: " ★"; font-size: .8em; }
</style>

```js
// Each rider's own callouts, ringed in their color and named. Lifetime
// odometer milestones are about one rider, not the run, so they're left out.
const fastest = csvs.map(findFastest1kSegment);
const callouts = riders.flatMap((r, i) =>
  findCallouts(r.meta, r.csv, [fastest[i]])
    .filter(c => !["💯", "🎉"].includes(c.icon))
    .map(c => ({...c, color: r.color, text: `${r.name}: ${c.text}`})));
// Hiding them is just a class on the card, so the map keeps its zoom.
const annotations = Inputs.toggle({label: "Annotations", value: true});
annotations.addEventListener("input", () =>
  document.getElementById("together-map").classList.toggle("no-callouts", !annotations.value));
display(annotations);
```

<div class="card" id="together-map">${resize(width => renderRun(width, csvs, callouts, {
  colorizers,
  additionalMarks: ({d3, svg}) => {
    // Out together, so one rose.
    const scale = windRoseScale(width);
    const {centerX, centerY} = windRoseOrigin(16, 130, 0, scale);
    addWindRose(d3, svg, wind, {x: centerX, y: centerY, title: "Wind (avg)", scheme: WIND_SPEED_COLORS, scale});
  },
  fastestSegments: fastest,
}))}</div>

## At a Glance

```js
const foilSpeed = csv => d3.mean(csv, d => (d.speed > FOIL_THRESHOLD_KPH ? d.speed : undefined));
// One card: a line per rider, the best value starred. `better` is +1 when
// bigger wins, -1 when smaller does, 0 for no star.
function card(title, value, format, better = 1) {
  const vals = riders.map(r => value(r.meta, r.csv));
  const ok = vals.filter(v => v != null && !Number.isNaN(v));
  const best = better && ok.length > 1 ? (better > 0 ? d3.max(ok) : d3.min(ok)) : undefined;
  return html`<div class="card"><h2>${title}</h2><div class="multi">${riders.map((r, i) => {
    const v = vals[i];
    const shown = v == null || Number.isNaN(v) ? "—" : format(v);
    return html`<span class="v ${v === best ? "best" : ""}" style="--c: ${r.color}">${shown}</span>`;
  })}</div></div>`;
}
const km = v => `${(v / 1000).toFixed(2)} km`;
```

<div class="grid grid-cols-4">
  ${card("Total Time", m => m.duration_sec, fmt.seconds, -1)}
  ${card("Time on Foil", m => m.duration_on_foil, d => fmt.seconds(d))}
  ${card("Distance Traveled", m => m.distance_km, d => `${d.toFixed(2)} km`, 0)}
  ${card("Distance on Foil", m => m.distance_on_foil, km)}
  ${card("Longest Foiling Segment", m => m.longest_segment_distance, km)}
  ${card("Furthest From Land", m => m.max_distance, km, 0)}
  ${card("Paddle Ups", m => m.paddle_up_count || 0, d => `${d}`, -1)}
  ${card("Best 1k Pace", m => m.max_speed_1k, fmt.pace)}
  ${card("Average Foiling Speed", (m, c) => foilSpeed(c), fmt.speed)}
  ${card("Max Speed", m => m.max_speed_kmh, fmt.speed)}
  ${card("Min Foiling Heart Rate", m => m.min_foiling_hr, fmt.hr, 0)}
  ${card("Average Foiling Heart Rate", m => m.avg_foiling_hr, fmt.hr, 0)}
</div>

## Who's Ahead

```js
// How far each rider was behind whoever was furthest down the course at
// that moment. Progress is position projected onto the first rider's
// start-to-finish line, so GPS distance differences between devices don't
// count.
const behind = (() => {
  const pts = csvs[0].filter(d => d.lat != null);
  const [s0, s1] = [pts[0], pts[pts.length - 1]];
  const kx = 111320 * Math.cos(s0.lat * Math.PI / 180), ky = 110540;
  const ux = (s1.lon - s0.lon) * kx, uy = (s1.lat - s0.lat) * ky, len = Math.hypot(ux, uy);
  const along = d => ((d.lon - s0.lon) * kx * ux + (d.lat - s0.lat) * ky * uy) / len;
  const tracks = csvs.map(c => c.filter(d => d.lat != null));
  const bis = d3.bisector(d => d.ts).left;
  const at = (track, t) => {
    const i = bis(track, t);
    return i > 0 && i < track.length ? along(track[i]) : null;
  };
  const [t0, t1] = [d3.max(tracks, t => t[0].ts), d3.min(tracks, t => t[t.length - 1].ts)];
  const rows = [];
  for (let t = +t0; t <= +t1; t += 10000) {
    const p = tracks.map(tr => at(tr, new Date(t)));
    if (p.some(v => v == null)) continue;
    const lead = d3.max(p);
    p.forEach((v, i) => rows.push({ts: new Date(t), rider: riders[i].name, behind: lead - v}));
  }
  return rows;
})();
```

<div class="card">${resize(width => Plot.plot({
  title: "Meters behind the leader (0: leading)",
  width, height: 260,
  x: {type: "time", label: null},
  y: {label: "meters behind", grid: true, reverse: true},
  color: {domain: riders.map(r => r.name), range: riders.map(r => r.color), legend: true},
  marks: [
    Plot.ruleY([0]),
    Plot.lineY(behind, {x: "ts", y: "behind", stroke: "rider", strokeWidth: 1.5}),
    Plot.tip(behind, Plot.pointerX({x: "ts", y: "behind", stroke: "rider",
      title: d => `${d.rider}: ${d.behind < 1 ? "leading" : `${d.behind.toFixed(0)} m behind`}\n${fmt.time(d.ts)}`}))
  ]
}))}</div>

## Heart Rate

```js
// Effort: heart rate against the rider's own usual foiling heart rate (the
// median of avg_foiling_hr over all their runs), so riders with different
// hearts compare fairly: 100% is a typical day for them. Riders without HR
// data are left out.
const hrRiders = riders.map(r => {
  const ref = d3.median([...lists.get(r.meta.rider).values()], m => m.avg_foiling_hr || undefined);
  const foiling = r.csv.filter(d => d.hr > 0 && d.speed > FOIL_THRESHOLD_KPH);
  return {...r, ref, foiling};
}).filter(r => r.ref && r.foiling.length > 0);
const effortRows = hrRiders.flatMap(r => {
  // A one-minute rolling mean, sampled every 10 seconds.
  const pts = r.csv.filter(d => d.hr > 0);
  const bins = d3.rollups(pts, v => d3.mean(v, d => d.hr), d => Math.floor(d.ts / 10000) * 10000)
    .sort((a, b) => a[0] - b[0]);
  return bins.map(([t], i) => {
    const win = bins.slice(Math.max(0, i - 5), i + 1);
    return {ts: new Date(t), rider: r.name, effort: d3.mean(win, w => w[1]) / r.ref};
  });
});
const pct = v => `${(v * 100).toFixed(0)}%`;
function hrCard(title, value, format) {
  return html`<div class="card"><h2>${title}</h2><div class="multi">${hrRiders.map(r => {
    const v = value(r);
    return html`<span class="v" style="--c: ${r.color}">${v == null || Number.isNaN(v) ? "—" : format(v)}</span>`;
  })}</div></div>`;
}
```

<div>${hrRiders.length === 0 ? html`<p>No heart rate data for these runs.</p>` : html`<div class="grid grid-cols-4">
  ${hrCard("Foiling Effort vs Usual", r => d3.mean(r.foiling, d => d.hr) / r.ref, pct)}
  ${hrCard("Time on Foil Above Usual", r => r.foiling.filter(d => d.hr > r.ref).length / r.foiling.length, pct)}
  ${hrCard("Peak Heart Rate", r => d3.max(r.csv, d => d.hr), fmt.hr)}
  ${hrCard("Usual Foiling Heart Rate", r => r.ref, fmt.hr)}
</div>
<div class="card">${resize(width => Plot.plot({
  title: "Effort: heart rate as % of each rider's usual foiling heart rate (1-minute average)",
  width, height: 260,
  x: {type: "time", label: null},
  y: {label: "% of usual", grid: true, tickFormat: d => `${(d * 100).toFixed(0)}`},
  color: {domain: hrRiders.map(r => r.name), range: hrRiders.map(r => r.color), legend: true},
  marks: [
    Plot.ruleY([1], {strokeDasharray: "4,4"}),
    Plot.lineY(effortRows, {x: "ts", y: "effort", stroke: "rider", strokeWidth: 1.5}),
    Plot.tip(effortRows, Plot.pointerX({x: "ts", y: "effort", stroke: "rider",
      title: d => `${d.rider}: ${pct(d.effort)}\n${fmt.time(d.ts)}`}))
  ]
}))}</div>`}</div>

## Speed

<div class="card">${resize(width => Plot.plot({
  title: "1k average speed",
  width, height: 260,
  x: {type: "time", label: null},
  y: {label: "kph", grid: true},
  color: {domain: riders.map(r => r.name), range: riders.map(r => r.color), legend: true},
  marks: riders.map(r => Plot.lineY(r.csv, {x: "ts", y: "avg_speed_1k", stroke: r.color, strokeWidth: 1.5}))
}))}</div>
