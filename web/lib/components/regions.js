import * as d3 from 'npm:d3';

// Every region keeps one color whoever's runs are shown and whichever
// regions they have, so adding one (e.g. Elsewhere, runs away from any
// known beach) doesn't shift the rest. Names as in db/beaches.kml.
const PALETTE = d3.schemeObservable10;
const FIXED = new Map([
  ['Kihei', PALETTE[0]],
  ['Maui North Shore', PALETTE[1]],
  ['Molokai', PALETTE[2]],
  ['Oahu', PALETTE[3]],
  ['West Maui', PALETTE[4]],
  ['Elsewhere', PALETTE[9]], // gray
]);
// A region not listed above gets one of the colors nobody has, picked by
// its name so it's the same everywhere.
const SPARE = PALETTE.filter(c => ![...FIXED.values()].includes(c));
function hashColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}
export const regionColorOf = name => FIXED.get(name) ?? hashColor(name);

// Alphabetical, with Elsewhere last.
export function regionList(runs) {
  return [...new Set(runs.map(d => d.region))]
    .sort((a, b) => (a === 'Elsewhere') - (b === 'Elsewhere') || d3.ascending(a, b));
}

// Kept as a scale for the pages that call it like one (and pass it on).
export function regionColorScale(runs) {
  const domain = regionList(runs);
  return d3.scaleOrdinal(domain, domain.map(regionColorOf));
}

export function regionColorNamed(scale, name) {
  return d => scale(d[name]);
}
