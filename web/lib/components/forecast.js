import * as Plot from 'npm:@observablehq/plot';
import * as d3 from 'npm:d3';
import {html} from 'npm:htl';
import {FileAttachment} from 'observablehq:stdlib';
import * as fmt from './formatters.js';
import {CLASSES, windClass} from './wind-quality.js';

// How each station's forecast is blended from the models in wind_forecast
// (db/forecast-ingest). The numbers were fitted against the stations'
// own readings; see _about in the file.
const CONFIG = (await FileAttachment('../data/wind-forecast.json').json()).stations;

const HOUR = 3600e3;
const RIDEABLE = new Set(['magic', 'good', 'hard']);
const SPOTS = {kihei: [20.785, -156.466], hookipa: [20.933, -156.357]};

// The Hawaii day ('YYYY-MM-DD') a time falls on, and the hour there.
export const hstDay = t => new Date(+t - 10 * HOUR).toISOString().slice(0, 10);
const hstHour = t => new Date(+t - 10 * HOUR).getUTCHours();

// Sunrise and sunset for a Hawaii day (the usual sunrise equation, good to
// a minute or two), as Dates.
export function sunTimes(day, [lat, lon]) {
  const rad = Math.PI / 180;
  const noon = Date.parse(`${day}T22:00:00Z`); // noon HST
  // Days since J2000 to the solar noon nearest local noon.
  const n = Math.round(noon / 86400e3 + 2440587.5 - 2451545 + lon / 360);
  const j = n - lon / 360;
  const m = (357.5291 + 0.98560028 * j) % 360;
  const c = 1.9148 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 0.0003 * Math.sin(3 * m * rad);
  const l = (m + c + 180 + 102.9372) % 360;
  const transit = 2451545 + j + 0.0053 * Math.sin(m * rad) - 0.0069 * Math.sin(2 * l * rad);
  const decl = Math.asin(Math.sin(l * rad) * Math.sin(23.4397 * rad));
  const w = Math.acos((Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl))) / rad;
  const date = jd => new Date((jd - 2440587.5) * 86400e3);
  return {rise: date(transit - w / 360), set: date(transit + w / 360)};
}

// Each model's newest run, as hours: [{ts, models: {model: {wavg, wdir}}}].
function newestRuns(rows) {
  const newest = d3.rollup(rows.filter(d => d.issued), v => d3.max(v, d => +d.issued), d => d.model);
  const byHour = d3.group(rows.filter(d => d.issued && +d.issued === newest.get(d.model)), d => +d.ts);
  return [...byHour].map(([ts, v]) => ({ts: new Date(ts), models: Object.fromEntries(v.map(d => [d.model, d]))}))
    .sort((a, b) => a.ts - b.ts);
}

const meanDir = ds => (Math.atan2(d3.mean(ds, d => Math.sin(d * Math.PI / 180)), d3.mean(ds, d => Math.cos(d * Math.PI / 180))) * 180 / Math.PI + 360) % 360;

// The models' average speed and the direction to use for one hour, or null
// when a model is missing.
function blendHour(site, h) {
  const {models, directionModel} = CONFIG[site];
  if (!models.every(m => h.models[m])) return null;
  const avg = d3.mean(models, m => h.models[m].wavg);
  const wdir = directionModel ? h.models[directionModel].wdir : meanDir(models.map(m => h.models[m].wdir));
  return {avg, wdir};
}

// Hourly forecast for one site: the calibrated blend, plus the station's
// current error (its last half hour vs the blend then), fading over the
// next few hours. obs are the station's readings, oldest first.
export function hourlyForecast(site, rows, obs, now = new Date()) {
  const cfg = CONFIG[site];
  const hours = newestRuns(rows).map(h => {
    const b = blendHour(site, h);
    if (!b) return null;
    const k = String(Math.min(18, Math.max(7, hstHour(h.ts))));
    return {ts: h.ts, wavg: cfg.hourly[k].a + cfg.hourly[k].b * b.avg, wdir: b.wdir};
  }).filter(Boolean);
  let offset = 0;
  const last = obs.at(-1);
  if (last && now - last.ts < HOUR) {
    const recent = obs.filter(d => last.ts - d.ts <= HOUR / 2);
    const at = d3.least(hours, h => Math.abs(h.ts - last.ts));
    if (at && Math.abs(at.ts - last.ts) <= HOUR) offset = d3.mean(recent, d => d.wavg) - at.wavg;
  }
  return {
    offset,
    hours: hours.map(h => {
      const ahead = (h.ts - now) / HOUR;
      const wavg = Math.max(0, h.wavg + (ahead > -1 ? offset * Math.exp(-Math.max(0, ahead) / cfg.nowcastHours) : 0));
      return {...h, wavg, cls: windClass(site, {wavg, wdir: h.wdir})};
    }),
  };
}

// Coming afternoons (12-16 HST mean), today's only while it's still ahead.
export function outlook(site, rows, now = new Date()) {
  const cfg = CONFIG[site];
  const byDay = d3.group(newestRuns(rows).filter(h => hstHour(h.ts) >= 12 && hstHour(h.ts) <= 16), h => hstDay(h.ts));
  return [...byDay].map(([day, hs]) => {
    const bs = hs.map(h => blendHour(site, h)).filter(Boolean);
    if (bs.length < 4) return null;
    const wavg = cfg.afternoon.a + cfg.afternoon.b * d3.mean(bs, b => b.avg);
    const wdir = meanDir(bs.map(b => b.wdir));
    return {day, wavg, wdir, cls: windClass(site, {wavg, wdir})};
  }).filter(d => d && (d.day > hstDay(now) || hstHour(now) < 16)).sort((a, b) => d3.ascending(a.day, b.day));
}

const clsColor = c => CLASSES[c]?.color ?? 'var(--theme-foreground-faint)';
const hourLabel = t => `${String(hstHour(t)).padStart(2, '0')}:00`;
const weekday = day => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', timeZone: 'UTC'});

// The "rest of today" card: the station so far, the forecast for the
// rest of the daylight, and the coming afternoons. obs are today's
// readings, oldest first; rows the forecast rows for today and on.
// resize is the page's (Framework's) resize, for the chart's width.
export function forecastCard(site, rows, obs, {now = new Date(), name = 'Forecast', resize} = {}) {
  const cfg = CONFIG[site];
  const today = hstDay(now);
  const {rise, set} = sunTimes(today, SPOTS[site]);
  const {offset, hours} = hourlyForecast(site, rows, obs, now);
  const daylight = hours.filter(h => h.ts >= +rise - HOUR / 2 && h.ts <= set);
  const ahead = daylight.filter(h => h.ts >= now);
  const days = outlook(site, rows, now);
  const err = cfg.typicalError.hourly;

  let summary;
  if (now > set) summary = html`<span class="muted">Dark for the rest of today.</span>`;
  else if (!ahead.length) summary = html`<span class="muted">No forecast for the rest of today yet.</span>`;
  else {
    const ok = ahead.filter(h => RIDEABLE.has(h.cls));
    const peak = d3.greatest(ahead, h => h.wavg);
    summary = ok.length
      ? html`Rideable from about <b>${hourLabel(ok[0].ts)}</b> to <b>${hourLabel(ok.at(-1).ts)}</b>, peaking near <b>${Math.round(peak.wavg)} kn</b> at ${hourLabel(peak.ts)} (${Math.round(peak.wdir)}°).`
      : html`Not rideable for the rest of today; peaks near ${Math.round(peak.wavg)} kn at ${hourLabel(peak.ts)} (${Math.round(peak.wdir)}°).`;
  }

  const seen = obs.filter(d => d.ts >= rise);
  const yMax = Math.max(25, d3.max(seen, d => d.wgust) ?? 0, d3.max(ahead, h => h.wavg + err) ?? 0);
  const chart = now > set || !daylight.length ? '' : resize(width => Plot.plot({
    width, height: 180, marginLeft: 28, marginBottom: 20,
    x: {type: 'time', domain: [rise, set], ticks: 6, tickFormat: fmt.clock, label: null},
    y: {domain: [-2.5, yMax], ticks: [0, 10, 20, 30, 40].filter(t => t <= yMax), label: null, grid: true},
    marks: [
      Plot.rectY(ahead, {x1: h => new Date(+h.ts - HOUR / 2), x2: h => new Date(Math.min(+h.ts + HOUR / 2, +set)), y1: -2.5, y2: -0.8, fill: h => clsColor(h.cls)}),
      Plot.areaY(ahead, {x: 'ts', y1: h => h.wavg - err, y2: h => h.wavg + err, fill: 'var(--theme-foreground-focus)', fillOpacity: 0.1, curve: 'monotone-x'}),
      Plot.lineY(daylight.filter(h => h.ts >= +now - HOUR), {x: 'ts', y: 'wavg', stroke: 'var(--theme-foreground-focus)', strokeDasharray: '5,4', strokeWidth: 2, curve: 'monotone-x'}),
      Plot.lineY(seen, {x: 'ts', y: 'wgust', stroke: 'var(--theme-foreground-faint)', strokeWidth: 1, curve: 'basis'}),
      Plot.lineY(seen, {x: 'ts', y: 'wavg', stroke: 'var(--theme-foreground)', strokeWidth: 1.5, curve: 'basis'}),
      Plot.ruleX([now], {stroke: 'var(--theme-foreground-muted)', strokeDasharray: '2,2'}),
      Plot.ruleY([15], {stroke: 'var(--theme-foreground-faint)', strokeDasharray: '2,3'}),
      Plot.tip(ahead, Plot.pointerX({x: 'ts', y: 'wavg', title: h => `${hourLabel(h.ts)}  ${Math.round(h.wavg)} kn ± ${Math.round(err)}, ${Math.round(h.wdir)}°${h.cls ? ` · ${CLASSES[h.cls].label}` : ''}`})),
    ],
  }));

  return html`<div class="card fc-card">
    <h2>${name} <span class="muted" style="font-weight: normal">rest of today · sunset ${fmt.clock(set)}</span></h2>
    <div>${summary}</div>
    ${chart}
    ${chart ? html`<div class="muted" style="font-size: 0.85em">Solid: the station today (grey, gusts). Dashed: the forecast, ± ${Math.round(err)} kn shaded, nudged ${offset >= 0 ? '+' : '−'}${Math.abs(offset).toFixed(1)} kn by what the station reads now. The strip is the expected wind class.</div>` : ''}
    ${days.length ? html`<div class="fc-days">${days.map(d => html`<div class="fc-day" style="--wq: ${clsColor(d.cls)}">
      <span class="muted">${d.day === today ? 'Today' : weekday(d.day)} ${d.day.slice(5)}</span>
      <b>${Math.round(d.wavg)} kn · ${Math.round(d.wdir)}°</b>
      <span>${d.cls ? CLASSES[d.cls].label : ''}</span>
    </div>`)}</div>
    <div class="muted" style="font-size: 0.85em">Coming afternoons, 12–16 average, typically within ${Math.round(cfg.typicalError.afternoon)} kn a day ahead; further out is rougher.</div>` : ''}
  </div>`;
}

// Today's rideable stretch for a site: the hours ahead in daylight whose
// class is rideable, with the peak among them. null when it's dark or
// there's no forecast left for today.
export function todayWindow(site, rows, obs, now = new Date()) {
  const {rise, set} = sunTimes(hstDay(now), SPOTS[site]);
  const {hours} = hourlyForecast(site, rows, obs, now);
  const daylight = hours.filter(h => h.ts >= +rise - HOUR / 2 && h.ts <= set);
  const ahead = daylight.filter(h => h.ts >= +now - HOUR / 2);
  if (now > set || !ahead.length) return {rise, set, daylight, ahead, ok: [], peak: null};
  const ok = ahead.filter(h => RIDEABLE.has(h.cls));
  return {rise, set, daylight, ahead, ok, peak: d3.greatest(ok.length ? ok : ahead, h => h.wavg)};
}

// A small card for the hub: today's rideable hours as a strip and a line,
// and the next couple of afternoons.
export function forecastMini(site, rows, obs, {now = new Date(), name, href, days = 2} = {}) {
  const w = todayWindow(site, rows, obs, now);
  const coming = outlook(site, rows, now).filter(d => d.day > hstDay(now)).slice(0, days);
  let line;
  if (now > w.set) line = html`<span class="nav-muted">Dark for today</span>`;
  else if (!w.ahead.length) line = html`<span class="nav-muted">No forecast for today yet</span>`;
  else if (w.ok.length) line = html`${hourLabel(w.ok[0].ts)}–${hourLabel(w.ok.at(-1).ts)} <span class="unit">~${Math.round(w.peak.wavg)} kn ${Math.round(w.peak.wdir)}° ${CLASSES[w.peak.cls].label}</span>`;
  else line = html`<span class="unit">Not rideable today · peak ~${Math.round(w.peak.wavg)} kn</span>`;
  const t0 = +w.rise, t1 = +w.set, pct = t => `${(100 * (t - t0) / (t1 - t0)).toFixed(2)}%`;
  const strip = w.daylight.length && now <= w.set ? html`<div class="fc-strip">${w.daylight.map(h => html`<span style="left: ${pct(Math.max(t0, +h.ts - HOUR / 2))}; right: calc(100% - ${pct(Math.min(t1, +h.ts + HOUR / 2))}); background: ${clsColor(h.cls)}; opacity: ${h.ts < now ? 0.35 : 1}" title="${hourLabel(h.ts)} ${Math.round(h.wavg)} kn ${Math.round(h.wdir)}°${h.cls ? ` · ${CLASSES[h.cls].label}` : ''}"></span>`)}
    <i style="left: ${pct(Math.min(t1, Math.max(t0, +now)))}"></i></div>
    <div class="fc-strip-ends nav-muted"><span>${fmt.clock(w.rise)}</span><span>${fmt.clock(w.set)}</span></div>` : '';
  const body = html`<h2>${name} forecast <span class="nav-card-arrow">→</span></h2>
    <div class="nav-lead">${line}</div>
    ${strip}
    ${coming.length ? html`<div class="fc-minidays">${coming.map(d => html`<span class="fc-miniday" style="--wq: ${clsColor(d.cls)}"><span class="nav-muted">${weekday(d.day)}</span> ${Math.round(d.wavg)} kn ${d.cls ? CLASSES[d.cls].label : ''}</span>`)}</div>` : ''}`;
  return href ? html`<a class="card nav-card" href=${href}>${body}</a>` : html`<div class="card">${body}</div>`;
}

// The Kīhei run's finish: PacIOOS's newest run for its cell off Wailea
// Beach, as is (nothing to calibrate against yet), with the Wailea station
// today. rows are wind_forecast rows for site wailea.
const WAILEA = [20.686, -156.443];
const FINISHES = {
  wailea: {place: "Wailea", spot: WAILEA, note: "Dashed: PacIOOS for the water just off Wailea Beach, uncorrected. Solid: the Wailea station today (inland, so it reads lower than the water)."},
  kanaha: {place: "Kanaha", spot: [20.898, -156.437], note: "Dashed: PacIOOS for the water just off Kanaha Beach Park, uncorrected. Solid: the Kanaha station today."},
};
export function finishCard(rows, obs, {now = new Date(), resize, site = "wailea"} = {}) {
  const {place, spot, note} = FINISHES[site];
  const {rise, set} = sunTimes(hstDay(now), spot);
  const hours = newestRuns(rows.filter(d => d.model === 'pacioos_wrf_mo'))
    .map(h => ({ts: h.ts, ...h.models.pacioos_wrf_mo}))
    .filter(h => h.ts >= +rise - HOUR / 2 && h.ts <= set);
  const ahead = hours.filter(h => h.ts >= +now - HOUR / 2);
  const title = html`<h2>${place} finish <span class="muted" style="font-weight: normal">rough · PacIOOS as is</span></h2>`;
  if (now > set) return html`<div class="card fc-card">${title}<div class="muted">Dark for the rest of today.</div></div>`;
  if (!ahead.length) return html`<div class="card fc-card">${title}<div class="muted">No ${place} forecast for the rest of today yet.</div></div>`;
  const at = hh => d3.least(ahead, h => Math.abs(hstHour(h.ts) - hh));
  const marks = [12, 14, 16].map(at).filter(h => h && h.ts >= +now - HOUR / 2);
  const seen = obs.filter(d => d.ts >= rise);
  const yMax = Math.max(20, d3.max(seen, d => d.wgust) ?? 0, d3.max(ahead, h => h.wavg) ?? 0);
  return html`<div class="card fc-card">${title}
    <div>${marks.length
      ? html`Model says ${marks.map((h, i) => html`${i ? ', ' : ''}<b>${Math.round(h.wavg)} kn</b> at ${hourLabel(h.ts)} (${Math.round(h.wdir)}°)`)}.`
      : html`Model says ~${Math.round(ahead.at(-1).wavg)} kn by ${hourLabel(ahead.at(-1).ts)}.`}</div>
    ${resize(width => Plot.plot({
      width, height: 140, marginLeft: 28, marginBottom: 20,
      x: {type: 'time', domain: [rise, set], ticks: 6, tickFormat: fmt.clock, label: null},
      y: {domain: [0, yMax], ticks: [0, 10, 20, 30].filter(t => t <= yMax), label: null, grid: true},
      marks: [
        Plot.lineY(hours, {x: 'ts', y: 'wavg', stroke: 'var(--theme-foreground-focus)', strokeDasharray: '5,4', strokeWidth: 2, curve: 'monotone-x'}),
        Plot.lineY(seen, {x: 'ts', y: 'wgust', stroke: 'var(--theme-foreground-faint)', strokeWidth: 1, curve: 'basis'}),
        Plot.lineY(seen, {x: 'ts', y: 'wavg', stroke: 'var(--theme-foreground)', strokeWidth: 1.5, curve: 'basis'}),
        Plot.ruleX([now], {stroke: 'var(--theme-foreground-muted)', strokeDasharray: '2,2'}),
        Plot.tip(hours, Plot.pointerX({x: 'ts', y: 'wavg', title: h => `${hourLabel(h.ts)}  ${Math.round(h.wavg)} kn, ${Math.round(h.wdir)}° (model)`})),
      ],
    }))}
    <div class="muted" style="font-size: 0.85em">${note} Not yet checked against what the finish actually does.</div>
  </div>`;
}
