// A phone-first track viewer (track.md): the run fills the screen as a
// Mapbox GL map, with a slim title bar on top and a speed/heart-rate strip
// along the bottom. Dragging along the strip (or tapping the track) moves a
// marker along the run and shows time, speed, HR and distance at that point
// -- the touch replacement for the desktop map's hover tooltips.
//
// Mapbox GL handles pinch zoom, rotation and panning natively, and draws
// the track as one line layer instead of thousands of SVG dots.
//
// The run page's annotations come along as native map pieces, so they
// follow rotation: callouts (top speed, odometer milestones, ...) as
// markers, the fastest km as a dashed line, the buoy's swell arrows as a
// marker, the wind rose as a toggleable inset. Tapping a callout or the
// buoy says what it is in the bottom panel.

import * as d3 from 'npm:d3';
import { html, svg } from 'npm:htl';
import * as fmt from './formatters.js';
import { speedColor, APPROXIMATE_COLOR } from './map.js';
import { addWindRose, windRoseScale, WIND_SPEED_COLORS } from './wind-rose.js';
import { FOIL_THRESHOLD_KPH } from './color.js';
import {
  mapboxgl,
  mapStyle,
  setAccessToken,
  pointFeature,
  trackFeatures,
  endFeatures,
  addTrackLayers,
  whenStyleReady,
  pointBounds,
} from './gl-map.js';

// The track colored the way the desktop map colors it (speedColor), so the
// two read the same.
function trackLines(points, approximate) {
  const color = approximate ? () => APPROXIMATE_COLOR : speedColor(points.map(d => d.speed));
  return { type: 'FeatureCollection', features: trackFeatures(points, color, approximate ? { dashed: true } : {}) };
}

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

// A callout as a map marker: its emoji on a white badge, with a tail
// pointing down at the spot.
function calloutMarker(callout, onTap) {
  const el = html`<button class="track-callout" type="button" aria-label=${callout.text}>${callout.icon}</button>`;
  el.addEventListener('click', event => {
    event.stopPropagation();
    onTap();
  });
  return new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([+callout.lon, +callout.lat]);
}

// The buoy's swell: a dot with an arrow per component, pointing the way
// the swell travels and as long as it is tall (relative to the primary).
// rotationAlignment 'map' turns the arrows with the map.
function buoyMarker({ lon, lat, summary }, onTap) {
  const color = '#0ea5e9';
  const swells = [summary.primary, ...summary.components].filter(Boolean);
  const length = d3.scaleLinear([0, summary.primary.height], [0, 60]).clamp(true);
  const r = 72;
  const el = html`<button class="track-buoy" type="button" aria-label="Pauwela buoy swell">${svg`<svg width=${r * 2} height=${r * 2} viewBox="${-r} ${-r} ${r * 2} ${r * 2}">
    <defs><marker id="track-buoy-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill=${color}></path></marker></defs>
    ${swells.map(d => {
      const l = Math.max(15, length(d.height));
      const a = ((d.direction + 180) * Math.PI) / 180;
      return svg`<line x2=${l * Math.sin(a)} y2=${-l * Math.cos(a)} stroke=${color} stroke-width="2.5" stroke-linecap="round" opacity="0.85" marker-end="url(#track-buoy-arrowhead)"></line>`;
    })}
    <circle r="6" fill=${color} fill-opacity="0.85" stroke="white" stroke-width="1.5"></circle>
    <circle r="20" fill="transparent"></circle>
  </svg>`}</button>`;
  el.addEventListener('click', event => {
    event.stopPropagation();
    onTap();
  });
  return new mapboxgl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat([lon, lat]);
}

// The wind rose in its own SVG, sized to what it drew.
function windRoseInset(wind, width) {
  const scale = windRoseScale(width);
  const el = svg`<svg class="track-wind-rose"></svg>`;
  const sel = d3.select(el);
  addWindRose(d3, sel, wind, { x: 0, y: 0, title: 'Wind (avg)', scheme: WIND_SPEED_COLORS, scale });
  return el;
}

function fitToContents(el) {
  const box = el.getBBox();
  if (!box.width) return;
  const pad = 4;
  el.setAttribute('viewBox', [box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2].join(' '));
  el.setAttribute('width', box.width + pad * 2);
  el.setAttribute('height', box.height + pad * 2);
}

const lineFeature = (a, b) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [a, b] },
});

const emptyCollection = { type: 'FeatureCollection', features: [] };

// `meta` is a runs.csv row (fetchMeta), `points` its track (fetchRun).
// `invalidation` is Framework's promise for cleaning up when the cell
// re-runs. The annotations are optional: `callouts` (findCallouts),
// `fastestSegment` (findFastest1kSegment), `wind` (fetchWind) and `buoy`
// ({lon, lat, summary, text}, with summary from summarizeSwellPartition).
export function trackViewer(
  meta,
  points,
  { invalidation, backHref, callouts = [], fastestSegment = null, wind = [], buoy = null } = {}
) {
  const approximate = points[0]?.approximate ?? false;
  const end = new Date(meta.ts.getTime() + meta.duration_sec * 1000);
  const mapEl = html`<div class="track-map"></div>`;
  const readout = html`<div class="track-readout"></div>`;
  const details = html`<div class="track-details"></div>`;
  const caption = html`<div class="track-caption" hidden></div>`;
  // The wind rose sits under the title bar; on a phone it starts folded
  // away behind a button so it doesn't cover the track.
  const windBox = wind.length ? html`<div class="track-wind"></div>` : null;
  const windButton = wind.length ? html`<button class="track-wind-toggle" type="button">Wind</button>` : null;
  windButton?.addEventListener('click', () => {
    windBox.hidden = !windBox.hidden;
    windButton.setAttribute('aria-pressed', String(!windBox.hidden));
  });
  const chart = approximate || points.length < 2 ? null : strip(points, { onSelect: i => select(i) });

  const root = html`<div class="track-app">
    ${mapEl}
    ${windBox ? html`<div class="track-wind-area">${windButton}${windBox}</div>` : ''}
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
      ${caption}
      ${readout}
      ${details}
      ${chart ? chart.el : html`<div class="track-note">No GPS track for this run: the gray line is an approximate route between the beaches.</div>`}
    </footer>
  </div>`;

  // Says what a tapped callout or the buoy is; picking another point on
  // the track or the strip clears it.
  function showCaption(text) {
    caption.textContent = text;
    caption.hidden = !text;
  }

  let map = null;
  let selected = 0;
  function select(i, { keepCaption = false } = {}) {
    selected = i;
    const d = points[i];
    if (!d) return;
    if (!keepCaption) showCaption('');
    map?.getSource('cursor')?.setData(pointFeature(d));
    map
      ?.getSource('nearest-land')
      ?.setData(
        !approximate && d.nearest_land_lat && d.nearest_land_lon
          ? {
              type: 'FeatureCollection',
              features: [
                lineFeature([d.lon, d.lat], [+d.nearest_land_lon, +d.nearest_land_lat]),
                pointFeature({ lon: +d.nearest_land_lon, lat: +d.nearest_land_lat }),
              ],
            }
          : emptyCollection
      );
    chart?.moveTo(i);
    details.textContent = [
      approximate ? null : `${fmt.timeDiff(points[0].ts, d.ts)} elapsed`,
      approximate || !d.distance_to_land ? null : `${fmt.distanceM(d.distance_to_land)} from land`,
      d.odometer ? `odometer ${fmt.distanceM(d.odometer)}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
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
    if (windBox) {
      const rose = windRoseInset(wind, window.innerWidth);
      windBox.append(rose);
      fitToContents(rose);
      windBox.hidden = window.innerWidth < 640;
      windButton.setAttribute('aria-pressed', String(!windBox.hidden));
    }
    setAccessToken();
    map = new mapboxgl.Map({
      container: mapEl,
      style: mapStyle(),
      bounds: pointBounds(points),
      // Clear of the bars, and of the wind rose when it starts out open.
      fitBoundsOptions: {
        padding: { top: 80, bottom: 150, left: windBox && !windBox.hidden ? windBox.offsetWidth + 24 : 30, right: 50 },
      },
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

    whenStyleReady(map, () => {
      addTrackLayers(map, trackLines(points, approximate), endFeatures(points));
      if (fastestSegment) {
        const { startReading: a, endReading: b } = fastestSegment;
        map.addSource('fastest', { type: 'geojson', data: lineFeature([a.lon, a.lat], [b.lon, b.lat]) });
        map.addLayer({
          id: 'fastest',
          type: 'line',
          source: 'fastest',
          paint: { 'line-color': '#f0f', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [1.5, 1.5] },
        });
      }
      map.addSource('nearest-land', { type: 'geojson', data: emptyCollection });
      map.addLayer({
        id: 'nearest-land',
        type: 'line',
        source: 'nearest-land',
        paint: { 'line-color': '#ff6b6b', 'line-width': 2, 'line-opacity': 0.85, 'line-dasharray': [2, 2] },
      });
      map.addLayer({
        id: 'nearest-land-point',
        type: 'circle',
        source: 'nearest-land',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 4, 'circle-color': '#ff6b6b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
      });
      map.addSource('cursor', { type: 'geojson', data: pointFeature(points[selected]) });
      map.addLayer({
        id: 'cursor',
        type: 'circle',
        source: 'cursor',
        paint: { 'circle-radius': 8, 'circle-color': '#fff', 'circle-stroke-color': '#111', 'circle-stroke-width': 3 },
      });
      select(selected);
      // Callouts often stack up (the fastest km starts near the top speed),
      // so a tap explains every callout whose badge overlaps the tapped one.
      callouts.forEach(c => {
        const i = points.findIndex(d => d.lat === c.lat && d.lon === c.lon);
        calloutMarker(c, () => {
          if (i >= 0) select(i, { keepCaption: true });
          const p = map.project([+c.lon, +c.lat]);
          const near = callouts.filter(o => {
            const q = map.project([+o.lon, +o.lat]);
            return (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 32 * 32;
          });
          showCaption([...new Set(near.map(o => `${o.icon} ${o.text}`))].join('\n'));
        }).addTo(map);
      });
      if (buoy?.summary?.primary) buoyMarker(buoy, () => showCaption(buoy.text)).addTo(map);
      root.dataset.ready = 'true';
    });

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
    // The panel grows with a caption; keep the map's bottom controls above it.
    const panel = root.querySelector('.track-panel');
    const panelRo = new ResizeObserver(() => root.style.setProperty('--track-panel-height', `${panel.offsetHeight}px`));
    panelRo.observe(panel);
    invalidation?.then(() => panelRo.disconnect());
    invalidation?.then(() => ro.disconnect());
  }
  (function whenAttached() {
    if (root.isConnected) init();
    else requestAnimationFrame(whenAttached);
  })();

  select(0);
  return root;
}
