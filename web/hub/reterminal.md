---
title: reterminal
toc: false
sidebar: false
header: false
footer: false
pager: false
---

<style>
  /* Exactly the panel: 800×480, black, white and two greys, nothing around it. */
  html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
  #observablehq-main { margin: 0; padding: 0; min-height: 0; max-width: none; }
  #observablehq-center { margin: 0; padding: 0; }
  #observablehq-main > .observablehq { margin: 0; }
  .rt { width: 800px; height: 480px; box-sizing: border-box; padding: 14px 18px 12px; color: #000; background: #fff;
    font-family: "DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif; display: grid;
    grid-template-columns: 250px 1fr; grid-template-rows: auto minmax(0, 1fr) auto; gap: 8px 18px; -webkit-font-smoothing: none; }
  .rt-head { grid-column: 1 / 3; display: flex; align-items: baseline; gap: 14px; border-bottom: 3px solid #000; padding-bottom: 6px; }
  .rt-head h1 { margin: 0; font-size: 30px; font-weight: 800; color: #000; letter-spacing: 0.5px; max-width: none; }
  .rt-head .rt-meta { margin-left: auto; font-size: 17px; font-weight: 600; }
  .rt-now { display: flex; flex-direction: column; gap: 5px; min-height: 0; overflow: hidden; }
  .rt-label { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .rt-big { font-size: 58px; font-weight: 800; line-height: 0.95; }
  .rt-big small { font-size: 24px; font-weight: 700; }
  .rt-dir { font-size: 22px; font-weight: 700; }
  .rt-badge { display: inline-block; font-size: 18px; font-weight: 800; padding: 2px 10px; border: 3px solid #000; border-radius: 6px; }
  .rt-badge.solid { background: #000; color: #fff; }
  .rt-line { font-size: 17px; font-weight: 600; line-height: 1.3; }
  .rt-rule { border-top: 2px solid #000; margin: 2px 0; }
  .rt-chart { display: flex; flex-direction: column; gap: 4px; }
  .rt-summary { font-size: 19px; font-weight: 700; line-height: 1.25; }
  .rt-days { grid-column: 1 / 3; display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; border-top: 3px solid #000; padding-top: 8px; }
  .rt-day { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; font-size: 15px; font-weight: 600; }
  .rt-day b { font-size: 22px; font-weight: 800; }
  .rt-muted { color: #555; }
</style>

```js
// Kīhei (or ?site=maliko, the north shore) for a Seeed reTerminal Sticky
// (3.97", 800×480, four greys) running TRMNL firmware, landscape. db/display
// renders it once <html data-ready> is set and the display server hands it
// to the device.
//
// Two modes. From GO_START until an hour before sunset (GO_END) it's live:
// the station now, the finish, the rating, today so far and the forecast.
// Outside that it's the outlook for the next go window (today's before
// GO_START, tomorrow's after GO_END); the display server shows it once and
// sleeps the device until the next GO_START, so the screen isn't redrawn
// overnight. Keep GO_START/GO_END in step with db/display/server.py.
// ?view=outlook always shows the outlook (the display's "-forecast" pages).
// ?t=2026-11-08T07:00 (HST) pretends it's then (data is still now's).
import * as Plot from "npm:@observablehq/plot";
import * as fmt from "./components/formatters.js";
import {compassPoint} from "./components/spectrum.js";
import {fetchLiveWind, fetchRecentWind, fetchWindForecast, parseHstParam} from "./components/data.js";
import {hourlyForecast, outlook, sunTimes, hstDay} from "./components/forecast.js";
import {CLASSES, windClass} from "./components/wind-quality.js";

const HOUR = 3600e3;
const GO_START = 9;        // HST hour
const GO_END_BEFORE_SUNSET = HOUR;
// Per site: the title, the station (forecast and wind classes use the same
// name), where it is, the finish station and which of its directions are
// against the run.
const SITES = {
  kihei: {title: "Kīhei", station: "kihei", where: "Sugar Beach", spot: [20.785, -156.466],
    finish: "wailea", finishName: "Wailea", against: d => d >= 120 && d < 270},
  maliko: {title: "Maliko", station: "hookipa", where: "Hoʻokipa", spot: [20.933, -156.357],
    finish: "kanaha", finishName: "Kanaha", against: () => false},
};
const params = new URLSearchParams(location.search);
const site = SITES[params.get("site")] ?? SITES.kihei;
const now = parseHstParam(params.get("t")) ?? new Date();
const today = hstDay(now);
const {rise, set} = sunTimes(today, site.spot);
const goStart = new Date(Date.parse(`${today}T00:00:00Z`) + (GO_START + 10) * HOUR);
const goEnd = new Date(+set - GO_END_BEFORE_SUNSET);
const isLive = params.get("view") !== "outlook" && now >= goStart && now < goEnd;
// The day the outlook is for, and its daylight.
const day = isLive || now < goStart ? today : hstDay(+now + 86400e3);
const sun = sunTimes(day, site.spot);

const live = await fetchLiveWind();
const fresh = rows => rows?.length && now - rows.at(-1).ts < 20 * 60e3 ? rows : null;
const stationLive = fresh(live?.stations[site.station]);
const fileRows = await fetchRecentWind(site.station, 14).catch(() => []);
const obs = [...fileRows.filter(d => !stationLive || d.ts < stationLive[0].ts), ...(stationLive ?? [])];
const finish = fresh(live?.stations[site.finish])?.at(-1) ?? null;
const forecastRows = await fetchWindForecast(site.station, d3.range(7).map(k => hstDay(+now + k * 86400e3)));
const {hours} = hourlyForecast(site.station, forecastRows, obs, now);
const daylight = hours.filter(h => h.ts >= +sun.rise - HOUR / 2 && h.ts <= sun.set);
const ahead = isLive ? daylight.filter(h => h.ts >= +now - HOUR / 2) : daylight;
const days = outlook(site.station, forecastRows, now).filter(d => d.day > day).slice(0, 5);
const last = obs.at(-1);
const rating = live?.rating;
```

```js
// The panel's greys for each wind class: the better, the darker.
const SHADE = {magic: "#000", good: "#555", hard: "#aaa"};
const RIDEABLE = new Set(["magic", "good", "hard"]);
const hh = t => fmt.clock(t);
const label = c => CLASSES[c]?.label ?? "";
const weekday = day => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {weekday: "short", timeZone: "UTC"});
const ago = t => Math.round((now - t) / 60e3);
const badge = (c, small) => c ? html`<span class="rt-badge ${c === "magic" || c === "good" ? "solid" : ""}" style=${small ? "font-size: 14px; padding: 0 6px; border-width: 2px" : ""}>${label(c)}</span>` : "";
const dayName = day === today ? "Today" : day === hstDay(+now + 86400e3) ? "Tomorrow" : weekday(day);

function ratingLine() {
  if (!rating || now - rating.ts > 30 * 60e3) return html`<span class="rt-muted">No current rating</span>`;
  if (rating.dark) return html`<span class="rt-muted">Dark, no rating</span>`;
  // Two short lines, so a long best bet can't push the afternoons off the panel.
  const kihei = Math.round(rating.kihei * 2.5), ns = Math.round(rating.ns * 2.5);
  const runs = site.station === "kihei" ? html`Run <b>${kihei}/10</b>, north shore ${ns}/10` : html`Run <b>${ns}/10</b>, Kīhei ${kihei}/10`;
  return html`${runs}<br>Best bet: <b>${rating.rec}</b>`;
}

const ok = ahead.filter(h => RIDEABLE.has(h.cls));
const peak = d3.greatest(ok.length ? ok : ahead, h => h.wavg);
function summary() {
  if (!ahead.length) return isLive ? "No forecast for the rest of today yet." : `No forecast for ${dayName.toLowerCase()} yet.`;
  const when = isLive ? "rest of today" : dayName.toLowerCase();
  return ok.length
    ? `Rideable ${hh(ok[0].ts)}–${hh(ok.at(-1).ts)}, peak ~${Math.round(peak.wavg)} kn at ${hh(peak.ts)}`
    : `Not rideable ${when}; peak ~${Math.round(peak.wavg)} kn`;
}

const seen = isLive ? obs.filter(d => d.ts >= +rise - HOUR / 2) : [];
const yMax = Math.max(25, d3.max(seen, d => d.wgust) ?? 0, d3.max(ahead, h => h.wavg) ?? 0);
const chart = Plot.plot({
  width: 496, height: 250, marginLeft: 30, clip: true, marginRight: 6, marginBottom: 22, marginTop: 6,
  style: {fontSize: "14px", fontWeight: 700, color: "#000", background: "#fff", fontFamily: "DejaVu Sans, sans-serif"},
  x: {type: "time", domain: [sun.rise, sun.set], ticks: d3.timeHour.every(2), tickFormat: hh, label: null},
  y: {domain: [-4, yMax], ticks: [0, 10, 20, 30, 40].filter(t => t <= yMax), label: null, grid: true},
  marks: [
    // Expected class of each forecast hour, as a strip along the bottom.
    Plot.rectY(ahead.filter(h => SHADE[h.cls]), {x1: h => new Date(+h.ts - HOUR / 2), x2: h => new Date(Math.min(+h.ts + HOUR / 2, +sun.set)), y1: -4, y2: -1, fill: h => SHADE[h.cls]}),
    Plot.ruleY([15], {stroke: "#aaa", strokeWidth: 2, strokeDasharray: "4,4"}),
    Plot.areaY(seen, {x: "ts", y1: d => d.wlull ?? d.wavg, y2: "wgust", fill: "#aaa", curve: "basis"}),
    Plot.lineY(seen, {x: "ts", y: "wavg", stroke: "#000", strokeWidth: 3, curve: "basis"}),
    Plot.lineY(isLive ? daylight.filter(h => h.ts >= +now - HOUR) : daylight, {x: "ts", y: "wavg", stroke: "#000", strokeWidth: 3, strokeDasharray: "8,6", curve: "monotone-x"}),
    isLive ? Plot.ruleX([now], {stroke: "#000", strokeWidth: 2}) : null,
  ],
});
// Plot's grid and axes are drawn with opacity; make them solid for the panel.
for (const el of chart.querySelectorAll("[stroke-opacity]")) el.setAttribute("stroke-opacity", 1);
for (const el of chart.querySelectorAll("g[aria-label='y-grid'] line")) el.setAttribute("stroke", "#aaa");

const liveLeft = html`<div class="rt-now">
    <span class="rt-label">Now · ${site.where}</span>
    ${last ? html`<div class="rt-big">${Math.round(last.wavg)}<small> kn</small>${last.wgust != null ? html` <small>g${Math.round(last.wgust)}</small>` : ""}</div>
      <div class="rt-dir">${compassPoint(last.wdir)} ${Math.round(last.wdir)}° ${badge(windClass(site.station, last))}</div>
      <div class="rt-line rt-muted">${ago(last.ts) <= 1 ? "just now" : `${ago(last.ts)} min ago`}${last.wlull != null ? ` · lull ${Math.round(last.wlull)}` : ""}</div>`
    : html`<div class="rt-line">No recent reading</div>`}
    <div class="rt-rule"></div>
    <span class="rt-label">Finish · ${site.finishName}</span>
    <div class="rt-line">${finish ? html`<b>${Math.round(finish.wavg)} kn</b>${finish.wgust != null ? ` g${Math.round(finish.wgust)}` : ""} ${compassPoint(finish.wdir)} ${Math.round(finish.wdir)}°${site.against(finish.wdir) ? html` <span class="rt-badge" style="font-size: 14px; padding: 0 6px; border-width: 2px">against the run</span>` : ""}` : html`<span class="rt-muted">No recent reading</span>`}</div>
    <div class="rt-rule"></div>
    <div class="rt-line" style="font-size: 16px">${ratingLine()}</div>
  </div>`;

// Outside the go window: the next day's forecast peak instead of readings.
const outlookLeft = html`<div class="rt-now">
    <span class="rt-label">${dayName} · forecast</span>
    ${peak ? html`<div class="rt-big">${Math.round(peak.wavg)}<small> kn</small></div>
      <div class="rt-dir">${compassPoint(peak.wdir)} ${Math.round(peak.wdir)}° ${badge(peak.cls)}</div>
      <div class="rt-line rt-muted">peak, around ${hh(peak.ts)}</div>`
    : html`<div class="rt-line">No forecast yet</div>`}
    ${day === today ? "" : html`<div class="rt-rule"></div>
    <span class="rt-label">Today</span>
    <div class="rt-line">${(() => {
      const top = d3.greatest(obs.filter(d => d.ts >= goStart && d.ts <= goEnd), d => d.wavg);
      return top ? html`Strongest <b>${Math.round(top.wavg)} kn</b> ${compassPoint(top.wdir)} at ${hh(top.ts)}` : html`<span class="rt-muted">No readings</span>`;
    })()}</div>`}
    <div class="rt-rule"></div>
    <div class="rt-line rt-muted">Live from ${String(GO_START).padStart(2, "0")}:00</div>
  </div>`;

const panel = html`<div class="rt">
  <div class="rt-head">
    <h1>${site.title}</h1>
    <span class="rt-meta">${isLive ? html`${today} · ${hh(now)} · sunset ${hh(set)}` : html`${day} · sunrise ${hh(sun.rise)} · sunset ${hh(sun.set)}`}</span>
  </div>
  ${isLive ? liveLeft : outlookLeft}
  <div class="rt-chart">
    <div class="rt-summary">${summary()}</div>
    ${chart}
  </div>
  <div class="rt-days">${days.map(d => html`<div class="rt-day">
    <span>${weekday(d.day)} ${d.day.slice(5)}</span>
    <b>${Math.round(d.wavg)} kn ${Math.round(d.wdir)}°</b>
    ${badge(d.cls, true)}
  </div>`)}</div>
</div>`;
display(panel);
document.documentElement.dataset.ready = "";
```
