// A date and time picker in 24-hour time: a native calendar for the date
// plus a text field for the time. (A native datetime-local input picks its
// clock from the OS locale and can't be told otherwise.) The field shows
// 14:30 but also takes 1430 or 2:30 pm. Times are the browser's local time,
// like the rest of the pages.

import { html } from 'npm:htl';
import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';

const dateValue = d3.timeFormat('%Y-%m-%d');

// "14:30", "1430", "7:05", "2:30 pm", "2pm" -> [hours, minutes] in 24-hour
// time; anything else -> null.
function parseTime(s) {
  const m = String(s).trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*([ap])?\.?m?\.?$/);
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === 'p' ? 12 : 0);
  } else if (m[2] == null) {
    return null; // a bare number is ambiguous without am/pm
  }
  return h > 23 || min > 59 ? null : [h, min];
}

// timePicker({label, value, min, max, onChange}): onChange(Date) fires once
// both a date and a valid time are set. Picking a date with no time yet
// fills in 12:00.
export function timePicker({ label, value, min, max, onChange }) {
  const date = html`<input type="date" min=${min ? dateValue(min) : null} max=${max ? dateValue(max) : null}>`;
  const time = html`<input type="text" placeholder="HH:MM" maxlength="8"
    title="24-hour time, e.g. 14:30" style="width: 4.5em;">`;
  if (value) {
    date.value = dateValue(value);
    time.value = fmt.clock(value);
  }
  const apply = () => {
    if (!date.value) return;
    if (!time.value.trim()) time.value = '12:00';
    const t = parseTime(time.value);
    time.setCustomValidity(t ? '' : 'Use a time like 14:30 or 2:30 pm');
    time.reportValidity();
    if (!t) return;
    const [y, mo, d] = date.value.split('-').map(Number);
    const ts = new Date(y, mo - 1, d, t[0], t[1]);
    time.value = fmt.clock(ts);
    onChange(ts);
  };
  date.addEventListener('change', apply);
  // On change (Enter or leaving the field), not while typing.
  time.addEventListener('change', apply);
  return html`<span style="display: inline-flex; align-items: center; gap: 0.4em;">
    <label style="width: 120px; font-size: 0.9em;">${label}</label>${date}${time}
  </span>`;
}
