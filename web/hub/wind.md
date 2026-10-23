---
theme: dashboard
title: What makes good wind
toc: false
---

<style>
  .muted { color: var(--theme-foreground-muted); }
  .wq-badge { display: inline-block; font-size: 0.75rem; font-weight: 600; padding: 0.05rem 0.45rem; border-radius: 999px;
    color: var(--wq); background: color-mix(in srgb, var(--wq) 16%, transparent); border: 1px solid color-mix(in srgb, var(--wq) 45%, transparent); }
  .ranges { border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .ranges td, .ranges th { padding: 0.2rem 0.8rem 0.2rem 0; text-align: left; }
  .ranges th { font-weight: normal; color: var(--theme-foreground-muted); }
  .runs-wrap { overflow-x: auto; }
  .runs { border-collapse: collapse; font-variant-numeric: tabular-nums; width: 100%; }
  .runs td, .runs th { padding: 0.2rem 0.6rem 0.2rem 0; text-align: left; white-space: nowrap; }
  .runs th { font-weight: normal; color: var(--theme-foreground-muted); }
  .runs .num { text-align: right; }
  .card svg { cursor: pointer; }
</style>

# What makes good wind

The wind cards label each reading magic, good, harder, too light or no go. The labels come from a table for each station: direction ranges in that station's degrees, plus a lightest wind worth going in. The charts below show how everyone's runs have gone at each direction and wind strength, so you can see where the table's numbers come from. Only the last 18 months of runs count, since older ones show skills still developing. They're recomputed from the run logs every time this page loads. The run rating reads the same table, so the labels and the rating agree.

```js
import * as fmt from "./components/formatters.js";
import {fetchMeta, riderFile, ridersWith} from "./components/data.js";
import {WIND_QUALITY, CLASSES, windClass} from "./components/wind-quality.js";

const RIDER_NAMES = (await ridersWith("hub")).map(r => [r.rider, r.name]);
// Each station with the runs it describes. Kīhei's reverse (northbound)
// runs are too few to score yet, so only southbound runs count there.
const STATIONS = [
  {site: "kihei", name: "Kīhei", region: "Kihei", dirStep: 5, keep: d => d.end_lat < d.start_lat, what: "southbound runs, Kīhei station at Sugar Beach"},
  {site: "hookipa", name: "Hoʻokipa", region: "Maui North Shore", dirStep: 10, keep: () => true, what: "north shore runs, Hoʻokipa station"},
];
const SPEED_STEP = 2;
// Only recent runs: older ones show skills still being learned more than the wind.
const SINCE = d3.timeMonth.offset(new Date(), -18);
const MIN_RUNS = 3;
```

```js
const runs = (await Promise.all(RIDER_NAMES.map(async ([slug, name]) =>
  (await fetchMeta(() => riderFile("runs.csv", slug)).catch(() => [])).map(d => ({...d, riderSlug: slug, riderName: name}))
))).flat();

// Each run against its own rider's other runs in the same region, so a
// fast rider doesn't make their usual direction look good: z-scores of
// on-foil share and foiling speed, minus paddle-ups per km.
function scored(region, keep) {
  const rs = runs.filter(d => d.ts >= SINCE && d.region === region && keep(d) && d.avg_wdir != null && d.avg_wavg != null
    && d.distance_km > 3 && d.duration_on_foil > 0);
  const feats = d => ({
    share: d.distance_on_foil / (d.distance_km * 1000),
    speed: d.distance_on_foil / d.duration_on_foil * 3.6,
    paddleUps: (d.paddle_up_count ?? 0) / d.distance_km,
  });
  return d3.groups(rs, d => d.riderSlug).flatMap(([, mine]) => {
    if (mine.length < 10) return [];
    const f = mine.map(feats);
    const z = k => {
      const m = d3.mean(f, d => d[k]), s = d3.deviation(f, d => d[k]) || 1;
      return v => (v - m) / s;
    };
    const zs = z("share"), zv = z("speed"), zp = z("paddleUps");
    return mine.map((d, i) => ({...d, ...f[i], score: zs(f[i].share) + zv(f[i].speed) - zp(f[i].paddleUps)}));
  });
}
const bandOf = (deg, step) => (Math.floor(((deg + step / 2) % 360 + 360) % 360 / step) * step) % 360;
const fmtDeg = d => String(d).padStart(3, "0");
const runLink = d => `https://${d.riderSlug}.downwind.pro/run.html?id=${d.id}`;

function runList(title, runs) {
  const rows = runs.slice().sort((a, b) => b.ts - a.ts);
  return html`<div class="card">
    <h3>${title}: ${rows.length} run${rows.length === 1 ? "" : "s"}</h3>
    <div class="runs-wrap"><table class="runs">
      <thead><tr><th>When</th><th>Who</th><th>Where</th><th>Foil</th><th class="num">km</th><th class="num">time</th><th class="num">on foil</th><th class="num">paddle-ups</th><th class="num">foiling HR</th><th class="num">wind</th><th class="num">score</th></tr></thead>
      <tbody>${rows.map(d => html`<tr>
        <td><a href=${runLink(d)}>${d3.utcFormat("%Y-%m-%d %H:%M")(new Date(+d.ts - 10 * 3600e3))}</a></td>
        <td>${d.riderName}</td>
        <td>${d.start_beach}${d.end_beach !== d.start_beach ? ` → ${d.end_beach}` : ""}</td>
        <td>${d.foil}</td>
        <td class="num">${d.distance_km.toFixed(1)}</td>
        <td class="num">${d.duration_sec == null ? "" : fmt.seconds(Math.round(d.duration_sec / 60) * 60)}</td>
        <td class="num">${Math.round(100 * d.share)}%</td>
        <td class="num">${d.paddle_up_count ?? ""}</td>
        <td class="num">${d.avg_foiling_hr == null ? "" : Math.round(d.avg_foiling_hr)}</td>
        <td class="num">${d.avg_wavg.toFixed(0)}${d.avg_wgust == null ? "" : `g${d.avg_wgust.toFixed(0)}`} ${Math.round(d.avg_wdir)}°</td>
        <td class="num">${d.score.toFixed(1)}</td>
      </tr>`)}</tbody>
    </table></div>
  </div>`;
}
```

```js
function stationSection(st) {
  const rs = scored(st.region, st.keep).map(d => ({
    ...d,
    dirBand: bandOf(d.avg_wdir, st.dirStep),
    kn: Math.floor(d.avg_wavg / SPEED_STEP) * SPEED_STEP,
  }));
  const q = WIND_QUALITY[st.site];
  // Directions in order around the station's sweet spot, so a range that
  // crosses north stays in one piece.
  const centre = d3.median(rs, d => d.avg_wdir);
  const order = d => ((d - centre + 540) % 360);
  const byDir = d3.rollups(rs, v => ({n: v.length, score: d3.mean(v, d => d.score), runs: v}), d => d.dirBand)
    .map(([band, v]) => ({band, ...v, cls: windClass(st.site, {wdir: band})}))
    .filter(d => d.n >= MIN_RUNS).sort((a, b) => order(a.band) - order(b.band));
  const dirDomain = byDir.map(d => fmtDeg(d.band));
  const bySpeed = d3.rollups(rs, v => ({n: v.length, score: d3.mean(v, d => d.score), runs: v}), d => d.kn)
    .map(([kn, v]) => ({kn, ...v})).filter(d => d.n >= MIN_RUNS).sort((a, b) => a.kn - b.kn);
  const cells = d3.rollups(rs, v => ({n: v.length, score: d3.mean(v, d => d.score), runs: v}), d => d.dirBand, d => d.kn)
    .flatMap(([band, ks]) => ks.map(([kn, v]) => ({band: fmtDeg(band), kn, ...v})))
    .filter(d => d.n >= 2 && dirDomain.includes(d.band));
  const knDomain = d3.range(d3.min(bySpeed, d => d.kn), d3.max(bySpeed, d => d.kn) + 1, SPEED_STEP);
  const knLabel = k => `${k}–${k + SPEED_STEP}`;
  const best = d3.greatest(byDir, d => d.score);
  // Tapping a bar or cell lists its runs under the charts.
  const picked = html`<div class="grid grid-cols-1"></div>`;
  const pick = (title) => plot => {
    plot.addEventListener("click", () => {
      const d = plot.value;
      picked.replaceChildren(d?.runs ? runList(title(d), d.runs) : "");
      if (d?.runs) picked.scrollIntoView({behavior: "smooth", block: "nearest"});
    });
    return plot;
  };

  return html`<h2 id=${st.site}>${st.name}</h2>
  <p class="muted">${rs.length} ${st.what}. Score is how a run went against that rider's other runs here: time on foil plus foiling speed, minus paddle-ups. 0 is a usual run for them. ${best ? `Best direction band so far: ${fmtDeg(best.band)}°.` : ""}</p>
  <div class="grid grid-cols-2">
    <div class="card">
      <h3>Direction</h3>
      ${resize(width => pick(d => `${fmtDeg(d.band)}° ±${st.dirStep / 2}`)(Plot.plot({
        width, height: 240, marginLeft: 36, marginBottom: 34,
        x: {domain: dirDomain, label: "station direction (°, band centre)", labelAnchor: "center", labelOffset: 30, tickSize: 0, tickFormat: (d, i) => i % 2 ? "" : d},
        y: {label: "score", grid: true, domain: [-3, 2], clamp: true},
        marks: [
          Plot.barY(byDir, {x: d => fmtDeg(d.band), y: "score", fill: d => CLASSES[d.cls ?? "nogo"].color, inset: 2}),
          Plot.ruleY([0]),
          Plot.barY(byDir, Plot.pointerX({x: d => fmtDeg(d.band), y: "score", fill: "none", stroke: "var(--theme-foreground)", strokeWidth: 1.5, inset: 1})),
          Plot.tip(byDir, Plot.pointerX({x: d => fmtDeg(d.band), frameAnchor: "top", pointerSize: 0, title: d => `${fmtDeg(d.band)}° ±${st.dirStep / 2}\n${d.n} runs\nscore ${d.score.toFixed(2)}\n${CLASSES[d.cls ?? "nogo"].label}`}))
        ]
      })))}
      <div class="muted" style="font-size: 0.85em">Bar colour is the table's label for that direction. Hover a bar for its run count; tap it to list the runs.</div>
    </div>
    <div class="card">
      <h3>Wind strength</h3>
      ${resize(width => pick(d => `${knLabel(d.kn)} kn`)(Plot.plot({
        width, height: 240, marginLeft: 36, marginBottom: 34,
        x: {domain: knDomain.map(knLabel), label: "average wind over the run (kn)", labelAnchor: "center", labelOffset: 30, tickSize: 0},
        y: {label: "score", grid: true, domain: [-3, 2], clamp: true},
        marks: [
          Plot.barY(bySpeed, {x: d => knLabel(d.kn), y: "score", fill: d => d.kn + SPEED_STEP <= q.floor ? CLASSES.light.color : "var(--theme-foreground-focus)", inset: 2}),
          Plot.ruleY([0]),
          Plot.barY(bySpeed, Plot.pointerX({x: d => knLabel(d.kn), y: "score", fill: "none", stroke: "var(--theme-foreground)", strokeWidth: 1.5, inset: 1})),
          Plot.tip(bySpeed, Plot.pointerX({x: d => knLabel(d.kn), frameAnchor: "top", pointerSize: 0, title: d => `${knLabel(d.kn)} kn\n${d.n} runs\nscore ${d.score.toFixed(2)}`}))
        ]
      })))}
      <div class="muted" style="font-size: 0.85em">Grey is below the ${q.floor} kn floor, where the table says too light. Hover a bar for its run count; tap it to list the runs.</div>
    </div>
  </div>
  <div class="card">
    <h3>Direction and strength together</h3>
    ${resize(width => pick(d => `${d.band}°, ${knLabel(d.kn)} kn`)(Plot.plot({
      width, height: Math.max(200, 26 * knDomain.length + 60), marginLeft: 48, marginBottom: 34, padding: 0.06,
      x: {domain: dirDomain, label: "station direction (°) · rows are average wind (kn)", labelAnchor: "center", labelOffset: 30, tickSize: 0, tickFormat: (d, i) => i % 2 ? "" : d},
      y: {domain: knDomain.slice().reverse().map(knLabel), label: null, tickSize: 0},
      color: {type: "diverging", scheme: "PiYG", domain: [-2, 2], clamp: true, legend: true, label: "score"},
      marks: [
        Plot.cell(cells, {x: "band", y: d => knLabel(d.kn), fill: "score", inset: 0.5}),
        Plot.text(cells, {x: "band", y: d => knLabel(d.kn), text: "n", fill: d => Math.abs(d.score) > 1.2 ? "white" : "black", fontSize: 10}),
        Plot.tip(cells, Plot.pointer({x: "band", y: d => knLabel(d.kn), title: d => `${d.band}°, ${knLabel(d.kn)} kn\n${d.n} runs\nscore ${d.score.toFixed(2)}`}))
      ]
    })))}
    <div class="muted" style="font-size: 0.85em">Each cell is the average score of runs in that direction and wind; the number is how many runs. Cells with one run are left out. Tap a cell to list its runs.</div>
  </div>
  ${picked}
  <div class="card">
    <h3>The table</h3>
    <table class="ranges"><thead><tr><th>Direction</th><th>Label</th><th>Why</th></tr></thead><tbody>
      ${q.ranges.map(r => html`<tr><td>${fmtDeg(r.from)}–${fmtDeg(r.to)}°</td><td><span class="wq-badge" style="--wq: ${CLASSES[r.class].color}">${CLASSES[r.class].label}</span></td><td class="muted">${r.note}</td></tr>`)}
      <tr><td>anything else</td><td><span class="wq-badge" style="--wq: ${CLASSES.nogo.color}">no go</span></td><td></td></tr>
      <tr><td>under ${q.floor} kn</td><td><span class="wq-badge" style="--wq: ${CLASSES.light.color}">too light</span></td><td class="muted">any direction</td></tr>
    </tbody></table>
    <div class="muted" style="font-size: 0.85em; margin-top: 0.4rem">Runs only happen on days someone chose to go, so the charts rank directions people ride; where "no go" starts comes from riders, not the data.</div>
  </div>`;
}
```

${STATIONS.map(stationSection)}
