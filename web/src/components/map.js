import * as d3 from 'npm:d3';
import * as fmt from './formatters.js';
import _ from 'npm:lodash';
import {FOIL_THRESHOLD_KPH} from './color.js';
import {
  mapboxgl,
  mapStyle,
  setAccessToken,
  trackFeatures,
  endFeatures,
  addTrackLayers,
  whenStyleReady,
  pointBounds,
  mapTransform,
  pointIndex,
} from './gl-map.js';

// Approximate routes (runs with no GPS track; see approximateRoute in
// data.js) are drawn in gray: there's no speed to color them by.
export const APPROXIMATE_COLOR = '#999';

export function speedColor(speeds) {
  const maxSpeed = d3.max(speeds);

  const colorScale = d3
    .scaleQuantile()
    .domain(speeds.filter(s => s > FOIL_THRESHOLD_KPH))
    .range(['#ff0', '#cf0', '#9f0', '#6f0', '#3f0', '#0f0']);

  return function (speed) {
    return speed > FOIL_THRESHOLD_KPH ? colorScale(speed) : '#900';
  };
}

export function findCallouts(runMeta, data, fastestSegments = []) {
  const callouts = [];
  // An approximate route has no speeds or positions worth pointing at;
  // only the lifetime odometer milestones below still mean something.
  if (!data[0]?.approximate) {
    const maxSpeed = _.maxBy(data, d => d.speed);
    const maxDist = _.maxBy(data, d => d.distance_to_land);
    if (maxSpeed) {
      callouts.push({
        lat: maxSpeed.lat,
        lon: maxSpeed.lon,
        icon: '🚀',
        text: `Top speed of ${maxSpeed.speed.toFixed(2)} kph`,
      });
    }
    if (maxDist) {
      callouts.push({
        lat: maxDist.lat,
        lon: maxDist.lon,
        icon: '🗺️',
        text: `Maximum distance from land of ${(maxDist.distance_to_land / 1000).toFixed(2)} km`,
      });
    }
  }

  if (runMeta.min_foiling_hr) {
    const firstPaddleUp = runMeta.distance_to_first_paddle_up || 0;
    let lastMinHrTs = null;
    for (const reading of data.filter(d => d.speed > FOIL_THRESHOLD_KPH && d.hr === runMeta.min_foiling_hr && d.distance >= firstPaddleUp)) {
      if (lastMinHrTs !== null && reading.ts - lastMinHrTs < 2 * 60 * 1000) continue;
      lastMinHrTs = reading.ts;
      callouts.push({
        lat: reading.lat,
        lon: reading.lon,
        icon: '🫀',
        text: `Min foiling heart rate of ${runMeta.min_foiling_hr} bpm`,
      });
    }
  }

  fastestSegments.forEach(fastestSegment => {
    if (fastestSegment) {
      callouts.push({
        lat: fastestSegment.startReading.lat,
        lon: fastestSegment.startReading.lon,
        icon: '🏁',
        text: `Start of fastest 1km segment (${fmt.time(fastestSegment.startTime)})`,
      });
      callouts.push({
        lat: fastestSegment.endReading.lat,
        lon: fastestSegment.endReading.lon,
        icon: '⏱️',
        text: `End of fastest 1km segment (${fmt.time(fastestSegment.endTime)})`,
      });
    }
  });

  for (let i = 1; i < data.length; i++) {
    const prevHundreds = Math.floor(data[i - 1].odometer / 100000);
    const currHundreds = Math.floor(data[i].odometer / 100000);
    for (let h = prevHundreds + 1; h <= currHundreds; h++) {
      const km = h * 100;
      const isThousand = h % 10 === 0;
      callouts.push({
        lat: data[i].lat,
        lon: data[i].lon,
        icon: isThousand ? '🎉' : '💯',
        text: isThousand
          ? `${km.toLocaleString()} km lifetime!`
          : `${km.toLocaleString()} km lifetime`,
      });
    }
  }

  return callouts;
}

// Find the fastest 1000m segment in the data
export function findFastest1kSegment(data) {
  // An approximate route's even spacing would make up a "fastest" km.
  if (data.length < 2 || data[0].approximate) return null;

  let bestSegment = null;
  let bestDuration = Infinity;

  // For each reading, find the segment that covers approximately 1000m
  for (let i = 0; i < data.length; i++) {
    const startReading = data[i];
    let cumulativeDistance = 0;

    // Get starting distance if available
    let startDistance = 0;
    if (startReading.distance !== undefined) {
      startDistance = startReading.distance;
    }

    // Look forward to find the 1000m segment
    for (let j = i + 1; j < data.length; j++) {
      const currentReading = data[j];

      cumulativeDistance = currentReading.distance - startDistance;

      // Check if we've reached approximately 1000m
      if (cumulativeDistance >= 1000) {
        const duration = currentReading.tsi - startReading.tsi;

        // If this is faster than our current best, update
        if (duration < bestDuration) {
          bestDuration = duration;
          bestSegment = {
            start: i,
            end: j,
            duration: duration,
            distance: cumulativeDistance,
            startTime: startReading.ts,
            endTime: currentReading.ts,
            startReading: startReading,
            endReading: currentReading,
          };
        }

        // Break inner loop as we've found our segment for this start point
        break;
      }
    }
  }

  return bestSegment;
}

// Half as tall as it is wide, as it always was, but tall enough to use on
// a phone and no taller than most of the screen on a wide monitor.
function mapHeight(width) {
  const maxHeight = Math.max(320, window.innerHeight * 0.75);
  return Math.round(Math.min(Math.max(width * 0.5, Math.min(width, 360)), maxHeight));
}

const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

function pointTooltip(d, firstTs) {
  return d.approximate
    ? ['Approximate route: no GPS track', `for this run (${fmt.date(d.ts)}).`, `Odometer: ${fmt.distanceM(d.odometer)}`]
    : [
        `Date: ${fmt.date(d.ts)}`,
        `Time: ${fmt.time(d.ts)}`,
        `Time so far: ${fmt.timeDiff(firstTs, d.ts)}`,
        `Distance So Far: ${(d.distance / 1000).toFixed(2)} km`,
        `Odometer: ${fmt.distanceM(d.odometer)}`,
        `Speed: ${d.speed ? d.speed.toFixed(1) : 'N/A'} kph`,
        `Heart Rate: ${d.hr ? d.hr : 'unknown'} bpm`,
        `Nearest Land: ${d.distance_to_land ? (d.distance_to_land / 1000).toFixed(2) : 'unknown'} km`,
      ];
}

// One or more runs on a Mapbox GL map: each track as speed-colored lines
// (gray and dashed for an approximate route), with start/end dots. On top
// sits an SVG overlay, positioned to match the map, for the callouts, the
// fastest-1km lines and whatever `opts.additionalMarks` draws (wind rose,
// buoy marker). Hovering near the track, or tapping it, shows that point's
// details.
//
// `opts.additionalMarks({d3, svg, width, height})` gets the overlay and may
// return `{updateOnZoom({transform, width, height})}`, called whenever the
// map moves, with the view as a d3-zoom transform (see mapTransform).
export function renderRun(width, datas, callouts = [], opts = { fastestSegments: null }) {
  const colorizers = (opts.colorizers || datas.map(data => speedColor(data.map(d => d.speed)))).map((c, i) =>
    datas[i][0]?.approximate ? () => APPROXIMATE_COLOR : c
  );
  const height = mapHeight(width);
  const fastestSegments = (opts.fastestSegments || []).filter(Boolean);
  const allPoints = datas.flat();

  const root = d3
    .create('div')
    .attr('class', 'run-map')
    .style('position', 'relative')
    .style('width', '100%')
    .style('height', `${height}px`)
    .style('overflow', 'hidden')
    .style('background', '#111');
  const mapEl = root.append('div').style('position', 'absolute').style('inset', 0).node();
  const svg = root
    .append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', [0, 0, width, height])
    .style('position', 'absolute')
    .style('inset', 0)
    .style('pointer-events', 'none');
  const tooltip = root
    .append('div')
    .attr('class', 'data-point-tooltip')
    .style('position', 'absolute')
    .style('display', 'none')
    .style('background', 'rgba(0, 0, 0, 0.9)')
    .style('color', 'white')
    .style('padding', '8px 12px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('line-height', 1.4)
    .style('pointer-events', 'none')
    .style('z-index', 2)
    .style('max-width', '200px');

  // Add defs for arrowhead marker
  svg
    .append('defs')
    .append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 1)
    .attr('refY', 3)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M1,0 L1,6 L10,3 z')
    .attr('fill', '#333');

  const runG = svg.append('g');
  const cursorG = svg.append('g');

  // Add callout groups
  const calloutsG = svg.append('g').attr('class', 'callouts');
  let calloutGroups = calloutsG.selectAll('.callout-group');

  let additional;
  if (typeof opts.additionalMarks === 'function') {
    additional = opts.additionalMarks({ d3, svg, width, height });
  }

  // The point under the mouse, and the one last tapped or clicked; the
  // hovered one wins while there is one.
  let hovered = null;
  let pinned = null;

  function drawCursor(projection) {
    const hit = hovered ?? pinned;
    const p = hit && projection([+hit.point.lon, +hit.point.lat]);
    const visible = p && p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height;
    cursorG.selectAll('*').remove();
    if (!visible) {
      tooltip.style('display', 'none');
      return;
    }
    const d = hit.point;

    // Draw line to nearest land if coordinates are available
    if (d.nearest_land_lat && d.nearest_land_lon) {
      const landPoint = projection([+d.nearest_land_lon, +d.nearest_land_lat]);
      if (landPoint) {
        cursorG
          .append('line')
          .attr('class', 'nearest-land-line')
          .attr('x1', p[0])
          .attr('y1', p[1])
          .attr('x2', landPoint[0])
          .attr('y2', landPoint[1])
          .attr('stroke', '#ff6b6b')
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '5,5')
          .attr('opacity', 0.8);
        cursorG
          .append('circle')
          .attr('class', 'nearest-land-point')
          .attr('cx', landPoint[0])
          .attr('cy', landPoint[1])
          .attr('r', 4)
          .attr('fill', '#ff6b6b')
          .attr('stroke', 'white')
          .attr('stroke-width', 1)
          .attr('opacity', 0.9);
      }
    }
    cursorG
      .append('circle')
      .attr('class', 'track-cursor')
      .attr('cx', p[0])
      .attr('cy', p[1])
      .attr('r', 7)
      .attr('fill', colorizers[hit.dataset](d.speed))
      .attr('stroke', 'white')
      .attr('stroke-width', 2.5);

    tooltip.style('display', null).html(pointTooltip(d, datas[hit.dataset][0].ts).join('<br>'));
    const tw = tooltip.node().offsetWidth;
    const th = tooltip.node().offsetHeight;
    const left = Math.max(6, Math.min(width - tw - 6, p[0] - tw / 2));
    let top = p[1] - th - 14;
    if (top < 6) top = p[1] + 14; // Show below point instead
    tooltip.style('left', `${left}px`).style('top', `${top}px`);
  }

  function redraw(transform) {
    const projection = d3
      .geoMercator()
      .scale(transform.k / (2 * Math.PI))
      .translate([transform.x, transform.y]);
    const zoomLevel = Math.log2(transform.k);

    runG.selectAll('.fastest-segment-line').remove();

    fastestSegments.forEach(fastestSegment => {
      const startProjected = projection([+fastestSegment.startReading.lon, +fastestSegment.startReading.lat]);
      const endProjected = projection([+fastestSegment.endReading.lon, +fastestSegment.endReading.lat]);

      if (
        startProjected &&
        endProjected &&
        startProjected[0] >= -100 &&
        startProjected[0] <= width + 100 &&
        startProjected[1] >= -100 &&
        startProjected[1] <= height + 100 &&
        endProjected[0] >= -100 &&
        endProjected[0] <= width + 100 &&
        endProjected[1] >= -100 &&
        endProjected[1] <= height + 100
      ) {
        runG
          .append('line')
          .attr('class', 'fastest-segment-line')
          .attr('x1', startProjected[0])
          .attr('y1', startProjected[1])
          .attr('x2', endProjected[0])
          .attr('y2', endProjected[1])
          .attr('stroke', '#ff00ff')
          .attr('stroke-width', 3)
          .attr('stroke-dasharray', '5,5')
          .attr('opacity', 0.8);
      }
    });

    drawCursor(projection);

    // Project and render callouts
    const projectedCallouts = callouts
      .map(callout => {
        const p = projection([+callout.lon, +callout.lat]);
        if (!p || p[0] < -100 || p[0] > width + 100 || p[1] < -100 || p[1] > height + 100) {
          return null;
        }

        // Calculate offset position for icon (45 degrees up and right)
        const offsetDistance = 80 + Math.max(0, (15 - zoomLevel) * 8);
        const offsetX = p[0] + offsetDistance * Math.cos(-Math.PI / 4);
        const offsetY = p[1] + offsetDistance * Math.sin(-Math.PI / 4);

        return {
          ...callout,
          pointX: p[0],
          pointY: p[1],
          iconX: offsetX,
          iconY: offsetY,
        };
      })
      .filter(d => d !== null);

    calloutGroups = calloutGroups
      .data(projectedCallouts, d => `${d.lat}-${d.lon}`)
      .join(
        enter => {
          const group = enter
            .append('g')
            .attr('class', 'callout-group')
            .style('cursor', 'pointer')
            .style('pointer-events', 'all');

          // Add arrow path (curved)
          group
            .append('path')
            .attr('class', 'callout-arrow')
            .attr('stroke', '#333')
            .attr('stroke-width', 1.5)
            .attr('fill', 'none')
            .attr('marker-end', 'url(#arrowhead)');

          // Add icon background circle
          group
            .append('circle')
            .attr('class', 'callout-icon-bg')
            .attr('r', 12)
            .attr('fill', 'white')
            .attr('stroke', '#333')
            .attr('stroke-width', 1.5);

          // Add icon text
          group
            .append('text')
            .attr('class', 'callout-icon')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', '16px')
            .attr('fill', '#333')
            .style('pointer-events', 'none');

          // Add invisible hover target
          group
            .append('circle')
            .attr('class', 'callout-hover-target')
            .attr('r', 20)
            .attr('fill', 'transparent');

          return group;
        },
        update => update,
        exit => exit.remove()
      );

    // Update callout positions and content
    calloutGroups.each(function (d) {
      const group = d3.select(this);

      // Calculate curved path from callout icon to data point
      const dx = d.pointX - d.iconX;
      const dy = d.pointY - d.iconY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Create a control point for the curve (perpendicular to the line)
      const curvature = 0.3; // Adjust this to make curve more/less pronounced
      const midX = (d.iconX + d.pointX) / 2;
      const midY = (d.iconY + d.pointY) / 2;
      const perpX = (-dy / distance) * curvature * distance * 0.2;
      const perpY = (dx / distance) * curvature * distance * 0.2;
      const controlX = midX + perpX;
      const controlY = midY + perpY;

      // Start path from edge of icon circle, end just before data point
      const iconRadius = 12;
      const startX = d.iconX + (dx / distance) * iconRadius;
      const startY = d.iconY + (dy / distance) * iconRadius;
      const endX = d.pointX - (dx / distance) * 3; // Stop 3px from point
      const endY = d.pointY - (dy / distance) * 3;

      const pathData = `M${startX},${startY} Q${controlX},${controlY} ${endX},${endY}`;

      // Update arrow path
      group.select('.callout-arrow').attr('d', pathData);

      // Update icon position
      group.select('.callout-icon-bg').attr('cx', d.iconX).attr('cy', d.iconY);

      group.select('.callout-icon').attr('x', d.iconX).attr('y', d.iconY).text(d.icon);

      group.select('.callout-hover-target').attr('cx', d.iconX).attr('cy', d.iconY);
    });

    // Add hover behavior with tooltip
    calloutGroups
      .on('mouseenter', function (event, d) {
        // Create tooltip
        const tooltip = d3
          .select('body')
          .append('div')
          .attr('class', 'callout-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.8)')
          .style('color', 'white')
          .style('padding', '8px 12px')
          .style('border-radius', '4px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .text(d.text);

        // Position tooltip
        const rect = event.target.getBoundingClientRect();
        tooltip
          .style('left', rect.left + window.pageXOffset + 25 + 'px')
          .style('top', rect.top + window.pageYOffset - 10 + 'px');

        // Highlight callout
        d3.select(this).select('.callout-icon-bg').attr('fill', '#f0f0f0');
      })
      .on('mouseleave', function () {
        // Remove tooltip
        d3.select('.callout-tooltip').remove();

        // Reset highlight
        d3.select(this).select('.callout-icon-bg').attr('fill', 'white');
      });

    if (additional?.updateOnZoom) additional.updateOnZoom({ transform, width, height });
  }

  const index = pointIndex(datas);
  let map = null;
  let draw = () => {};

  // Mapbox sizes its canvas from the container when it's created, so wait
  // until Framework has put the map on the page.
  function init() {
    setAccessToken();
    map = new mapboxgl.Map({
      container: mapEl,
      style: mapStyle('satellite-v9'),
      ...(allPoints.length
        ? { bounds: pointBounds(allPoints), fitBoundsOptions: { padding: 24, maxZoom: 16 } }
        : { center: [-156.33, 20.8], zoom: 9 }),
      minZoom: 1,
      maxZoom: 18,
      attributionControl: false,
      // The overlays assume a north-up, flat map.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // On a phone, one finger scrolls the page and two move the map, so
      // the map doesn't trap you halfway down the run page.
      cooperativeGestures: coarsePointer(),
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    let frame = null;
    draw = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        redraw(mapTransform(map));
      });
    };
    map.on('move', draw);
    map.on('resize', draw);
    redraw(mapTransform(map));

    whenStyleReady(map, () => {
      const features = datas.flatMap((points, i) =>
        trackFeatures(points, colorizers[i], points[0]?.approximate ? { dashed: true } : {})
      );
      addTrackLayers(map, { type: 'FeatureCollection', features }, datas.flatMap(endFeatures), { tolerance: 0 });
      root.attr('data-ready', 'true');
    });

    map.on('mousemove', event => {
      const hit = index.pick(mapTransform(map), event.point.x, event.point.y, 10);
      if (hit?.point !== hovered?.point) {
        hovered = hit;
        draw();
      }
    });
    mapEl.addEventListener('mouseleave', () => {
      hovered = null;
      draw();
    });
    // A tap (or click) near the track, within a finger's width, pins that
    // point's details; one away from it clears them.
    map.on('click', event => {
      const radius = event.originalEvent.pointerType === 'mouse' ? 12 : 30;
      pinned = index.pick(mapTransform(map), event.point.x, event.point.y, radius);
      draw();
    });

    // Framework's resize() replaces the map when the page width changes;
    // let go of the old one's WebGL context when it leaves the page.
    const gone = new MutationObserver(() => {
      if (root.node().isConnected) return;
      gone.disconnect();
      map.remove();
    });
    gone.observe(document.body, { childList: true, subtree: true });
  }
  (function whenAttached() {
    if (root.node().isConnected) init();
    else requestAnimationFrame(whenAttached);
  })();

  return root.node();
}

// Wind rosefrom my wind data.
export function createWindRoseInset(
  d3,
  svg,
  readings,
  {
    x = 80,
    y = 80,
    radius = 70,
    innerHole = 20,
    nDirections = 16,
    speedBreaks = [0, 5, 10, 15, 20, 25, 30],
    speedAccessor = d => d.wavg ?? d.wgust,
    normalize = true,
    colors = { type: 'ordinal', scheme: d3.schemeTableau10 },
    title = 'Wind Speed (knots)',
    fontSize = 18,
  } = {}
) {
  if (!readings || readings.length < 1) {
    return [];
  }
  const wrap360 = deg => ((deg % 360) + 360) % 360;
  const sectorSize = 360 / nDirections;
  const speedLabels = [];
  const binCenters = new Map();
  for (let i = 0; i < speedBreaks.length - 1; i++) {
    const lo = speedBreaks[i],
      hi = speedBreaks[i + 1];
    const lab = `${lo}–${hi}`;
    speedLabels.push(lab);
    binCenters.set(lab, (lo + hi) / 2);
  }
  const last = speedBreaks.at(-1);
  speedLabels.push(`${last}+`);
  binCenters.set(`${last}+`, last);

  const binSpeed = v => {
    if (v == null || Number.isNaN(v)) return null;
    for (let i = 0; i < speedBreaks.length - 1; i++) {
      if (v >= speedBreaks[i] && v < speedBreaks[i + 1])
        return `${speedBreaks[i]}–${speedBreaks[i + 1]}`;
    }
    return `${speedBreaks.at(-1)}+`;
  };

  // Tally sector/bin counts
  const key = (sector, label) => `${sector}|${label}`;
  const counts = new Map();
  const sectorTotals = new Array(nDirections).fill(0);

  for (const r of readings ?? []) {
    const wdir = r?.wdir;
    if (wdir == null || Number.isNaN(wdir)) continue;
    const s = speedAccessor(r);
    const sector = Math.floor(wrap360(wdir) / sectorSize);
    const lbl = binSpeed(s);
    if (!lbl) continue;
    counts.set(key(sector, lbl), (counts.get(key(sector, lbl)) ?? 0) + 1);
    sectorTotals[sector]++;
  }

  const total = sectorTotals.reduce((a, b) => a + b, 0);
  const rMaxRose = normalize ? 1 : Math.max(...sectorTotals, 1);
  const ticks = normalize
    ? [0.25, 0.5, 0.75, 1.0]
    : Array.from(
        new Set([rMaxRose / 4, rMaxRose / 2, (3 * rMaxRose) / 4, rMaxRose].map(v => Math.ceil(v)))
      ).filter(Boolean);

  // Build stacked rows
  const rows = [];
  for (let s = 0; s < nDirections; s++) {
    const toRad = deg => (deg * Math.PI) / 180;
    const half = sectorSize / 2;
    const t0 = toRad(s * sectorSize - half);
    const t1 = toRad((s + 1) * sectorSize - half);
    let acc = 0;
    for (const lbl of speedLabels) {
      const c = counts.get(key(s, lbl)) ?? 0;
      const yv = normalize ? c / (total || 1) : c;
      if (yv <= 0) continue;
      rows.push({ theta0: t0, theta1: t1, r0: acc, r1: acc + yv, label: lbl, sector: s });
      acc += yv;
    }
  }

  const rPx = d3
    .scaleLinear()
    .domain([0, rMaxRose])
    .range([0, Math.max(0, radius - innerHole)]);

  const g = svg
    .append('g')
    .attr('class', 'wind-rose-inset')
    .attr('role', 'group')
    .attr('aria-label', title)
    .attr('transform', `translate(${x},${y})`);

  g.append('g')
    .attr('class', 'rings')
    .selectAll('circle')
    .data(ticks)
    .join('circle')
    .attr('cx', 0)
    .attr('cy', 0)
    .attr('r', d => innerHole + rPx(d)) // offset
    .attr('fill', 'none')
    .attr('stroke', '#ccc')
    .attr('stroke-opacity', 0.15)
    .attr('stroke-width', 1);

  // Cardinal labels
  const outerR = innerHole + rPx(rMaxRose);
  const diagR = (outerR * 0.3) / Math.SQRT2; // shorter diagonals
  g.append('g')
    .attr('class', 'cardinal-cross')
    .selectAll('line')
    .data([
      { x1: -outerR, y1: 0, x2: outerR, y2: 0 }, // East–West
      { x1: 0, y1: -outerR, x2: 0, y2: outerR }, // North–South
      // Diagonals (NE–SW, NW–SE)
      { x1: -diagR, y1: -diagR, x2: diagR, y2: diagR },
      { x1: -diagR, y1: diagR, x2: diagR, y2: -diagR },
    ])
    .join('line')
    .attr('x1', d => d.x1)
    .attr('y1', d => d.y1)
    .attr('x2', d => d.x2)
    .attr('y2', d => d.y2)
    .attr('stroke', '#ccc')
    .attr('stroke-opacity', 0.2)
    .attr('stroke-width', 1)
    .attr('pointer-events', 'none');

  // Color scale for bins
  let color;
  let legendKind = 'ordinal';

  if (colors?.type === 'sequential') {
    legendKind = 'sequential';
    const dmin = colors.domain?.[0] ?? speedBreaks[0];
    const dmax = colors.domain?.[1] ?? last;
    const interp = colors.interpolator ?? d3.interpolateTurbo;
    const scale = d3.scaleSequential(interp).domain([dmin, dmax]);
    color = label => {
      const v = binCenters.get(label);
      return scale(v ?? dmin);
    };
  } else {
    // ordinal (default)
    const palette =
      colors?.scheme && Array.isArray(colors.scheme) ? colors.scheme : d3.schemeTableau10;
    const domain = speedLabels;
    const scale = d3.scaleOrdinal(
      domain,
      palette.length >= domain.length ? palette : d3.schemeTableau10
    );
    color = scale;
  }

  const arc = d3
    .arc()
    .innerRadius(d => innerHole + rPx(d.r0))
    .outerRadius(d => innerHole + rPx(d.r1))
    .startAngle(d => d.theta0)
    .endAngle(d => d.theta1);

  g.append('g')
    .attr('class', 'sectors')
    .selectAll('path')
    .data(rows)
    .join('path')
    .attr('d', arc)
    .attr('fill', d => color(d.label))
    .attr('stroke', 'white')
    .attr('stroke-width', 0.5);

  const toDeg = rad => (rad * 180) / Math.PI;
  const normDeg = d => ((d % 360) + 360) % 360;

  // 16-wind compass by default; pass nDirections to match your rose
  function compassLabel(deg, n = 16) {
    const names16 = [
      'N',
      'NNE',
      'NE',
      'ENE',
      'E',
      'ESE',
      'SE',
      'SSE',
      'S',
      'SSW',
      'SW',
      'WSW',
      'W',
      'WNW',
      'NW',
      'NNW',
    ];
    const names8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const names4 = ['N', 'E', 'S', 'W'];
    const table = n === 16 ? names16 : n === 8 ? names8 : names4;
    const step = 360 / table.length;
    const idx = Math.round(normDeg(deg) / step) % table.length;
    return table[idx];
  }

  function makeLegend(
    selection,
    labels,
    { position = 'right', padFromRose = 14, maxWidth = 140 } = {}
  ) {
    selection.select('.legend').remove();

    const outerR = innerHole + rPx(rMaxRose);
    let lx = outerR + padFromRose,
      ly = -outerR;

    const legend = selection
      .append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${lx},${ly})`);

    legend
      .append('text')
      .attr('x', 0)
      .attr('y', 2)
      .attr('font-size', fontSize)
      .attr('font-weight', 'bold')
      .attr('fill', 'currentColor')
      .text(title);

    if (legendKind === 'sequential') {
      const width = 140,
        height = 10;
      const id = `legend-gradient-${Math.random().toString(36).slice(2)}`;

      const gradient = legend
        .append('defs')
        .append('linearGradient')
        .attr('id', id)
        .attr('x1', '0%')
        .attr('x2', '100%')
        .attr('y1', '0%')
        .attr('y2', '0%');
      const stops = d3.range(0, 1.0001, 1 / 11);
      stops.forEach(t => {
        gradient
          .append('stop')
          .attr('offset', `${t * 100}%`)
          .attr('stop-color', (colors.interpolator ?? d3.interpolateTurbo)(t));
      });

      legend
        .append('rect')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', `url(#${id})`)
        .attr('stroke', '#999');

      // Axis with min/max tick labels
      const dmin = colors.domain?.[0] ?? speedBreaks[0];
      const dmax = colors.domain?.[1] ?? last;
      const scale = d3.scaleLinear().domain([dmin, dmax]).range([0, width]);
      const axis = d3.axisBottom(scale).ticks(4).tickSize(3);

      legend
        .append('g')
        .attr('transform', `translate(0,${height})`)
        .call(axis)
        .selectAll('text')
        .attr('font-size', fontSize);

      legend
        .append('text')
        .attr('x', 0)
        .attr('y', -4)
        .attr('font-size', fontSize)
        .attr('stroke', '#ccc')
        .attr('fill', 'white')
        .text('Wind Speed (knots)');
    } else {
      const sw = 10,
        sh = 10,
        gap = 4,
        rowGap = 4;
      labels.forEach((lab, i) => {
        const g = legend
          .append('g')
          .attr('transform', `translate(0, ${fontSize * 0.9 + i * (Math.max(sh, fontSize) + rowGap)})`);
        g.append('rect')
          .attr('width', sw)
          .attr('height', sh)
          .attr('fill', color(lab))
          .attr('stroke', '#999');
        g.append('text')
          .attr('x', sw + gap)
          .attr('y', sh - 1)
          .attr('stroke', '#ccc')
          .attr('fill', 'white')
          .attr('font-size', fontSize)
          .text(lab);
      });
    }

    return { node: legend.node() };
  }

  g.style('pointer-events', 'all'); // allow events
  g.raise(); // put the inset above tiles/other layers

  const labelsForLegend = speedLabels.filter(lab => rows.some(r => r.label === lab));
  makeLegend(g, labelsForLegend, { position: 'right', padFromRose: 14 });
  const arcSel = g
    .append('g')
    .attr('class', 'sectors')
    .selectAll('path')
    .data(rows)
    .join('path')
    .attr('d', arc)
    .attr('fill', d => color(d.label))
    .attr('stroke', 'white')
    .attr('stroke-width', 0.5)
    .style('pointer-events', 'visiblePainted');

  const tooltip = d3
    .select('body')
    .append('div')
    .attr('class', 'windrose-tooltip')
    .style('position', 'absolute')
    .style('background', 'rgba(0,0,0,0.85)')
    .style('color', '#fff')
    .style('padding', '4px 8px')
    .style('border-radius', '4px')
    .style('font-size', '11px')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .style('z-index', 1000);

  const totalShare = d3.sum(rows, r => r.r1 - r.r0) || 1;

  arcSel
    .on('pointerenter', function (event, d) {
      const share = ((d.r1 - d.r0) / totalShare) * 100;

      const midDeg = normDeg(toDeg((d.theta0 + d.theta1) / 2));
      const dirTxt = compassLabel(midDeg, nDirections);

      tooltip
        .style('opacity', 1)
        .html(
          `<b>${d.label}</b><br>` +
            `${share.toFixed(1)}% of total<br>` +
            `Direction: ${dirTxt} (${midDeg.toFixed(0)}°)`
        );

      d3.select(this).attr('stroke', '#000').attr('stroke-width', 1.5);
    })
    .on('pointermove', function (event) {
      tooltip.style('left', event.pageX + 10 + 'px').style('top', event.pageY - 18 + 'px');
    })
    .on('pointerleave', function () {
      tooltip.style('opacity', 0);
      d3.select(this).attr('stroke', 'white').attr('stroke-width', 0.5);
    });
  function update({ x: nx = x, y: ny = y, radius: nr = radius } = {}) {
    let resized = false;
    if (nr !== radius) {
      radius = nr;
      rPx.range([0, Math.max(0, radius - innerHole)]);
      resized = true;
    }
    if (resized) {
      g.selectAll('.rings circle').attr('r', d => innerHole + rPx(d));
      const outerR = innerHole + rPx(rMaxRose);
      g.select('.cardinal-cross')
        .selectAll('line') // if you compute from outerR
        .attr('x1', d => /* recompute if needed */ d.x1)
        .attr('y1', d => /* ... */ d.y1)
        .attr('x2', d => /* ... */ d.x2)
        .attr('y2', d => /* ... */ d.y2);
      arcSel.attr('d', arc); // <-- just recompute path geometry
      g.select('.legend')?.remove();
      makeLegend(g, speedLabels, { position: 'right', padFromRose: 14 });
    }
    if (nx !== x || ny !== y) {
      x = nx;
      y = ny;
      g.attr('transform', `translate(${x},${y})`);
    }
  }

  return { node: g.node(), update, colorScale: color };
}

export function createBuoySwellMarker(
  d3,
  svg,
  { lon, lat, summary, tooltipText },
  { minArrowLength = 15, maxArrowLength = 60, dotRadius = 6, color = '#0ea5e9', edgeMargin = 28 } = {}
) {
  if (!summary) return null; // || components.length === 0) return null;

  const allSwell = [summary.primary, ...summary.components];
  const maxHeight = summary.primary.height;
  const arrowLength = d3.scaleLinear().domain([0, maxHeight]).range([0, maxArrowLength]).clamp(true);

  const markerId = 'buoy-swell-arrowhead';
  if (svg.select(`#${markerId}`).empty()) {
    (svg.select('defs').empty() ? svg.append('defs') : svg.select('defs'))
      .append('marker')
      .attr('id', markerId)
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 8)
      .attr('refY', 5)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,0 L10,5 L0,10 z')
      .attr('fill', color);
  }

  const g = svg.append('g').attr('class', 'buoy-swell-marker');

  g.append('circle')
    .attr('r', dotRadius)
    .attr('fill', color)
    .attr('fill-opacity', 0.85)
    .attr('stroke', 'white')
    .attr('stroke-width', 1.5);

  g.selectAll('.buoy-swell-arrow')
    .data(allSwell)
    .join('line')
    .attr('class', 'buoy-swell-arrow')
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', d => Math.max(minArrowLength, arrowLength(d.height)) * Math.sin(((d.direction + 180) * Math.PI) / 180))
    .attr('y2', d => -Math.max(minArrowLength, arrowLength(d.height)) * Math.cos(((d.direction + 180) * Math.PI) / 180))
    .attr('stroke', color)
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round')
    .attr('opacity', 0.85)
    .attr('marker-end', `url(#${markerId})`);

  // Points outward when the buoy's real position is clamped to the edge of
  // frame (see update() below); hidden otherwise.
  const offscreenChevron = g
    .append('path')
    .attr('class', 'buoy-offscreen-chevron')
    .attr('d', 'M10,0 L-6,-7 L-2,0 L-6,7 Z')
    .attr('fill', color)
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0);

  g.raise();

  const tooltip = d3
    .select('body')
    .append('div')
    .attr('class', 'buoy-swell-tooltip')
    .style('position', 'absolute')
    .style('background', 'rgba(0,0,0,0.85)')
    .style('color', '#fff')
    .style('padding', '6px 10px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('white-space', 'pre-line')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .style('z-index', 1000);

  let isOffscreen = false;

  g.style('cursor', 'pointer')
    .style('pointer-events', 'all')
    .on('pointerenter', () =>
      tooltip
        .style('opacity', 1)
        .text(isOffscreen ? `${tooltipText}\n(buoy is off-screen)` : tooltipText)
    )
    .on('pointermove', event =>
      tooltip.style('left', event.pageX + 10 + 'px').style('top', event.pageY - 18 + 'px')
    )
    .on('pointerleave', () => tooltip.style('opacity', 0));

  // Finds where the ray from the viewport center through (px, py) crosses
  // the inset [margin, dim - margin] box, so an off-screen buoy gets pulled
  // to the edge of frame along the direction it actually lies in, rather
  // than just disappearing.
  function clampToRect(cx, cy, px, py, width, height, margin) {
    const dx = px - cx;
    const dy = py - cy;
    if (dx === 0 && dy === 0) return [cx, cy];
    let t = 1;
    if (dx > 0) t = Math.min(t, (width - margin - cx) / dx);
    if (dx < 0) t = Math.min(t, (margin - cx) / dx);
    if (dy > 0) t = Math.min(t, (height - margin - cy) / dy);
    if (dy < 0) t = Math.min(t, (margin - cy) / dy);
    t = Math.max(0, t);
    return [cx + dx * t, cy + dy * t];
  }

  function update({ transform, width, height }) {
    const projection = d3
      .geoMercator()
      .scale(transform.k / (2 * Math.PI))
      .translate([transform.x, transform.y]);
    const p = projection([lon, lat]);
    if (!p) return;
    const [px, py] = p;

    isOffscreen =
      width != null &&
      height != null &&
      (px < edgeMargin || px > width - edgeMargin || py < edgeMargin || py > height - edgeMargin);

    if (!isOffscreen) {
      g.attr('transform', `translate(${px},${py})`);
      offscreenChevron.attr('opacity', 0);
      return;
    }

    const [cx, cy] = [width / 2, height / 2];
    const [ex, ey] = clampToRect(cx, cy, px, py, width, height, edgeMargin);
    g.attr('transform', `translate(${ex},${ey})`);
    offscreenChevron
      .attr('opacity', 0.9)
      .attr('transform', `rotate(${(Math.atan2(py - ey, px - ex) * 180) / Math.PI})`);
  }

  return {
    node: g.node(),
    update,
    remove: () => {
      tooltip.remove();
      g.remove();
    },
  };
}
