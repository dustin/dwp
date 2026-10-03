// Shared rendering for buoy "snapshots" (see fetchBuoySnapshot in data.js):
// the buoy conditions at one moment -- now, or the middle of a run -- and
// side-by-side comparisons of two of them. Used by buoy.md and compare.md.
//
// `resize` is Framework's builtin, which only exists in page code, so
// callers pass it in.

import { html } from 'npm:htl';
import * as fmt from './formatters.js';
import { runMidpoint } from './data.js';
import {
  renderSpectrumComparison,
  renderDirectionComparison,
  formatDirection,
  directionColor,
} from './spectrum.js';
import { partitionReading, spectrumSimilarity } from './spectral-partitions.js';
import { renderPartitionCompass } from './partitions.js';

// A swell system (spectral partition), as one line with a direction swatch.
export function swellLine(d) {
  return html`<span style="display:inline-block;width:0.8em;height:0.8em;border-radius:50%;background:${directionColor(d.direction)};margin-right:0.35em;vertical-align:-0.05em"></span>${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s from ${formatDirection(d.direction)} <span style="color: var(--theme-foreground-muted)">(${d.energy.toFixed(2)} kJ/m²)</span>`;
}

// NDBC's overall sea state reading (swell_partition rank 1).
export function primaryLine(d) {
  return `${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s from ${formatDirection(d.direction)} · ${d.surflineKJ.toFixed(0)} kJ`;
}

// The compass takes NDBC's overall reading (rank 1) plus the spectral partitions.
export function compassValues(snapshot, partitions) {
  return [...(snapshot.primary ? [snapshot.primary] : []), ...partitions];
}

const listStyle = 'margin: 0.25em 0 0 1.1em; padding: 0;';

// One snapshot as a card: label (linked to the run, if it's a run), when,
// NDBC's overall reading, the spectral partitions, and a compass. `s` is a
// snapshot plus {label, color, meta?}.
export function snapshotCard(s, { resize }) {
  const partitions = partitionReading(s.spectrum);
  return html`<div class="card">
    <h2 style="color: ${s.color}; font-weight: 600;">${
      s.meta ? html`<a style="color: inherit" href="run.html?id=${s.meta.id}">${s.label}</a>` : s.label
    }</h2>
    <div style="color: var(--theme-foreground-muted)">${
      s.meta
        ? `Mid-run ${fmt.minuteStamp(runMidpoint(s.meta))}`
        : `Spectrum measured ${fmt.minuteStamp(s.sampleTs ?? s.spectrumTs)}`
    }</div>
    <div style="margin-top: 0.5em;"><b>${s.primary ? primaryLine(s.primary) : 'No NDBC summary'}</b></div>
    <ul style="${listStyle}">${partitions.map(d => html`<li style="margin: 0.15em 0">${swellLine(d)}</li>`)}</ul>
    ${resize(renderPartitionCompass(compassValues(s, partitions), { size: 300, title: '' }))}
  </div>`;
}

// Side-by-side cards plus overlaid spectra and direction-by-period for two
// (or more) snapshots. Snapshots without spectral data still get a card.
export function buoyComparison(snapshots, { resize }) {
  const series = snapshots
    .filter(s => s.spectrum?.length > 0)
    .map(s => ({ label: s.label, color: s.color, rows: s.spectrum }));
  const match =
    series.length === 2 ? spectrumSimilarity(series[0].rows, series[1].rows) : null;
  return html`<div>
    ${match == null
      ? ''
      : html`<p>Spectral match: <b>${Math.round(match * 100)}%</b></p>`}
    <div class="grid grid-cols-2">${snapshots.map(s => snapshotCard(s, { resize }))}</div>
    ${series.length
      ? html`<div class="card">${resize(renderSpectrumComparison(series, { title: 'Spectral Energy' }))}</div>
        <div class="card">${resize(
          renderDirectionComparison(series, { title: 'Direction by Period (dot size is energy)' })
        )}</div>`
      : ''}
  </div>`;
}
