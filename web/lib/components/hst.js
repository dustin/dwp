// Hawaii time, whatever the viewer's own time zone. Runs, tides and
// conditions are all Hawaii-local: a 19:00 run is that day's run, even for
// someone looking from the mainland or Europe, where it's already the next
// day. Hawaii has no DST, so a fixed offset is exact.
//
// Drop-in for d3's local-time helpers: hst.timeFormat for d3.timeFormat,
// hst.timeDay / timeWeek / timeMonth / timeYear / timeHour for d3's
// intervals (floor, offset, count, range, every; usable as Plot ticks), and
// hst.year / month / dayOfMonth / weekday for Date's local getters.
import * as d3 from 'npm:d3';

export const TZ = 'Pacific/Honolulu';
export const OFFSET_MS = 10 * 3600e3;

// The instant whose UTC fields read as Hawaii's wall clock at t.
const wall = t => new Date(+t - OFFSET_MS);

export const timeFormat = spec => {
  const f = d3.utcFormat(spec);
  return t => f(wall(t));
};

// A UTC interval moved to Hawaii's wall clock. field is what .every()
// counts in (as d3's own intervals do).
function shifted(utc, field) {
  return d3.timeInterval(
    d => d.setTime(+utc.floor(wall(d)) + OFFSET_MS),
    (d, step) => d.setTime(+utc.offset(wall(d), step) + OFFSET_MS),
    (start, end) => utc.count(wall(start), wall(end)),
    field && (d => field(wall(d)))
  );
}

export const timeHour = shifted(d3.utcHour, d => d.getUTCHours());
export const timeDay = shifted(d3.utcDay, d => d.getUTCDate() - 1);
export const timeWeek = shifted(d3.utcSunday);
export const timeMonth = shifted(d3.utcMonth, d => d.getUTCMonth());
export const timeYear = shifted(d3.utcYear, d => d.getUTCFullYear());
export const timeDays = timeDay.range;
export const timeMonths = timeMonth.range;

export const year = t => wall(t).getUTCFullYear();
export const month = t => wall(t).getUTCMonth();
export const dayOfMonth = t => wall(t).getUTCDate();
export const weekday = t => wall(t).getUTCDay();

// The Hawaii calendar day of t, as YYYY-MM-DD.
export const day = timeFormat('%Y-%m-%d');

// Hawaii midnight starting the YYYY-MM-DD day (or a Date at UTC midnight
// of that day, as Inputs.date gives).
export const midnight = d => new Date(+(typeof d === 'string' ? new Date(`${d}T00:00:00Z`) : d3.utcDay(d)) + OFFSET_MS);
