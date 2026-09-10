import * as d3 from 'npm:d3';

export function beachList(runs) {
  return [...new Set(runs.map(d => d.start_beach))].sort();
}

export function beachColorScale(runs) {
  return d3.scaleOrdinal(d3.schemeObservable10).domain(beachList(runs));
}

export function beachColorNamed(scale, name) {
  return d => scale(d[name]);
}
