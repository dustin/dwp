import * as fmt from './formatters.js';
import * as d3 from 'npm:d3';

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

// Phones get a list of tappable cards instead of the wide table; desktop
// keeps the table exactly as it was. Both are rendered and CSS picks one at
// the breakpoint, so rotating a phone or resizing a window just works.

const PAGE_SIZE = 25;
const dayStamp = d3.timeFormat('%a %Y-%m-%d');

const STYLE = `
.runs-narrow { display: none; }
@media (max-width: 640px) {
  .runs-responsive > .runs-wide { display: none; }
  .runs-responsive > .runs-narrow { display: block; }
}
.runs-narrow input.runs-search {
  width: 100%;
  max-width: none;
  box-sizing: border-box;
  font: inherit;
  font-size: 16px;
  padding: 0.5rem 0.6rem;
  margin-bottom: 0.5rem;
  border: solid 1px var(--theme-foreground-faint);
  border-radius: 6px;
  background: var(--theme-background);
  color: var(--theme-foreground);
}
.runs-count { font-size: 0.8rem; color: var(--theme-foreground-muted); margin-bottom: 0.3rem; }
.runs-cards { display: flex; flex-direction: column; }
.runs-narrow a.run-card {
  display: block;
  padding: 0.6rem 0.2rem;
  border-top: solid 1px var(--theme-foreground-faintest);
  color: var(--theme-foreground);
  text-decoration: none;
}
.runs-narrow a.run-card:first-child { border-top: none; }
.runs-narrow a.run-card:active { background: var(--theme-foreground-faintest); }
.run-card-top { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; }
.run-card-when { font-weight: 600; color: var(--theme-foreground-focus); white-space: nowrap; }
.run-card-dist { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.run-card-route { margin-top: 0.1rem; }
.run-card-stats {
  margin-top: 0.15rem;
  font-size: 0.8rem;
  color: var(--theme-foreground-muted);
  font-variant-numeric: tabular-nums;
}
.run-card-stat { white-space: nowrap; }
.runs-more {
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.6rem;
  font: inherit;
  border: solid 1px var(--theme-foreground-faint);
  border-radius: 6px;
  background: var(--theme-background-alt);
  color: var(--theme-foreground);
}
`;

// Stats shown on the card's third line, in order, when the column is asked
// for. Distance and the route have their own spots on the card.
const CARD_STATS = {
  distance_on_foil: d => `${(d.distance_on_foil / 1000).toFixed(2)} km on foil`,
  duration_sec: d => fmt.seconds(d.duration_sec),
  duration_on_foil: d => `${fmt.seconds(d.duration_on_foil)} on foil`,
  max_speed_1k: d => `${fmt.paceNoUnit(d.max_speed_1k)}/km`,
  wind_data: d => (d.wind_data?.avg_avg && d.wind_data?.gust_max ? fmt.wind(d.wind_data.avg_avg, d.wind_data.gust_max, d.wind_data.avg_dir) : null),
  paddle_up_count: d => (d.paddle_up_count == null ? null : `${d.paddle_up_count} paddle up${d.paddle_up_count == 1 ? '' : 's'}`),
  region: d => d.region,
  foil: d => d.foil
};

function searchText(d) {
  return [fmt.date(d.date), dayStamp(d.date), d.region, d.start_beach, d.end_beach, d.foil].join(' ').toLowerCase();
}

function runCard(d, beachColor, htl, { columns, linkHref }) {
  const stats = columns
    .filter(c => CARD_STATS[c])
    .map(c => CARD_STATS[c](d))
    .filter(s => s != null && s !== '');
  const route = d.start_beach === d.end_beach ? [d.start_beach] : [d.start_beach, d.end_beach];
  return htl.html`<a class="run-card" href=${linkHref(d)}>
    <div class="run-card-top">
      <span class="run-card-when">${dayStamp(d.date)} ${fmt.clock(d.date)}</span>
      <span class="run-card-dist">${d.distance_km.toFixed(2)} km</span>
    </div>
    <div class="run-card-route"><span style=${`color: ${beachColor(d.start_beach)}`}>${route[0]}</span>${
      route[1] ? htl.html` → ${route[1]}` : ''}</div>
    ${stats.length ? htl.html`<div class="run-card-stats">${stats.map((s, i) =>
      htl.html`${i ? ' · ' : ''}<span class="run-card-stat">${s}</span>`)}</div>` : ''}
  </a>`;
}

export function runsList(rows, beachColor, htl, opts) {
  const search = htl.html`<input class="runs-search" type="search" placeholder="Search beach, foil, or date">`;
  const count = htl.html`<div class="runs-count"></div>`;
  const cards = htl.html`<div class="runs-cards"></div>`;
  const more = htl.html`<button class="runs-more" type="button">Show more</button>`;
  const indexed = rows.map(d => ({ d, text: searchText(d) }));
  let matches = rows;
  let shown = 0;

  function showMore() {
    const next = matches.slice(shown, shown + PAGE_SIZE);
    cards.append(...next.map(d => runCard(d, beachColor, htl, opts)));
    shown += next.length;
    more.style.display = shown < matches.length ? '' : 'none';
    more.textContent = `Show more (${matches.length - shown} left)`;
  }

  function update() {
    const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    matches = indexed.filter(({ text }) => terms.every(t => text.includes(t))).map(({ d }) => d);
    count.textContent = terms.length ? `${matches.length} of ${rows.length} runs` : `${rows.length} runs`;
    cards.replaceChildren();
    shown = 0;
    showMore();
  }

  search.addEventListener('input', update);
  more.addEventListener('click', showMore);
  update();
  return htl.html`<div>${search}${count}${cards}${more}</div>`;
}

// The usual runs table on wide screens, the card list on phones.
export function responsiveRunsTable(Inputs, htl, beachColor, rows, opts) {
  const table = Inputs.table(rows, runsTableOptions(beachColor, htl, opts));
  const style = document.createElement('style');
  style.textContent = STYLE;
  return htl.html`<div class="runs-responsive">
    ${style}
    <div class="runs-wide">${table}</div>
    <div class="runs-narrow">${runsList(rows, beachColor, htl, opts)}</div>
  </div>`;
}
