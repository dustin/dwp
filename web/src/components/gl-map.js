// The Mapbox GL pieces shared by the full-screen track viewer
// (track-viewer.js) and the run/compare/runs map (renderRun in map.js):
// the base style, the track drawn as speed-colored lines, start/end dots,
// and finding the track point nearest a tap or the mouse.

import * as d3 from 'npm:d3';
import mapboxgl from 'npm:mapbox-gl';
import { MAPBOX_TOKEN } from '../token.js';

export { mapboxgl };

// Mapbox imagery when the build has a token (CI writes src/token.js);
// plain OpenStreetMap raster tiles otherwise, so local builds still work.
export function mapStyle(mapboxStyle = 'satellite-streets-v12') {
  if (MAPBOX_TOKEN) return `mapbox://styles/mapbox/${mapboxStyle}`;
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}

export function setAccessToken() {
  mapboxgl.accessToken = MAPBOX_TOKEN || 'no-token';
}

export const pointFeature = (d, properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
});

// A track as lines colored by `color(speed)`. Consecutive points of the
// same color share one line: thousands of two-point lines would be slow,
// and Mapbox drops lines shorter than its simplification tolerance when
// zoomed out, which leaves most of the track missing.
export function trackFeatures(points, color, properties = {}) {
  const features = [];
  let current = null;
  d3.pairs(points).forEach(([a, b]) => {
    const c = color(b.speed);
    if (current?.properties.color !== c) {
      current = {
        type: 'Feature',
        properties: { ...properties, color: c },
        geometry: { type: 'LineString', coordinates: [[a.lon, a.lat]] },
      };
      features.push(current);
    }
    current.geometry.coordinates.push([b.lon, b.lat]);
  });
  return features;
}

export const START_COLOR = '#22c55e';
export const END_COLOR = '#ef4444';

export function endFeatures(points) {
  if (!points.length) return [];
  return [
    pointFeature(points[0], { color: START_COLOR }),
    pointFeature(points[points.length - 1], { color: END_COLOR }),
  ];
}

// Adds the track (a FeatureCollection from trackFeatures, whose features
// may carry `dashed: true`), its casing and the start/end dots.
// `tolerance` is Mapbox's line simplification; lower it when colors change
// every few points (as with Compare's continuous colorizers), or the short
// lines between changes get simplified away and the track looks dashed.
export function addTrackLayers(map, tracks, ends, { tolerance = 0.2 } = {}) {
  map.addSource('track', { type: 'geojson', data: tracks, tolerance });
  const layout = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({
    id: 'track-casing',
    type: 'line',
    source: 'track',
    layout,
    paint: { 'line-color': '#000', 'line-opacity': 0.35, 'line-width': 7 },
  });
  map.addLayer({
    id: 'track',
    type: 'line',
    source: 'track',
    filter: ['!', ['boolean', ['get', 'dashed'], false]],
    layout,
    paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
  });
  // Mapbox can't switch dash patterns per feature, so dashed lines
  // (approximate routes) get their own layer.
  map.addLayer({
    id: 'track-dashed',
    type: 'line',
    source: 'track',
    filter: ['boolean', ['get', 'dashed'], false],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [1, 1.5] },
  });
  map.addSource('ends', { type: 'geojson', data: { type: 'FeatureCollection', features: ends } });
  map.addLayer({
    id: 'ends',
    type: 'circle',
    source: 'ends',
    paint: {
      'circle-radius': 6,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  });
}

// Runs `f` once the style is ready. 'load' would wait for every imagery
// tile (and never comes if one fails), so watch for the style instead.
export function whenStyleReady(map, f) {
  if (map.isStyleLoaded()) f();
  else map.once('style.load', f);
}

// Bounds covering every point, for Map's `bounds` option.
export function pointBounds(points) {
  const [lon0, lon1] = d3.extent(points, d => d.lon);
  const [lat0, lat1] = d3.extent(points, d => d.lat);
  return [
    [lon0, lat0],
    [lon1, lat1],
  ];
}

// Web Mercator in [0, 1] world units, so screen positions for every point
// can be recomputed with two multiply-adds per point (see nearestPoint).
const mercX = lon => lon / 360 + 0.5;
const mercY = lat => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

// The map's current view as a d3-zoom style transform ({k, x, y}) for
// 512px Web Mercator tiles: d3.geoMercator().scale(k / 2π).translate([x, y])
// lines up with the map. Only meaningful while the map is not rotated or
// pitched.
export function mapTransform(map) {
  const { lng, lat } = map.getCenter();
  const k = 512 * Math.pow(2, map.getZoom());
  const canvas = map.getContainer();
  return {
    k,
    x: canvas.clientWidth / 2 - k * (mercX(lng) - 0.5),
    y: canvas.clientHeight / 2 - k * (mercY(lat) - 0.5),
  };
}

// An index over one or more point lists for finding the point nearest a
// screen position. `pick(transform, x, y, radius)` returns
// {dataset, index, point} or null when nothing is within `radius` pixels.
export function pointIndex(datas) {
  const xs = [];
  const ys = [];
  const refs = [];
  datas.forEach((points, dataset) =>
    points.forEach((d, index) => {
      xs.push(mercX(d.lon) - 0.5);
      ys.push(mercY(d.lat) - 0.5);
      refs.push([dataset, index]);
    })
  );
  return {
    pick({ k, x, y }, px, py, radius) {
      let best = -1;
      let bestDist = radius * radius;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] * k + x - px;
        const dy = ys[i] * k + y - py;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      if (best < 0) return null;
      const [dataset, index] = refs[best];
      return { dataset, index, point: datas[dataset][index] };
    },
  };
}
