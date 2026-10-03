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

// The buoy uploads are partitioned by Hawaii calendar day (see
// db/export-conditions.sql), so enumerate days in HST regardless of the
// viewer's own time zone. Hawaii has no DST, so a fixed offset is exact.
const HST_OFFSET_MS = 10 * 3600 * 1000;

function hstDay(ts) {
  return new Date(ts.getTime() - HST_OFFSET_MS).toISOString().slice(0, 10);
}

// Every HST calendar day [start, end] touches, inclusive.
function enumerateDays(start, end) {
  const days = [];
  const dayMs = 24 * 3600 * 1000;
  for (let t = start.getTime(); hstDay(new Date(t)) <= hstDay(end); t += dayMs) {
    days.push(hstDay(new Date(t)));
  }
  return days;
}

// Memoized per URL: comparison views ask for the same days repeatedly (many
// runs share a day, and every run snapshot spans a day boundary or two).
// Callers must not mutate the returned rows.
const dayCsvCache = new Map();

async function fetchCsvForDay(table, site, day, rowMapper) {
  const url = `https://${DATAHOST}/${table}/site%3D${site}/day%3D${day}/data.csv`;
  if (!dayCsvCache.has(url)) {
    dayCsvCache.set(url, d3.csv(url, rowMapper).catch(err => []));
  }
  return dayCsvCache.get(url);
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

// Spectral + partition capture at Pauwela only goes back this far; runs
// before it have no buoy data to compare.
export const BUOY_DATA_START = new Date('2026-07-22T00:00:00-10:00');

export function buoySite(meta) {
  return meta?.region == 'Maui North Shore' ? 'pauwela' : null;
}

// Timestamps in page URLs (the buoy page's ?t= and ?c=) are written as
// Hawaii local time to the minute, e.g. 2026-10-02T18:56 -- readable, and
// the same moment for anyone opening the link.
export function toHstParam(ts) {
  return new Date(ts.getTime() - HST_OFFSET_MS).toISOString().slice(0, 16);
}

export function parseHstParam(s) {
  if (!s || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(s)) return null;
  const ts = new Date(`${s}:00-10:00`);
  return isNaN(ts) ? null : ts;
}

export function hasBuoyData(meta) {
  return buoySite(meta) != null && meta.ts >= BUOY_DATA_START;
}

export function runMidpoint(meta) {
  return new Date(meta.ts.getTime() + (meta.duration_sec * 1000) / 2);
}

// Buoy conditions closest to a single moment: the nearest spectral reading
// (flat per-bin rows) and the nearest swell_partition reading (whose rank 1
// row is NDBC's overall sea state). Readings are hourly-ish, so look a few
// hours either side to tolerate gaps. Returns null if there's nothing.
export async function fetchBuoySnapshot(ts, site = 'pauwela', { windowHours = 3 } = {}) {
  const start = new Date(ts.getTime() - windowHours * 3600 * 1000);
  const end = new Date(ts.getTime() + windowHours * 3600 * 1000);
  const [spectrum, partitions] = await Promise.all([
    fetchSwellSpectrumWindow(site, start, end),
    fetchSwellPartitionWindow(site, start, end),
  ]);
  if (spectrum.length === 0 && partitions.length === 0) return null;
  const nearestSpectrumTs = d3.least(Array.from(new Set(spectrum.map(d => +d.ts))), t => Math.abs(t - ts));
  const reading = d3.least(partitions.filter(d => d.values.some(v => v.rank === 1)), d => Math.abs(d.ts - ts));
  return {
    ts,
    spectrumTs: nearestSpectrumTs == null ? null : new Date(nearestSpectrumTs),
    spectrum: spectrum.filter(d => +d.ts === nearestSpectrumTs),
    primary: reading?.values.find(v => v.rank === 1) ?? null,
    primaryTs: reading?.ts ?? null,
  };
}
