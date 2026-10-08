import * as d3 from 'npm:d3';
import {html} from 'npm:htl';
import * as fmt from './formatters.js';

const TZ = 'Pacific/Honolulu';
const dayKey = d3.utcFormat('%Y-%m-%d');
const hstParts = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'});

// The run's calendar day in Hawaii, regardless of the viewer's timezone.
export function hstDay(ts) {
  return hstParts.format(ts);
}

// Kihei runs normally go north to south with the trades.  A run that
// finishes at least a kilometer north of where it started went the other
// way (e.g. Wailea -> Green Church, Kalepolepo -> Sugar Beach).
export const REVERSE_MIN_KM = 1;
export function isReverse(d) {
  if (d.region !== 'Kihei') return false;
  if (d.start_lat == null || d.end_lat == null) return false;
  return (d.end_lat - d.start_lat) * 111 >= REVERSE_MIN_KM;
}

const when = new Intl.DateTimeFormat('en-US', {timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'});

function star(x, y, R) {
  const pts = d3.range(10).map(i => {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? R * 0.42 : R;
    return `${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`;
  });
  return `M${pts.join('L')}Z`;
}

function tipHTML(run) {
  const w = run.wind_data;
  const tags = [isReverse(run) ? 'reverse' : null, run.dry ? '★ dry' : null].filter(Boolean).join(' · ');
  return html`<div class="cal-tip-when">${when.format(run.ts)}</div>
    <div class="cal-tip-route">${run.start_beach} → ${run.end_beach}${tags ? html` <span class="cal-tip-tags">${tags}</span>` : ''}</div>
    <div>${run.distance_km.toFixed(1)} km in ${fmt.seconds(run.duration_sec)}${run.has_track ? ` · ${(100 * run.pct_dist_on_foil).toFixed(0)}% on foil` : ''}</div>
    ${run.has_track ? html`<div>top ${run.max_speed_kmh.toFixed(1)} kph${run.max_speed_1k ? ` · best 1k ${fmt.pace(run.max_speed_1k)}` : ''}</div>` : ''}
    ${w.avg_avg ? html`<div>wind ${fmt.wind(w.avg_avg, w.gust_max, w.avg_dir)}</div>` : ''}
    <div class="cal-tip-gear">${run.foil}</div>`;
}

let tipEl = null;
function tip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'cal-tip';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}
function showTip(event, run) {
  const t = tip();
  t.replaceChildren(tipHTML(run));
  t.style.display = 'block';
  const b = event.currentTarget.getBoundingClientRect();
  const left = Math.min(window.innerWidth - t.offsetWidth - 8, Math.max(8, b.left + b.width / 2 - t.offsetWidth / 2));
  const above = b.top - t.offsetHeight - 8;
  t.style.left = `${left + window.scrollX}px`;
  t.style.top = `${(above > 0 ? above : b.bottom + 8) + window.scrollY}px`;
}
function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

const CELL = 26;
const HEAD = 34;

function month(m, byDay, color, r) {
  const y = m.getUTCFullYear(), mo = m.getUTCMonth();
  const first = new Date(Date.UTC(y, mo, 1));
  const days = d3.utcDays(first, new Date(Date.UTC(y, mo + 1, 1)));
  const offset = first.getUTCDay();
  const rows = Math.ceil((offset + days.length) / 7);
  const w = CELL * 7, h = HEAD + rows * CELL;
  const runs = days.flatMap(d => byDay.get(dayKey(d)) || []);
  const km = d3.sum(runs, d => d.distance_km);

  const today = hstDay(new Date());
  const root = d3.create('svg').attr('viewBox', `0 0 ${w} ${h}`);
  root.append('text').attr('x', 1).attr('y', 13).attr('class', 'cal-title').text(d3.utcFormat('%b %Y')(first));
  root.append('text').attr('x', w - 1).attr('y', 13).attr('class', 'cal-sum').attr('text-anchor', 'end')
    .text(runs.length ? `${runs.length} · ${Math.round(km)} km` : '');
  'SMTWTFS'.split('').forEach((c, i) =>
    root.append('text').attr('x', i * CELL + CELL / 2).attr('y', HEAD - 6).attr('class', 'cal-dow').text(c));

  days.forEach((d, i) => {
    const k = offset + i, cx = (k % 7) * CELL, cy = HEAD + Math.floor(k / 7) * CELL;
    const dayRuns = byDay.get(dayKey(d)) || [];
    const n = dayRuns.length;
    if (dayKey(d) > today) return;
    const g = root.append('g');
    g.append('rect').attr('x', cx + 1).attr('y', cy + 1).attr('width', CELL - 2).attr('height', CELL - 2)
      .attr('rx', 3).attr('class', n ? 'cal-day on' : 'cal-day');
    if (!n) {
      g.append('text').attr('x', cx + CELL / 2).attr('y', cy + CELL / 2 + 3).attr('class', 'cal-num').text(d.getUTCDate());
      return;
    }
    // One run centered; several spread across the cell.
    const spots = n === 1 ? [[0.5, 0.5]]
      : n === 2 ? [[0.3, 0.5], [0.7, 0.5]]
      : n === 3 ? [[0.3, 0.32], [0.7, 0.32], [0.5, 0.72]]
      : [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
    const scale = n === 1 ? 1 : 0.62;
    dayRuns.slice(0, 4).forEach((run, j) => {
      const [fx, fy] = spots[j];
      const x = cx + fx * CELL, yy = cy + fy * CELL;
      let rr = Math.max(2, r(run.distance_km) * scale);
      const a = g.append('a').attr('href', `/run.html?id=${run.id}`)
        .on('pointerenter', e => showTip(e, run)).on('pointerleave', hideTip);
      if (run.dry) rr = Math.max(rr, isReverse(run) ? 6 : 4.5);
      if (isReverse(run))
        a.append('path').attr('d', `M${x},${yy - rr * 1.35}L${x + rr * 1.2},${yy + rr * 0.8}L${x - rr * 1.2},${yy + rr * 0.8}Z`)
          .attr('fill', color(run.region)).attr('class', 'cal-rev');
      else
        a.append('circle').attr('cx', x).attr('cy', yy).attr('r', rr).attr('fill', color(run.region));
      if (run.dry) a.append('path').attr('d', star(x, isReverse(run) ? yy + rr * 0.15 : yy, rr * (isReverse(run) ? 0.68 : 0.75))).attr('class', 'cal-dry');
    });
  });
  return html`<div class="cal-month">${root.node()}</div>`;
}

export function runCalendar(runs, color, opts = {}) {
  const byDay = d3.group(runs, d => hstDay(d.ts));
  const r = d3.scaleSqrt().domain([0, d3.max(runs, d => d.distance_km)]).range([0, CELL * 0.44]);
  const keys = [...byDay.keys()].sort();
  const [y0, m0] = keys[0].split('-').map(Number), [y1, m1] = keys[keys.length - 1].split('-').map(Number);
  const months = d3.utcMonths(new Date(Date.UTC(y0, m0 - 1, 1)), new Date(Date.UTC(y1, m1, 1))).reverse();
  return html`<div class="cal-grid">${months.map(m => month(m, byDay, color, r))}</div>`;
}
