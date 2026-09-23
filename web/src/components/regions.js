import * as d3 from 'npm:d3';

export function regionList(runs) {
  return [...new Set(runs.map(d => d.region))].sort();
}

export function regionColorScale(runs) {
  return d3.scaleOrdinal(d3.schemeObservable10).domain(regionList(runs));
}

export function regionColorNamed(scale, name) {
  return d => scale(d[name]);
}
