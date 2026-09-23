import * as d3 from 'npm:d3';

export function foilList(runs) {
  return [...new Set(runs.map(d => d.foil))].filter(Boolean).sort();
}

export function foilColorScale(runs) {
  return d3.scaleOrdinal(d3.schemeObservable10).domain(foilList(runs));
}

export function foilColorNamed(scale, name) {
  return d => scale(d[name]);
}
