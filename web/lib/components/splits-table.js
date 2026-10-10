import * as fmt from './formatters.js';
import * as d3 from 'npm:d3';

// Same idea as the runs table: desktop keeps the full splits table and phones
// get one compact row per km instead. Both are rendered and CSS picks one at
// the breakpoint.

const STYLE = `
.splits-narrow { display: none; }
@media (max-width: 640px) {
  .splits-responsive > .splits-wide { display: none; }
  .splits-responsive > .splits-narrow { display: block; }
}
.split-row {
  padding: 0.45rem 0.2rem;
  border-top: solid 1px var(--theme-foreground-faintest);
  font-variant-numeric: tabular-nums;
}
.split-row:first-child { border-top: none; }
.split-top { display: flex; align-items: baseline; gap: 0.6rem; }
.split-km { font-weight: 600; min-width: 3.2rem; }
.split-pace { font-weight: 600; color: var(--theme-foreground-focus); }
.split-avg { margin-left: auto; white-space: nowrap; }
.split-bar { position: relative; height: 6px; margin: 0.3rem 0 0.2rem; border-radius: 3px; background: var(--theme-foreground-faintest); }
.split-bar-range { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: green; opacity: 0.3; }
.split-bar-avg { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1px; border-radius: 1px; background: green; }
.split-detail {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--theme-foreground-muted);
}
.split-detail span { white-space: nowrap; }
`;

const kph = v => v.toFixed(1);

function hrText(d) {
  if (!d.avg_hr) return null;
  return `HR ${d.avg_hr.toFixed(0)} (${(d.min_hr ?? 0).toFixed(0)}–${(d.max_hr ?? 0).toFixed(0)})`;
}

function splitRow(d, x, htl) {
  const hr = hrText(d);
  return htl.html`<div class="split-row">
    <div class="split-top">
      <span class="split-km">${d.split} km</span>
      <span class="split-pace">${fmt.minutes(d.avg_pace)}/km</span>
      <span class="split-avg">${kph(d.avg_speed)} kph</span>
    </div>
    <div class="split-bar">
      <div class="split-bar-range" style=${`left: ${x(d.min_speed)}%; width: ${x(d.max_speed) - x(d.min_speed)}%`}></div>
      <div class="split-bar-avg" style=${`left: ${x(d.avg_speed)}%`}></div>
    </div>
    <div class="split-detail">
      <span>${kph(d.min_speed)}–${kph(d.max_speed)} kph</span>
      ${hr ? htl.html`<span>${hr}</span>` : ''}
    </div>
  </div>`;
}

export function splitsList(splits, htl) {
  // One scale for every row so the bars compare across kms.
  const x = d3.scaleLinear([0, d3.max(splits, d => d.max_speed) || 1], [0, 100]).clamp(true);
  return htl.html`<div class="splits-list">${splits.map(d => splitRow(d, x, htl))}</div>`;
}

export function splitsTableOptions() {
  return {
    columns: ['split', 'avg_pace', 'min_speed', 'avg_speed', 'max_speed', 'max_hr', 'min_hr', 'avg_hr'],
    header: {
      split: 'Split',
      avg_pace: 'Avg Pace',
      min_speed: 'Min Speed',
      avg_speed: 'Avg Speed',
      max_speed: 'Max Speed',
      max_hr: 'Max HR',
      min_hr: 'Min HR',
      avg_hr: 'Avg HR'
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
    }
  };
}

// The usual splits table on wide screens, the compact list on phones.
export function responsiveSplitsTable(Inputs, htl, splits) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  return htl.html`<div class="splits-responsive">
    ${style}
    <div class="splits-wide">${Inputs.table(splits, splitsTableOptions())}</div>
    <div class="splits-narrow">${splitsList(splits, htl)}</div>
  </div>`;
}
