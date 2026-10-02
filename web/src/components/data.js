import _ from 'npm:lodash';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';

function toWeek(ts) {
  let week = new Date(ts);
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - week.getDay());
  return week;
}

function toMonth(ts) {
  let month = new Date(ts);
  month.setHours(0, 0, 0, 0);
  month.setDate(1);
  return month;
}

export const dryLimit = 0.97;

function isDry(d) {
  return d.longest_segment_distance / d.distance_on_foil > dryLimit;
}

export async function fetchMeta(f) {
  var normalizeFoil = function (fn) {
    return fn.replace(/\s+\d+\.\d+ cm2/, '');
  };
  return f()
    .csv({ typed: true })
    .then(data =>
      data.map(d => {
        const ts = new Date(d.ts * 1000);
        return {
          ...d,
          ts: ts,
          date: ts,
          time: ts,
          longest_segment_start: new Date(d.longest_segment_start),
          longest_segment_end: new Date(d.longest_segment_end),
          foil: normalizeFoil(d.foil || 'unknown foil'),
          pct_dist_on_foil: d.distance_on_foil / (1000 * d.distance_km),
          pct_time_on_foil: d.duration_on_foil / d.duration_sec,
          linkedDate: { date: ts, id: d.id },
          month: toMonth(ts),
          week: toWeek(ts),
          dry: isDry(d),
          wind_data: {
            avg_avg: d.avg_wavg,
            avg_max: d.max_wavg,
            gust_avg: d.avg_wgust,
            gust_max: d.max_wgust,
            avg_dir: d.avg_wdir,
          },
        };
      })
    );
}

// s3.us-east-1.amazonaws.com/db.downwind.pro
const DATAHOST = 'd2qwe1xndvncw9.cloudfront.net';

export async function fetchRun(meta) {
  const runDataURL = `https://${DATAHOST}/runs/dwid%3D${meta.id}/data.csv`;
  return d3.csv(runDataURL, d3.autoType).then(data =>
    _.sortBy(
      data.map(d => ({ ...d, odometer: d.distance + 1000 * meta.odometer_km, ts: new Date(d.tsi * 1000) })),
      d => d.tsi
    )
  );
}

function inRange(meta, allRows) {
  if (allRows.length == 0) {
    return [];
  }
  const start = meta.ts;
  const end = new Date(start.getTime() + meta.duration_sec * 1000);

  let lastBefore = null;
  const inRange = [];

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    if (row.ts < start) {
      lastBefore = row;
    } else if (row.ts <= end) {
      inRange.push(row);
    } else {
      break;
    }
  }

  // Clone the first row before pinning it to the run start: rows are
  // references into allRows, so mutating in place would corrupt the
  // cached day data for other callers.
  if (lastBefore) {
    return [{ ...lastBefore, ts: meta.ts }, ...inRange];
  }
  if (inRange.length === 0) {
    return [];
  }
  const [first, ...rest] = inRange;
  return [{ ...first, ts: meta.ts }, ...rest];
}

export async function fetchWind(meta) {
  let site = undefined;
  if (meta.region == 'Kihei') {
    site = 'kihei';
  } else if (meta.region == 'Maui North Shore') {
    site = 'hookipa';
  } else {
    return [];
  }
  const day = fmt.date(meta.ts);

  const runDataURL = `https://${DATAHOST}/wind/site%3D${site}/day%3D${day}/data.csv`;
  return d3
    .csv(runDataURL, row => ({
      ...row,
      ts: new Date(row.ts),
      wavg: +row.wavg,
      wdir: +row.wdir,
      wgust: +row.wgust,
      wlull: +row.wlull,
    }))
    .catch(err => [])
    .then(allRows => inRange(meta, allRows));
}

export function toRelative(series, tsKey = 'ts', outKey = 't') {
  if (!Array.isArray(series) || series.length === 0) return [];
  const toScalar = v => (v instanceof Date ? v.getTime() : +v);
  const t0 = toScalar(series[0][tsKey]);
  return series.map(d => ({ ...d, [outKey]: toScalar(d[tsKey]) - t0 }));
}

function parseSwellPartitionRow(row) {
  return {
    ...row,
    ts: new Date(row.ts),
    rank: +row.rank,
    period: +row.period,
    direction: +row.direction,
    spread: +row.spread,
    height: +row.height * 3.2808399,
    energy: +row.energy,
    surflineKJ: +row.surfline_kj
  };
}

function groupSwellPartitionRows(rows) {
  // Group by timestamp. Use getTime() so equal times collapse together.
  const grouped = d3.group(rows, d => d.ts.getTime());

  return Array.from(grouped, ([ts, groupRows]) => ({
    ts: new Date(Number(ts)),
    values: groupRows
      .slice()                 // don't mutate the original rows
      .sort((a, b) => d3.ascending(a.rank, b.rank))
  })).sort((a, b) => d3.ascending(a.ts, b.ts));
}

export async function fetchSwell(meta) {
  let site = undefined;
  if (meta.region == 'Maui North Shore') {
    site = 'pauwela';
  } else {
    return [];
  }
  const day = fmt.date(meta.ts);

  const runDataURL = `https://${DATAHOST}/swell_partition/site%3D${site}/day%3D${day}/data.csv`;
  return d3
    .csv(runDataURL, parseSwellPartitionRow)
    .catch(err => [])
    .then(groupSwellPartitionRows)
    .then(allRows => inRange(meta, allRows))
}

// Every calendar day (formatted the same way fmt.date partitions the
// uploaded data) that [start, end] touches, inclusive.
function enumerateDays(start, end) {
  const days = [];
  let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (d <= last) {
    days.push(fmt.date(d));
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return days;
}

async function fetchCsvForDay(table, site, day, rowMapper) {
  const url = `https://${DATAHOST}/${table}/site%3D${site}/day%3D${day}/data.csv`;
  return d3.csv(url, rowMapper).catch(err => []);
}

function parseSwellSpectrumRow(row) {
  return {
    ...row,
    ts: new Date(row.ts),
    freq: +row.freq,
    energy: +row.energy,
    direction: +row.direction,
    r1: +row.r1
  };
}

// Flat per-(ts, freq) rows -- not grouped, since a spectrogram/histogram
// wants every bin as its own mark rather than one array per reading.
export async function fetchSwellSpectrumWindow(site, start, end) {
  if (!site) return [];
  const days = enumerateDays(start, end);
  const rows = (
    await Promise.all(days.map(day => fetchCsvForDay('swell_spectrum', site, day, parseSwellSpectrumRow)))
  ).flat();
  return rows
    .filter(d => d.ts >= start && d.ts <= end)
    .sort((a, b) => d3.ascending(a.ts, b.ts) || d3.ascending(a.freq, b.freq));
}

export async function fetchSwellPartitionWindow(site, start, end) {
  if (!site) return [];
  const days = enumerateDays(start, end);
  const rows = (
    await Promise.all(days.map(day => fetchCsvForDay('swell_partition', site, day, parseSwellPartitionRow)))
  ).flat();
  return groupSwellPartitionRows(rows.filter(d => d.ts >= start && d.ts <= end));
}

// Windowed around a run: from `lookbackHours` before the run started through
// the end of the run, so a spectrogram/partition chart can show the
// conditions building into the run, not just the run's own duration.
export async function fetchSwellSpectrum(meta, lookbackHours = 6) {
  if (meta.region != 'Maui North Shore') return [];
  const start = new Date(meta.ts.getTime() - lookbackHours * 3600 * 1000);
  const end = new Date(meta.ts.getTime() + meta.duration_sec * 1000);
  return fetchSwellSpectrumWindow('pauwela', start, end);
}

// Rolling window ending now, for standalone (non-run) buoy analysis.
export async function fetchRecentSwellSpectrum(hours = 24, site = 'pauwela') {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  return fetchSwellSpectrumWindow(site, start, end);
}

export async function fetchRecentSwellPartition(hours = 24, site = 'pauwela') {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  return fetchSwellPartitionWindow(site, start, end);
}
