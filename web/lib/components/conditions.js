// Cards shared by the spot pages (kihei.md, maliko.md): the run rating, a
// wind station's last hours, past runs in wind like now, and cam motion.
//
// `resize` is Framework's builtin, which only exists in page code, so
// callers pass it in.

import * as Plot from 'npm:@observablehq/plot';
import {html} from 'npm:htl';
import * as fmt from './formatters.js';
import {compassPoint} from './spectrum.js';
import {qualityStrip, qualityBadge} from './wind-quality.js';

const RATING_STALE = 30 * 60e3;

// Node-RED's run rating, led by this page's side of it. side is the
// rating's key (kihei, ns) and name the rating's own name for it in rec.
const SIDES = [['kihei', 'Kīhei'], ['ns', 'North shore']];
export function ratingCard(r, side) {
  if (!r) return html`<div class="card"><h2>Run rating</h2><div class="muted">No current rating</div></div>`;
  // A stale rating (Node-RED stops rating at night) or one made in the dark
  // says nothing about now, so show no score at all.
  if (Date.now() - r.ts > RATING_STALE || r.dark)
    return html`<div class="card"><h2>Run rating</h2><div class="muted">${r.dark ? 'Dark, no rating' : `No current rating (last one ${fmt.relativeTime(r.ts)})`}</div></div>`;
  const out10 = s => `${Math.round(s * 2.5)}/10`;
  const best = name => {
    const rec = r.rec.toLowerCase(), n = name.toLowerCase();
    return rec === n || rec.includes(`${n} slightly better`);
  };
  const [mine, other] = side === 'ns' ? [SIDES[1], SIDES[0]] : SIDES;
  return html`<div class="card">
    <h2>Run rating <span class="muted" style="font-weight: normal">${fmt.relativeTime(r.ts)}</span></h2>
    <div class="rating-row">
      <span class="lead ${best(mine[1]) ? 'rating-best' : ''}">${mine[1]} ${out10(r[mine[0]])}</span>
      <span class="muted">${other[1]} ${out10(r[other[0]])}</span>
      <span class="muted">Best bet: ${r.rec}</span>
    </div>
  </div>`;
}

// One station's readings over xDomain, on the page's shared wind scale.
export function stationCard({site, name, where, rows, live}, yMax, xDomain, {resize, hours}) {
  const last = rows.at(-1);
  if (!last) return html`<div class="card"><h2>${name}</h2><div class="muted">No recent readings</div></div>`;
  return html`<div class="card">
    <h2>${name} <span class="muted" style="font-weight: normal">${where} · ${live ? 'live · ' : ''}${fmt.relativeTime(last.ts)}</span></h2>
    <div class="lead">${last.wavg.toFixed(0)} <span class="unit">kn</span>${last.wgust == null ? '' : ` g${last.wgust.toFixed(0)}`}${last.wdir == null ? '' : html` <span class="unit">${compassPoint(last.wdir)} ${Math.round(last.wdir)}°</span>`} ${qualityBadge(site, last)}</div>
    ${resize(width => Plot.plot({
      width, height: 110, marginLeft: 28, marginBottom: 20,
      x: {type: 'time', domain: xDomain, ticks: 6, tickFormat: fmt.clock, label: null},
      y: {domain: [-2.5, yMax], ticks: [0, 10, 20, 30].filter(t => t <= yMax), label: null, grid: true},
      marks: [
        qualityStrip(site, rows, {y1: -2.5, y2: -0.8}),
        Plot.areaY(rows, {x: 'ts', y1: d => d.wlull ?? d.wavg, y2: 'wgust', fill: 'var(--theme-foreground-focus)', fillOpacity: 0.15, curve: 'basis'}),
        Plot.lineY(rows, {x: 'ts', y: 'wavg', stroke: 'var(--theme-foreground-focus)', curve: 'basis'}),
        Plot.ruleY([15], {stroke: 'var(--theme-foreground-faint)', strokeDasharray: '2,3'}),
        Plot.tip(rows, Plot.pointerX({x: 'ts', y: 'wavg', title: d => `${fmt.clock(d.ts)}  ${d.wavg.toFixed(0)}${d.wgust == null ? '' : `g${d.wgust.toFixed(0)}`} kn ${d.wdir == null ? '' : `${Math.round(d.wdir)}°`}`})),
      ],
    }))}
    <div class="muted" style="font-size: 0.85em">last ${hours} hours · dashed line 15 kn</div>
  </div>`;
}

// Past runs in region whose average wind (at the region's station) was
// close to the station's last reading: within 3 kn and 20°, closest first.
export function similarRuns(runs, region, now) {
  if (!now) return [];
  const dAngle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  return runs
    .filter(d => d.region === region && d.avg_wavg != null && d.avg_wdir != null)
    .map(d => ({...d, dKn: d.avg_wavg - now.wavg, dDeg: dAngle(d.avg_wdir, now.wdir)}))
    .filter(d => Math.abs(d.dKn) <= 3 && d.dDeg <= 20)
    .map(d => ({...d, score: Math.abs(d.dKn) / 3 + d.dDeg / 20}))
    .sort((a, b) => a.score - b.score);
}

// Past runs whose mid-run Pauwela report (snapshots: run id -> buoy
// snapshot, from runBuoySnapshots) was close to the buoy's report now:
// within 1.5 ft, 2 s and 25°, closest first. Wind differences come along
// for the table but don't filter.
export const BUOY_LIMITS = {ft: 1.5, s: 2, deg: 25};
export function similarBuoyRuns(runs, snapshots, buoy, wind) {
  if (!buoy) return [];
  const dAngle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  return runs
    .map(d => ({...d, buoy: snapshots.get(d.id)?.primary}))
    .filter(d => d.buoy)
    .map(d => ({...d, dFt: d.buoy.height - buoy.height, dS: d.buoy.period - buoy.period, dBuoyDeg: dAngle(d.buoy.direction, buoy.direction)}))
    .filter(d => Math.abs(d.dFt) <= BUOY_LIMITS.ft && Math.abs(d.dS) <= BUOY_LIMITS.s && d.dBuoyDeg <= BUOY_LIMITS.deg)
    .map(d => ({...d, score: Math.abs(d.dFt) / BUOY_LIMITS.ft + Math.abs(d.dS) / BUOY_LIMITS.s + d.dBuoyDeg / BUOY_LIMITS.deg
      + (wind && d.avg_wavg != null ? Math.abs(d.avg_wavg - wind.wavg) / 6 : 0)}))
    .sort((a, b) => a.score - b.score);
}

const runLink = d => `https://${d.riderSlug}.downwind.pro/run.html?id=${d.id}`;

// The similar runs as a card: what was matched, then the closest few.
// note replaces the line above the table (what was matched); buoy adds a
// column with each run's mid-run Pauwela report.
export function similarRunsCard(similar, now, {station, region, shown = 10, note, buoy = false}) {
  const rows = similar.slice(0, shown);
  return html`<div class="card">
    <div class="muted" style="margin-bottom: 0.5rem">${note ?? (now ? `${region} runs that averaged ${Math.max(0, now.wavg - 3).toFixed(0)}–${(now.wavg + 3).toFixed(0)} kn within 20° of ${Math.round(now.wdir)}° at the ${station} station: ${similar.length} of them, closest ${rows.length} shown.` : `No current ${station} reading.`)}</div>
    <div class="similar-wrap"><table class="similar">
      <thead><tr><th>Date</th><th>Rider</th><th>Route</th><th class="num">km</th><th class="num">on foil</th><th class="num">top km/h</th><th class="num">wind</th>${buoy ? html`<th class="num">buoy</th>` : ''}</tr></thead>
      <tbody>${rows.map(d => html`<tr>
        <td><a href=${runLink(d)}>${fmt.date(d.ts)} ${fmt.clock(d.ts)}</a></td>
        <td>${d.riderName}</td>
        <td>${d.start_beach}${d.end_beach !== d.start_beach ? ` → ${d.end_beach}` : ''}</td>
        <td class="num">${d.distance_km.toFixed(1)}</td>
        <td class="num">${d.distance_on_foil == null ? '' : `${Math.round(100 * d.distance_on_foil / (d.distance_km * 1000))}%`}</td>
        <td class="num">${d.max_speed_kmh == null ? '' : d.max_speed_kmh.toFixed(0)}</td>
        <td class="num">${d.avg_wavg == null ? '' : `${d.avg_wavg.toFixed(0)}g${d.avg_wgust.toFixed(0)} ${Math.round(d.avg_wdir)}°`}</td>
        ${buoy ? html`<td class="num">${d.buoy ? `${d.buoy.height.toFixed(1)}′ ${d.buoy.period.toFixed(0)}s ${Math.round(d.buoy.direction)}°` : ''}</td>` : ''}
      </tr>`)}</tbody>
    </table></div>
  </div>`;
}

const hstDay = t => new Date(t - 10 * 3600e3).toISOString().slice(0, 10);

// A cam's water motion (db/cams/cam_motion.py): the latest reading, its
// arrow overlay and the day's dx. dx < 0 is right to left in the picture;
// left/right name where that goes. mark ({dx, label}) draws a dashed line at
// a calibrated dx; px/s differ between cams. read is a vision read, if any.
export function camCard({name, readings, left, right, mark}, read, {resize}) {
  const measured = readings.filter(d => !d.skipped && d.dx != null);
  const last = readings.at(-1);
  const r = measured.at(-1);
  if (!r) return html`<div class="card"><h2>${name}</h2><div class="muted">No readings today or yesterday</div></div>`;
  const toward = r.dx < 0 ? left : right;
  const share = r.dx < 0 ? r.left : r.right;
  const img = r.images.flow ?? r.images.frame;
  const today = measured.filter(d => hstDay(d.ts) === hstDay(r.ts));
  return html`<div class="card">
    <h2>${name} <span class="muted" style="font-weight: normal">water motion · ${fmt.minuteStamp(r.ts)}</span></h2>
    <div class="lead">${Math.abs(r.dx).toFixed(1)} <span class="unit">px/s ${toward} · ${Math.round(100 * share)}% of the moving water${r.whitecaps == null ? "" : ` · ${r.whitecaps} whitecap${r.whitecaps === 1 ? "" : "s"}`}</span></div>
    ${last?.skipped ? html`<div class="muted">Not measuring since ${fmt.clock(last.ts)} (${last.skipped}).</div>` : ""}
    ${read ? html`<div class="muted" style="margin-top: 0.25rem">Vision read ${fmt.clock(new Date(read.stamp))}: ${read.sea}${read.shorebreak ? `, shorebreak ${read.shorebreak}` : ""}. ${read.description ?? ""}</div>` : ""}
    <div class="grid grid-cols-2" style="margin: 0.5rem 0 0">
      <div>${img ? html`<a href=${r.images.frame ?? img} target="_blank"><img class="cam-img" src=${img} alt="${name}: water with motion arrows"></a>` : ""}</div>
      <div>${resize(width => Plot.plot({
        width, height: 180, marginLeft: 32, marginBottom: 20,
        x: {type: "time", ticks: 4, tickFormat: fmt.clock, label: null},
        y: {label: `← ${left} (px/s)`, grid: true, reverse: true},
        marks: [
          Plot.ruleY([0], {stroke: "var(--theme-foreground-faint)"}),
          mark ? Plot.ruleY([mark.dx], {stroke: "var(--theme-foreground-faint)", strokeDasharray: "2,3"}) : null,
          Plot.lineY(today, {x: "ts", y: "dx", stroke: "var(--theme-foreground-focus)", curve: "basis"}),
          Plot.dot(today, {x: "ts", y: "dx", r: d => Math.sqrt(d.whitecaps ?? 0), fill: "var(--theme-foreground-focus)", fillOpacity: 0.3}),
          Plot.tip(today, Plot.pointerX({x: "ts", y: "dx", title: d => `${fmt.clock(d.ts)}  ${d.dx.toFixed(1)} px/s, ${Math.round(100 * (d.dx < 0 ? d.left : d.right))}% ${d.dx < 0 ? "left" : "right"}${d.whitecaps == null ? "" : `, ${d.whitecaps} whitecaps`}`}))
        ]
      }))}
      <div class="muted" style="font-size: 0.85em">${fmt.date(r.ts)}: dots sized by whitecaps${mark ? `; dashed line ${mark.dx} px/s, ${mark.label}` : ""}.</div></div>
    </div>
  </div>`;
}
