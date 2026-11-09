// A phone-first map for comparing two runs (comparetrack.md), the Compare
// page's equivalent of track.md: both tracks on one full-screen Mapbox GL
// map, colored run1/run2 the same way the desktop compare map does
// (compareColorizers), with a shared bottom strip that scrubs both tracks
// together by elapsed time since each run's start -- the same axis the
// desktop Conditions charts already overlay runs on.
//
// Selection is unified around "elapsed time since start": dragging the
// strip, or tapping either track, picks an elapsed time and moves both
// runs' cursors to the point nearest that time. That keeps a single
// mental model instead of two independent cursors.

import * as d3 from 'npm:d3';
import { html, svg } from 'npm:htl';
import * as fmt from './formatters.js';
import { calloutMarker, buoyMarker, windRoseInset, fitToContents, lineFeature, emptyCollection } from './track-viewer.js';
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
  AnnotationsControl,
} from './gl-map.js';

const RUN_COLORS = ['hsl(140, 80%, 45%)', 'hsl(30, 85%, 55%)'];

// Both tracks, colored the same way the desktop compare map colors them
// (compareColorizers), or gray/dashed for a run with no GPS track.
function trackLines(pointsArr, colorizers) {
  const features = pointsArr.flatMap((points, i) =>
    trackFeatures(points, colorizers[i], points[0]?.approximate ? { dashed: true } : {})
  );
  return { type: 'FeatureCollection', features };
}

// Elapsed milliseconds since each run's own start, precomputed once so
// picking a point by elapsed time is a binary search.
// `t0` (seconds) overrides the run's own start: the together page uses
// one shared start so every rider's cursor is at the same clock time.
function withElapsed(points, t0 = points[0]?.tsi) {
  if (!points.length) return points;
  return points.map(d => ({ ...d, elapsed: (d.tsi - t0) * 1000 }));
}

// The shared speed strip: one area per run (run1 green, run2 orange),
// sharing an elapsed-time x-axis so the two runs scrub together. Returns
// the element plus a function to move the cursor to an elapsed time (ms).
function compareStrip(pointsArr, { onSelect, colors = RUN_COLORS }) {
  const height = 64;
  const el = html`<div class="track-strip"></div>`;
  let cursorAt = 0;
  let draw = () => {};

  const ro = new ResizeObserver(() => draw());
  ro.observe(el);

  const maxElapsed = Math.max(0, ...pointsArr.map(points => d3.max(points, d => d.elapsed) ?? 0));
  const maxSpeed = Math.max(1, ...pointsArr.map(points => d3.max(points, d => d.speed) ?? 0));

  draw = () => {
    const width = el.clientWidth;
    if (!width) return;
    const x = d3.scaleLinear([0, maxElapsed || 1], [0, width]);
    const y = d3.scaleLinear([0, maxSpeed], [height - 2, 4]);
    const area = points =>
      d3
        .area()
        .defined(d => d.speed != null)
        .x(d => x(d.elapsed))
        .y0(height)
        .y1(d => y(d.speed))(points);
    el.replaceChildren(html`<svg width=${width} height=${height}>
      ${pointsArr.map(
        (points, i) =>
          svg`<path d=${area(points)} fill=${colors[i]} fill-opacity="0.55"></path>`
      )}
      <line x1=${x(cursorAt)} x2=${x(cursorAt)} y1="0" y2=${height} stroke="white" stroke-width="2"></line>
    </svg>`);
    el._x = x;
  };

  const pick = event => {
    const x = el._x;
    if (!x) return;
    const rect = el.getBoundingClientRect();
    onSelect(x.invert(event.clientX - rect.left));
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
    moveTo(elapsed) {
      cursorAt = elapsed;
      draw();
    },
    destroy: () => ro.disconnect(),
  };
}

// `metas` and `pointsArr` are each [run1, run2] (fetchMeta rows and
// fetchRun tracks). `colorizers` is from compareColorizers. `opts`:
// `invalidation`, `backHref`, `callouts` (findCallouts per run, flattened,
// each tagged with `run` 0/1 -- see comparetrack.md), `fastestSegments`
// ([seg1, seg2] from findFastest1kSegment), `winds` ([wind1, wind2]),
// `buoy` ({lon, lat, summary, text}, as in track.md's buoy).
export function compareTrackViewer(
  metas,
  pointsArr,
  colorizers,
  {
    invalidation,
    backHref,
    backLabel = 'Back to the comparison',
    callouts = [],
    fastestSegments = [null, null],
    winds = [[], []],
    buoy = null,
    // The together page: one color per rider, a title line per rider, and
    // the cursor at the same clock time on every track, not the same
    // elapsed time.
    colors = RUN_COLORS,
    titles = null,
    names = null,
    sameClock = false,
    // Seconds of trail drawn behind each cursor (0: none).
    trailSec = 0,
  } = {}
) {
  const t0 = sameClock ? Math.min(...pointsArr.filter(p => p.length).map(p => p[0].tsi)) : undefined;
  const tracks = pointsArr.map(points => withElapsed(points, t0));
  const approximate = tracks.map(points => points[0]?.approximate ?? false);
  const ends = metas.map(m => new Date(m.ts.getTime() + m.duration_sec * 1000));
  const anyChart = tracks.some((points, i) => !approximate[i] && points.length >= 2);

  const mapEl = html`<div class="track-map"></div>`;
  const readout = html`<div class="track-readout track-readout-compare"></div>`;
  const details = html`<div class="track-details"></div>`;
  const hasWind = winds.some(w => w.length);
  const windBox = hasWind ? html`<div class="track-wind"></div>` : null;
  const windButton = hasWind ? html`<button class="track-wind-toggle" type="button">Wind</button>` : null;
  windButton?.addEventListener('click', () => {
    windBox.hidden = !windBox.hidden;
    windButton.setAttribute('aria-pressed', String(!windBox.hidden));
  });
  const chart = anyChart ? compareStrip(tracks, { onSelect: elapsed => select(elapsed), colors }) : null;

  const root = html`<div class="track-app">
    ${mapEl}
    ${windBox ? html`<div class="track-wind-area">${windButton}${windBox}</div>` : ''}
    <header class="track-bar track-bar-compare">
      <a class="track-back" href=${backHref} aria-label=${backLabel}>‹</a>
      <div class="track-title">
        ${titles ?? metas.map(
          (m, i) =>
            html`<div class="track-route" style=${`color: ${colors[i]}`}>${m.start_beach} → ${m.end_beach}
              <span class="track-sub">${fmt.shortStamp(m.ts)}–${fmt.clock(ends[i])} · ${m.distance_km.toFixed(1)} km</span></div>`
        )}
      </div>
    </header>
    <footer class="track-panel">
      ${readout}
      ${details}
      ${chart
        ? chart.el
        : html`<div class="track-note">No GPS track for ${approximate.every(Boolean) ? 'either run' : 'this run'}: the gray line is an approximate route between the beaches.</div>`}
    </footer>
  </div>`;

  const info = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '280px', className: 'track-info' });
  function showInfo(text, lngLat, { above, below }) {
    const top = map.project(lngLat).y < mapEl.clientHeight / 2;
    info.remove();
    info.options.anchor = top ? 'top' : 'bottom';
    info.setOffset(top ? [0, below] : [0, -above]).setLngLat(lngLat).setText(text).addTo(map);
  }

  let map = null;
  // The index per run, for the current elapsed time.
  let selected = [0, 0];
  function select(elapsed, { keepInfo = false } = {}) {
    if (!keepInfo) info.remove();
    selected = tracks.map(points => {
      if (!points.length) return 0;
      return Math.max(0, Math.min(points.length - 1, d3.bisector(d => d.elapsed).center(points, elapsed)));
    });
    const cursorFeatures = tracks
      .map((points, i) => (points[selected[i]] ? pointFeature(points[selected[i]], { color: colors[i] }) : null))
      .filter(Boolean);
    map?.getSource('cursor')?.setData({ type: 'FeatureCollection', features: cursorFeatures });
    if (trailSec) {
      // One segment per step so each can fade with its age.
      const trail = tracks.flatMap((points, i) => {
        const end = selected[i];
        const now = points[end]?.elapsed;
        if (now == null || approximate[i]) return [];
        const out = [];
        for (let j = end; j > 0 && now - points[j - 1].elapsed <= trailSec * 1000; j--) {
          const a = points[j - 1], b = points[j];
          out.push({ ...lineFeature([a.lon, a.lat], [b.lon, b.lat]), properties: { color: colors[i], o: 1 - (0.85 * (now - b.elapsed)) / (trailSec * 1000) } });
        }
        return out;
      });
      map?.getSource('trail')?.setData({ type: 'FeatureCollection', features: trail });
    }
    chart?.moveTo(elapsed);
    const lines = tracks.map((points, i) => {
      const m = metas[i];
      const d = points[selected[i]];
      if (!d) return null;
      const who = names ? html`<b>${names[i]}</b> ` : '';
      if (approximate[i]) return html`<span style=${`color: ${colors[i]}`}>${who}${fmt.clock(m.ts)}–${fmt.clock(ends[i])}</span>`;
      // Past the end of a rider's track the cursor stays on its last point.
      const done = sameClock && elapsed > points[points.length - 1].elapsed + 5000 ? ' · finished' : '';
      return html`<span style=${`color: ${colors[i]}`}>${who}<b>${d.speed == null ? '–' : d.speed.toFixed(1)}</b> km/h
        · <b>${d.hr ?? '–'}</b> bpm · <b>${(d.distance / 1000).toFixed(2)}</b> km${done}</span>`;
    });
    readout.replaceChildren(...lines.filter(Boolean));
    details.textContent = sameClock
      ? `${fmt.time(new Date(t0 * 1000 + elapsed))} · ${fmt.seconds(elapsed / 1000)} since the first start`
      : `${fmt.seconds(elapsed / 1000)} elapsed`;
  }

  function init() {
    if (windBox) {
      winds.forEach((wind, i) => {
        if (!wind.length) return;
        const rose = windRoseInset(wind, window.innerWidth, winds.length > 1 ? `Wind ${i + 1} (avg)` : 'Wind (avg)');
        windBox.append(rose);
        fitToContents(rose);
      });
      windBox.hidden = window.innerWidth < 640;
      windButton.setAttribute('aria-pressed', String(!windBox.hidden));
    }
    setAccessToken();
    const allPoints = tracks.flat();
    map = new mapboxgl.Map({
      container: mapEl,
      style: mapStyle(),
      bounds: allPoints.length ? pointBounds(allPoints) : undefined,
      fitBoundsOptions: {
        padding: { top: 100, bottom: 150, left: windBox && !windBox.hidden ? windBox.offsetWidth + 24 : 30, right: 50 },
      },
      attributionControl: false,
      pitchWithRotate: false,
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    map.addControl(new mapboxgl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-right');
    map.addControl(new AnnotationsControl(root), 'top-right');
    invalidation?.then(() => {
      map.remove();
      chart?.destroy();
    });

    whenStyleReady(map, () => {
      addTrackLayers(map, trackLines(tracks, colorizers), tracks.flatMap(endFeatures), { tolerance: 0 });
      fastestSegments.forEach((fastestSegment, i) => {
        if (!fastestSegment) return;
        const { startReading: a, endReading: b } = fastestSegment;
        map.addSource(`fastest${i}`, { type: 'geojson', data: lineFeature([a.lon, a.lat], [b.lon, b.lat]) });
        map.addLayer({
          id: `fastest${i}`,
          type: 'line',
          source: `fastest${i}`,
          paint: { 'line-color': '#f0f', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [1.5, 1.5] },
        });
      });
      map.addSource('trail', { type: 'geojson', data: emptyCollection });
      map.addLayer({
        id: 'trail',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': ['get', 'o'] },
      });
      map.addSource('cursor', { type: 'geojson', data: emptyCollection });
      map.addLayer({
        id: 'cursor',
        type: 'circle',
        source: 'cursor',
        paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 },
      });
      select(0);
      // Callouts from both runs; each is tagged `run` (0/1) so the badge
      // is colored to match and a tap can find that run's point.
      callouts.forEach(c => {
        const points = tracks[c.run] ?? [];
        const i = points.findIndex(d => d.lat === c.lat && d.lon === c.lon);
        calloutMarker(c, () => {
          if (i >= 0) select(points[i].elapsed, { keepInfo: true });
          const p = map.project([+c.lon, +c.lat]);
          const near = callouts.filter(o => {
            const q = map.project([+o.lon, +o.lat]);
            return (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < 32 * 32;
          });
          showInfo([...new Set(near.map(o => `${o.icon} ${o.text}`))].join('\n'), [+c.lon, +c.lat], { above: 40, below: 6 });
        }).addTo(map);
      });
      if (buoy?.summary?.primary) buoyMarker(buoy, () => showInfo(buoy.text, [buoy.lon, buoy.lat], { above: 12, below: 12 })).addTo(map);
      root.dataset.ready = 'true';
    });

    // Tapping either track picks the nearest point on it (within a
    // finger's width) and syncs both runs' cursors to its elapsed time.
    map.on('click', event => {
      if (event.originalEvent.target.closest?.('.track-callout, .track-buoy')) return;
      info.remove();
      const { x, y } = event.point;
      let best = -1;
      let bestDist = 30 * 30;
      let bestDataset = -1;
      tracks.forEach((points, dataset) => {
        if (approximate[dataset]) return;
        points.forEach((d, i) => {
          const p = map.project([d.lon, d.lat]);
          const dist = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
            bestDataset = dataset;
          }
        });
      });
      if (best >= 0) select(tracks[bestDataset][best].elapsed);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapEl);
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

  return root;
}
