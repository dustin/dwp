import * as fmt from './formatters.js';

const HEADERS = {
  date: 'Date',
  linkedDate: 'Time',
  region: 'Region',
  start_beach: 'Start Beach',
  end_beach: 'End Beach',
  distance_km: 'Run Distance (km)',
  distance_on_foil: 'On Foil (km)',
  duration_sec: 'Run Duration',
  duration_on_foil: 'On Foil',
  max_speed_1k: 'Fastest km Pace',
  wind_data: 'Wind (kts)',
  paddle_up_count: 'Paddle Ups',
  foil: 'Foil'
};

export function runsTableOptions(beachColor, htl, { columns, linkHref }) {
  const header = {};
  const format = {};
  for (const c of columns) {
    header[c] = HEADERS[c] ?? c;
    switch (c) {
      case 'date':
        format[c] = fmt.date;
        break;
      case 'linkedDate':
        format[c] = d => htl.html`<a href="${linkHref(d)}">${fmt.time(d.date)}</a>`;
        break;
      case 'distance_on_foil':
        format[c] = d => (d / 1000).toFixed(2);
        break;
      case 'duration_on_foil':
        format[c] = fmt.seconds;
        break;
      case 'duration_sec':
        format[c] = fmt.seconds;
        break;
      case 'start_beach':
        format[c] = d => htl.html`<span style="color: ${beachColor(d)}">${d}</span>`;
        break;
      case 'max_speed_1k':
        format[c] = fmt.paceNoUnit;
        break;
      case 'wind_data':
        format[c] = d => `${fmt.wind(d.avg_avg, d.gust_max, d.avg_dir)}`;
        break;
    }
  }
  return { columns, header, format };
}
