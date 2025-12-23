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
          foil: normalizeFoil(d.equip_2 || 'unknown foil'),
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

export async function fetchRun(runId) {
  const runDataURL = `https://${DATAHOST}/runs/dwid%3D${runId}/data.csv`;
  return d3.csv(runDataURL, d3.autoType).then(data =>
    _.sortBy(
      data.map(d => ({ ...d, ts: new Date(d.tsi * 1000) })),
      d => d.tsi
    )
  );
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
    .then(allRows => {
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

      const rv = lastBefore ? [lastBefore, ...inRange] : inRange;
      rv[0].ts = meta.ts;
      return rv;
    });
}

export function toRelative(series, tsKey = 'ts', outKey = 't') {
  if (!Array.isArray(series) || series.length === 0) return [];
  const toScalar = v => (v instanceof Date ? v.getTime() : +v);
  const t0 = toScalar(series[0][tsKey]);
  return series.map(d => ({ ...d, [outKey]: toScalar(d[tsKey]) - t0 }));
}
