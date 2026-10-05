// A phone-first track viewer (track.md): the run fills the screen as a
// Mapbox GL map, with a slim title bar on top and a speed/heart-rate strip
// along the bottom. Dragging along the strip (or tapping the track) moves a
// marker along the run and shows time, speed, HR and distance at that point
// -- the touch replacement for the desktop map's hover tooltips.
//
// Mapbox GL handles pinch zoom, rotation and panning natively, and draws
// the track as one line layer instead of thousands of SVG dots.

import * as d3 from 'npm:d3';
import { html, svg } from 'npm:htl';
import mapboxgl from 'npm:mapbox-gl';
import * as fmt from './formatters.js';
import { speedColor, APPROXIMATE_COLOR } from './map.js';
import { FOIL_THRESHOLD_KPH } from './color.js';
import { MAPBOX_TOKEN } from '../token.js';

// Mapbox satellite when the build has a token (CI writes src/token.js);
// plain OpenStreetMap raster tiles otherwise, so local builds still work.
function mapStyle() {
  if (MAPBOX_TOKEN) return 'mapbox://styles/mapbox/satellite-streets-v12';
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

// The track as lines colored the way the desktop map colors its dots
// (speedColor), so the two read the same. Consecutive points of the same
// color share one line: thousands of two-point lines would be slow, and
// Mapbox drops lines shorter than its simplification tolerance when zoomed
// out, which leaves most of the track missing.
function trackLines(points, approximate) {
  const color = approximate ? () => APPROXIMATE_COLOR : speedColor(points.map(d => d.speed));
  const features = [];
  let current = null;
  d3.pairs(points).forEach(([a, b]) => {
    const c = color(b.speed);
    if (current?.properties.color !== c) {
      current = {
        type: 'Feature',
        properties: { color: c },
        geometry: { type: 'LineString', coordinates: [[a.lon, a.lat]] },
      };
      features.push(current);
    }
    current.geometry.coordinates.push([b.lon, b.lat]);
  });
  return { type: 'FeatureCollection', features };
}

const pointFeature = d => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
});

// The speed/HR strip: speed as an area (dark green on foil, dark red off),
// heart rate as a red line on its own scale, and a cursor for the selected
// point. Returns the element plus a function to move the cursor.
function strip(points, { onSelect }) {
  const height = 64;
  const el = html`<div class="track-strip"></div>`;
  let cursorAt = 0;
  let draw = () => {};

  const ro = new ResizeObserver(() => draw());
  ro.observe(el);

  draw = () => {
    const width = el.clientWidth;
    if (!width) return;
    const x = d3.scaleTime(d3.extent(points, d => d.ts), [0, width]);
    const ySpeed = d3.scaleLinear([0, d3.max(points, d => d.speed) || 1], [height - 2, 4]);
    const hrs = points.filter(d => d.hr);
    const yHr = d3.scaleLinear(d3.extent(hrs, d => d.hr), [height - 6, 6]);
    const area = (on) =>
      d3
        .area()
        .defined(d => d.speed != null && (d.speed > FOIL_THRESHOLD_KPH) === on)
        .x(d => x(d.ts))
        .y0(height)
        .y1(d => ySpeed(d.speed))(points);
    const hrLine = d3
      .line()
      .defined(d => d.hr)
      .x(d => x(d.ts))
      .y(d => yHr(d.hr))(points);
    const p = points[cursorAt];
    el.replaceChildren(html`<svg width=${width} height=${height}>
      <path d=${area(true)} fill="#2e7d32" fill-opacity="0.8"></path>
      <path d=${area(false)} fill="#a33" fill-opacity="0.7"></path>
      ${hrs.length ? svg`<path d=${hrLine} fill="none" stroke="#ff6b6b" stroke-width="1.5"></path>` : ''}
      <line x1=${x(p.ts)} x2=${x(p.ts)} y1="0" y2=${height} stroke="white" stroke-width="2"></line>
    </svg>`);
    el._x = x;
  };

  // Pointer events cover mouse, pen and touch; touch-action: none (CSS)
  // keeps a horizontal drag from scrolling or zooming the page.
  const pick = event => {
    const x = el._x;
    if (!x) return;
    const rect = el.getBoundingClientRect();
    const t = x.invert(event.clientX - rect.left);
    const i = Math.min(points.length - 1, d3.bisector(d => d.ts).center(points, t));
    onSelect(i);
  };
  el.addEventListener('pointerdown', event => {
    el.setPointerCapture(event.pointerId);
    pick(event);
  });
  el.addEventListener('pointermove', event => {
    if (el.hasPointerCapture(event.pointerId)) pick(event);
  });

  return {
    el,
    moveTo(i) {
      cursorAt = i;
      draw();
    },
    destroy: () => ro.disconnect(),
  };
}

// `meta` is a runs.csv row (fetchMeta), `points` its track (fetchRun).
// `invalidation` is Framework's promise for cleaning up when the cell
// re-runs.
export function trackViewer(meta, points, { invalidation, backHref } = {}) {
  const approximate = points[0]?.approximate ?? false;
  const end = new Date(meta.ts.getTime() + meta.duration_sec * 1000);
  const mapEl = html`<div class="track-map"></div>`;
  const readout = html`<div class="track-readout"></div>`;
  const chart = approximate || points.length < 2 ? null : strip(points, { onSelect: i => select(i) });

  const root = html`<div class="track-app">
    ${mapEl}
    <header class="track-bar">
      <a class="track-back" href=${backHref} aria-label="Back to the run">‹</a>
      <div class="track-title">
        <div class="track-route">${meta.start_beach} → ${meta.end_beach}</div>
        <div class="track-sub">${fmt.shortStamp(meta.ts)}–${fmt.clock(end)} · ${meta.distance_km.toFixed(1)} km · ${fmt.seconds(meta.duration_sec)}${
          meta.avg_wavg ? ` · ${fmt.wind(meta.avg_wavg, meta.avg_wgust, meta.avg_wdir)}` : ''
        }</div>
      </div>
    </header>
    <footer class="track-panel">
      ${readout}
      ${chart ? chart.el : html`<div class="track-note">No GPS track for this run: the gray line is an approximate route between the beaches.</div>`}
    </footer>
  </div>`;

  let map = null;
  let selected = 0;
  function select(i) {
    selected = i;
    const d = points[i];
    if (!d) return;
    map?.getSource('cursor')?.setData(pointFeature(d));
    chart?.moveTo(i);
    readout.replaceChildren(
      ...(approximate
        ? [html`<span>${fmt.clock(meta.ts)}–${fmt.clock(end)}</span>`, html`<span>${meta.paddle_up_count ?? 0} paddle ups</span>`]
        : [
            html`<span><b>${fmt.clock(d.ts)}</b></span>`,
            html`<span><b>${d.speed == null ? '–' : d.speed.toFixed(1)}</b> km/h</span>`,
            html`<span><b>${d.hr ?? '–'}</b> bpm</span>`,
            html`<span><b>${(d.distance / 1000).toFixed(2)}</b> km</span>`,
          ])
    );
  }

  // Mapbox sizes its canvas from the container when it's created, so wait
  // until Framework has put the viewer on the page, and follow the
  // container's size after that (rotation, browser chrome showing/hiding).
  function init() {
    mapboxgl.accessToken = MAPBOX_TOKEN || 'no-token';
    map = new mapboxgl.Map({
      container: mapEl,
      style: mapStyle(),
      bounds: d3.extent(points, d => d.lon).map((lon, i) => [lon, d3.extent(points, d => d.lat)[i]]),
      fitBoundsOptions: { padding: { top: 80, bottom: 150, left: 30, right: 30 } },
      attributionControl: false,
      pitchWithRotate: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new mapboxgl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-right');
    map.addControl(
      new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }),
      'top-right'
    );
    invalidation?.then(() => {
      map.remove();
      chart?.destroy();
    });

    // Draw the track as soon as the style is ready rather than on 'load',
    // which waits for every imagery tile (and never comes if one fails).
    const addTrack = () => {
      map.addSource('track', { type: 'geojson', data: trackLines(points, approximate), tolerance: 0.2 });
      map.addLayer({
        id: 'track-casing',
        type: 'line',
        source: 'track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#000', 'line-opacity': 0.35, 'line-width': 7 },
      });
      map.addLayer({
        id: 'track',
        type: 'line',
        source: 'track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          ...(approximate ? { 'line-dasharray': [1, 1.5] } : {}),
        },
      });
      map.addSource('ends', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [
            { ...pointFeature(points[0]), properties: { color: '#22c55e' } },
            { ...pointFeature(points[points.length - 1]), properties: { color: '#ef4444' } },
          ],
        },
      });
      map.addLayer({
        id: 'ends',
        type: 'circle',
        source: 'ends',
        paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });
      map.addSource('cursor', { type: 'geojson', data: pointFeature(points[selected]) });
      map.addLayer({
        id: 'cursor',
        type: 'circle',
        source: 'cursor',
        paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-color': '#111', 'circle-stroke-width': 3 },
      });
      select(selected);
      root.dataset.ready = 'true';
    };
    if (map.isStyleLoaded()) addTrack();
    else map.once('style.load', addTrack);

    // Tap (or click) near the track to pick the closest point, within a
    // finger's width.
    if (!approximate) {
      map.on('click', event => {
        const { x, y } = event.point;
        let best = -1;
        let bestDist = 30 * 30;
        points.forEach((d, i) => {
          const p = map.project([d.lon, d.lat]);
          const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        });
        if (best >= 0) select(best);
      });
    }

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapEl);
    invalidation?.then(() => ro.disconnect());
  }
  (function whenAttached() {
    if (root.isConnected) init();
    else requestAnimationFrame(whenAttached);
  })();

  select(0);
  return root;
}
