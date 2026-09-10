import _ from 'npm:lodash';

// NDBC station 51205 / Pauwela, Maui -- see db/swell/update.sql.
export const PAUWELA_BUOY = { lat: 21.018, lon: -156.421 };

// rank 1 is NDBC's own primary reading (the whole sea state); ranks 2+ are
// the individual spectral components that make it up. The total kJ figure
// only makes sense at the reading level (Surfline doesn't show it per
// component either), so it belongs on the primary line, not repeated on
// every component.
export function summarizeSwellPartition(values) {
  return {
    primary: values.find(d => d.rank === 1),
    components: values.filter(d => d.rank !== 1)
  };
}

export function formatPrimaryLine(d) {
  return `${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s ${Math.round(d.direction)}° · ${d.surflineKJ.toFixed(0)} kJ`;
}

export function formatComponentLine(d) {
  return `${d.height.toFixed(1)}' @ ${d.period.toFixed(1)}s ${Math.round(d.direction)}° (${d.energy.toFixed(2)} kJ/m²)`;
}

export function formatIndividualSwells(partitionByTimestamp, ts) {
  const values = partitionByTimestamp.get(ts.getTime());
  if (!values) return '';

  const { primary, components } = summarizeSwellPartition(values);
  return [primary && formatPrimaryLine(primary), ...components.map(d => `  ${formatComponentLine(d)}`)]
    .filter(Boolean)
    .join('\n');
}

// Swell drifts slowly enough over a run's timespan (usually well under a
// day) that one representative reading -- the one closest to the run's
// midpoint -- stands in fine for "what it was like out there", rather than
// trying to average distinct wave systems across readings where a system's
// rank can shift from one hour to the next.
export function representativeSwellReading(swell2, meta) {
  if (!swell2 || swell2.length === 0) return null;
  const mid = new Date(meta.ts.getTime() + (meta.duration_sec * 1000) / 2);
  return _.minBy(swell2, d => Math.abs(d.ts.getTime() - mid.getTime()));
}
