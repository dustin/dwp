import * as d3 from 'npm:d3';
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' });
const rtUnits = [['year', 31536e6], ['month', 2628e6], ['day', 864e5], ['hour', 36e5], ['minute', 6e4], ['second', 1e3]];

// "3 days ago", "in 2 hours": the largest whole unit, like luxon's toRelative().
export const relativeTime = d => {
  const ms = new Date(d) - Date.now();
  const [unit, size] = rtUnits.find(([, size]) => Math.abs(ms) >= size) ?? rtUnits.at(-1);
  return rtf.format(Math.trunc(ms / size), unit);
};

// Always the 24-hour clock. (The browser's locale isn't a usable signal:
// US English reports 12-hour whatever the person actually prefers.)
const clockSpec = '%H:%M';
const clockSecondsSpec = '%H:%M:%S';

export const date = d3.timeFormat('%Y-%m-%d');
export const time = d3.timeFormat(clockSecondsSpec);
export const timestamp = d3.timeFormat(`%Y-%m-%d ${clockSecondsSpec}`);
// To the minute: 14:30, 2026-10-02 14:30, 10/2 14:30.
export const clock = d3.timeFormat(clockSpec);
export const minuteStamp = d3.timeFormat(`%Y-%m-%d ${clockSpec}`);
export const shortStamp = d3.timeFormat(`%-m/%-d ${clockSpec}`);
export const comma = d3.format(',');

// 24-hour time-axis ticks: the time of day, or the date at midnight (where
// Plot's default would show "12 AM").
const tickDay = d3.timeFormat('%-m/%-d');
export const timeTick = d => (d3.timeDay(d) < d ? clock(d) : tickDay(d));

export function timeDiff(start, end) {
  const diffMs = end - start;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

export function seconds(totalSeconds) {
  // Round first, so 479.6 shows as 8m, not 7m 60s.
  totalSeconds = Math.round(totalSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    hours > 0 ? `${hours}h` : null,
    minutes > 0 ? `${minutes}m` : null,
    seconds > 0 ? `${seconds}s` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

export function minutes(x) {
  const m = Math.floor(x);
  const s = Math.floor(60 * (x - m));
  return m + ':' + (s < 10 ? '0' : '') + s;
}

export function mmYYYY(ts) {
  const d = new Date(ts);
  return d.toLocaleString('default', { month: 'short', year: 'numeric' });
}

export function paceNoUnit(kph) {
  return minutes(60 / kph);
}

export function pace(kph) {
  return paceNoUnit(kph) + ' min/km';
}

export function speed(kph) {
  return kph.toFixed(2) + ' kph';
}

export function hr(hr) {
  if (!hr) {
    return 'unknown bpm';
  }
  return hr.toFixed(0) + ' bpm';
}

export function distanceM(m) {
  if (m < 1000) return `${m.toFixed(0)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

export function nullPoint0(x) {
  return x ? x.toFixed(0) : '?';
}

export function wind(a, g, d) {
  if (!a || !g) {
    return 'unknown';
  }
  return a.toFixed(0) + 'g' + g.toFixed(0) + ' knots' + (d ? ' @' + d + '°' : '');
}
