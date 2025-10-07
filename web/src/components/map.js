import * as d3 from 'npm:d3';
import * as d3h from 'npm:d3-hexbin';
import * as d3t from 'npm:d3-tile';
import * as fmt from './formatters.js';
import _ from 'npm:lodash';

function tileURL(x, y, z) {
  const token =
    'pk.eyJ1IjoiZGxzc3B5IiwiYSI6ImNtZzF2OG42cTBza3kybnB5YXd5OHY1ZWwifQ.EeGGfhgFW9amBAeiOEvbYw';
  // return `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/${z}/${x}/${y}${devicePixelRatio > 1 ? "@2x" : ""}?access_token=${token}`
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/${z}/${x}/${y}${devicePixelRatio > 1 ? '@2x' : ''}?access_token=${token}`;
}

export function renderCrashes(width, data) {
  const height = width * 0.5;
  const svg = d3.create('svg').attr('viewBox', [0, 0, width, height]);
  const projection = d3
    .geoMercator()
    .scale(1 / (2 * Math.PI))
    .translate([0, 0]);
  const tile = d3t
    .tile()
    .extent([
      [0, 0],
      [width, height],
    ])
    .tileSize(512);
  const zoom = d3
    .zoom()
    .scaleExtent([1 << 10, 1 << 24])
    .extent([
      [0, 0],
      [width, height],
    ])
    .on('zoom', ({ transform }) => zoomed(transform));
  let image = svg.append('g').attr('pointer-events', 'none').selectAll('image');

  const crashG = svg.append('g').attr('pointer-events', 'none');

  const hexbin = d3h.hexbin().radius(20);

  const colorScale = d3.scaleSequential(d3.interpolateYlOrRd);

  let hexagons = crashG.selectAll('.hexagon');

  svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(-1));

  const fc = {
    type: 'FeatureCollection',
    features: data.map(d => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+d.lon, +d.lat] },
    })),
  };

  const proj0 = d3.geoMercator();
  const pad = 24;
  proj0.fitExtent(
    [
      [pad, pad],
      [width - pad, height - pad],
    ],
    fc
  );
  const k = proj0.scale() * 2 * Math.PI;
  const [tx, ty] = proj0.translate();
  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));

  function zoomed(transform) {
    const tiles = tile(transform);
    image = image
      .data(tiles, d => d)
      .join('image')
      .attr('xlink:href', d => tileURL(...d))
      .attr('x', ([x]) => (x + tiles.translate[0]) * tiles.scale)
      .attr('y', ([, y]) => (y + tiles.translate[1]) * tiles.scale)
      .attr('width', tiles.scale)
      .attr('height', tiles.scale);

    projection.scale(transform.k / (2 * Math.PI)).translate([transform.x, transform.y]);

    const zoomLevel = Math.log2(transform.k);
    const scaledRadius = Math.max(5, 20 * Math.pow(0.8, zoomLevel - 12));

    hexbin.radius(scaledRadius).extent([
      [0, 0],
      [width, height],
    ]);

    const projectedData = data
      .map(d => {
        const p = projection([+d.lon, +d.lat]);
        return p && p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height
          ? [p[0], p[1], d]
          : null;
      })
      .filter(d => d !== null);

    if (projectedData.length > 0) {
      const hexbins = hexbin(projectedData);

      const maxDensity = d3.max(hexbins, d => d.length) || 1;
      colorScale.domain([0, maxDensity]);

      hexagons = hexagons
        .data(hexbins, d => `${Math.round(d.x)}-${Math.round(d.y)}`)
        .join(
          enter =>
            enter
              .append('path')
              .attr('class', 'hexagon')
              .attr('d', hexbin.hexagon())
              .attr('stroke', '#fff')
              .attr('stroke-width', 0.5)
              .attr('opacity', 0.8),
          update =>
            update
              .attr('d', hexbin.hexagon())
              .attr('transform', d => `translate(${d.x},${d.y})`)
              .attr('title', d => `Crash density: ${d.length}`)
              .attr('fill', d => colorScale(d.length)),
          exit => exit.attr('opacity', 0).remove()
        )
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .attr('fill', d => colorScale(d.length));
    } else {
      hexagons = hexagons.data([]).join(
        enter => enter,
        update => update,
        exit => exit.remove()
      );
    }
  }

  return svg.node();
}

function speedColor(speeds) {
  const maxSpeed = d3.max(speeds);

  const colorScale = d3
    .scaleQuantile()
    .domain(speeds.filter(s => s > 11))
    .range(['#ff0', '#cf0', '#9f0', '#6f0', '#3f0', '#0f0']);

  return function (speed) {
    return speed > 11 ? colorScale(speed) : '#900';
  };
}

export function findCallouts(runMeta, data) {
  const calloutSpots = {
    minHr: data.find(d => d.speed > 11 && d.hr === runMeta.min_foiling_hr),
    maxSpeed: _.maxBy(data, d => d.speed),
    maxDist: _.maxBy(data, d => d.distance_to_land),
  };
  const callouts = [
    {
      lat: calloutSpots.maxSpeed.lat,
      lon: calloutSpots.maxSpeed.lon,
      icon: '🚀',
      text: `Top speed of ${calloutSpots.maxSpeed.speed.toFixed(2)} kph`,
    },
    {
      lat: calloutSpots.maxDist.lat,
      lon: calloutSpots.maxDist.lon,
      icon: '🗺️',
      text: `Maximum distance from land of ${(calloutSpots.maxDist.distance_to_land / 1000).toFixed(2)} km`,
    },
  ];

  // Sometimes I didn't get on foil enough to have a min heart rate there.
  if (calloutSpots.minHr) {
    callouts.push({
      lat: calloutSpots.minHr.lat,
      lon: calloutSpots.minHr.lon,
      icon: '🫀',
      text: `Min foiling heart rate of ${runMeta.min_foiling_hr} bpm`,
    });
  }
  return callouts;
}

export function renderRun(width, datas, callouts = [], opts = {}) {
  const colorizers = opts.colorizers || datas.map(data => speedColor(data.map(d => d.speed)));
  const height = width * 0.5;
  const svg = d3.create('svg').attr('viewBox', [0, 0, width, height]);

  // Add defs for arrowhead marker
  const defs = svg.append('defs');
  defs
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

  const projection = d3
    .geoMercator()
    .scale(1 / (2 * Math.PI))
    .translate([0, 0]);
  const tile = d3t
    .tile()
    .extent([
      [0, 0],
      [width, height],
    ])
    .tileSize(512);
  const zoom = d3
    .zoom()
    .scaleExtent([1 << 10, 1 << 24])
    .extent([
      [0, 0],
      [width, height],
    ])
    .on('zoom', ({ transform }) => zoomed(transform));
  let image = svg.append('g').attr('pointer-events', 'none').selectAll('image');
  const runG = svg.append('g');
  let dots = runG.selectAll('.run-dot');

  // Add callout groups
  const calloutsG = svg.append('g').attr('class', 'callouts');
  let calloutGroups = calloutsG.selectAll('.callout-group');

  let additional;
  if (typeof opts.additionalMarks === 'function') {
    additional = opts.additionalMarks({ d3, svg, width, height });
  }

  svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(-1));
  const fc = {
    type: 'FeatureCollection',
    features: datas.flatMap(data =>
      data.map(d => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [+d.lon, +d.lat] },
      }))
    ),
  };

  const proj0 = d3.geoMercator();
  const pad = 24;
  proj0.fitExtent(
    [
      [pad, pad],
      [width - pad, height - pad],
    ],
    fc
  );
  const k = proj0.scale() * 2 * Math.PI;
  const [tx, ty] = proj0.translate();
  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));

  function zoomed(transform) {
    // Update tiles
    const tiles = tile(transform);
    image = image
      .data(tiles, d => d)
      .join('image')
      .attr('xlink:href', d => tileURL(...d))
      .attr('x', ([x]) => (x + tiles.translate[0]) * tiles.scale)
      .attr('y', ([, y]) => (y + tiles.translate[1]) * tiles.scale)
      .attr('width', tiles.scale)
      .attr('height', tiles.scale);

    // Update projection
    projection.scale(transform.k / (2 * Math.PI)).translate([transform.x, transform.y]);

    // Calculate dot radius based on zoom level
    const zoomLevel = Math.log2(transform.k);
    const dotRadius = Math.max(2, 4 * Math.pow(0.9, zoomLevel - 12));

    // Project data points
    const projectedData = datas
      .flatMap((data, i) =>
        data.map(d => {
          const p = projection([+d.lon, +d.lat]);
          return p && p[0] >= -50 && p[0] <= width + 50 && p[1] >= -50 && p[1] <= height + 50
            ? { x: p[0], y: p[1], data: d, dataset: i }
            : null;
        })
      )
      .filter(d => d !== null);

    // Render dots
    dots = dots
      .data(projectedData, d => `${d.data.lon}-${d.data.lat}`)
      .join(
        enter =>
          enter
            .append('circle')
            .attr('class', 'run-dot')
            .attr('fill', d => colorizers[d.dataset](d.data.speed))
            .attr('stroke', d => colorizers[d.dataset](d.data.speed))
            .attr('stroke-width', 0)
            .attr('opacity', 0.9)
            .style('cursor', 'pointer'),
        update => update,
        exit => exit.remove()
      )
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', dotRadius);

    // Add hover behavior to data points
    dots
      .on('mouseenter', function (event, d) {
        // Create tooltip
        const tooltip = d3
          .select('body')
          .append('div')
          .attr('class', 'data-point-tooltip')
          .style('position', 'absolute')
          .style('background', 'rgba(0, 0, 0, 0.9)')
          .style('color', 'white')
          .style('padding', '8px 12px')
          .style('border-radius', '4px')
          .style('font-size', '12px')
          .style('pointer-events', 'none')
          .style('z-index', '1000')
          .style('max-width', '200px');

        // Format tooltip content
        const content = [
          `Date: ${fmt.date(d.data.ts)}`,
          `Time: ${fmt.time(d.data.ts)}`,
          `Time so far: ${fmt.timeDiff(datas[d.dataset][0].ts, d.data.ts)}`,
          `Distance So Far: ${(d.data.distance / 1000).toFixed(2)} km`,
          `Speed: ${d.data.speed ? d.data.speed.toFixed(1) : 'N/A'} kph`,
          `Heart Rate: ${d.data.hr ? d.data.hr : 'unknown'} bpm`,
          `Nearest Land: ${d.data.distance_to_land ? (d.data.distance_to_land / 1000).toFixed(2) : 'unknown'} km`,
        ];

        tooltip.html(content.join('<br>'));

        // Position tooltip
        const rect = this.getBoundingClientRect();
        const tooltipNode = tooltip.node();
        const tooltipRect = tooltipNode.getBoundingClientRect();

        let left = rect.left + window.pageXOffset + rect.width / 2 - tooltipRect.width / 2;
        let top = rect.top + window.pageYOffset - tooltipRect.height - 10;

        // Keep tooltip on screen
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth - 10) {
          left = window.innerWidth - tooltipRect.width - 10;
        }
        if (top < 10) {
          top = rect.bottom + window.pageYOffset + 10; // Show below point instead
        }

        tooltip.style('left', left + 'px').style('top', top + 'px');

        // Highlight data point
        d3.select(this).attr('stroke-width', 2).attr('opacity', 1);

        // Draw line to nearest land if coordinates are available
        if (d.data.nearest_land_lat && d.data.nearest_land_lon) {
          const landPoint = projection([+d.data.nearest_land_lon, +d.data.nearest_land_lat]);

          if (
            landPoint &&
            landPoint[0] >= -100 &&
            landPoint[0] <= width + 100 &&
            landPoint[1] >= -100 &&
            landPoint[1] <= height + 100
          ) {
            // Add line to nearest land
            runG
              .append('line')
              .attr('class', 'nearest-land-line')
              .attr('x1', d.x)
              .attr('y1', d.y)
              .attr('x2', landPoint[0])
              .attr('y2', landPoint[1])
              .attr('stroke', '#ff6b6b')
              .attr('stroke-width', 2)
              .attr('stroke-dasharray', '5,5')
              .attr('opacity', 0.8)
              .style('pointer-events', 'none');

            // Add small circle at land point
            runG
              .append('circle')
              .attr('class', 'nearest-land-point')
              .attr('cx', landPoint[0])
              .attr('cy', landPoint[1])
              .attr('r', 4)
              .attr('fill', '#ff6b6b')
              .attr('stroke', 'white')
              .attr('stroke-width', 1)
              .attr('opacity', 0.9)
              .style('pointer-events', 'none');
          }
        }
      })
      .on('mouseleave', function () {
        // Remove tooltip
        d3.select('.data-point-tooltip').remove();

        // Remove nearest land line and point
        runG.selectAll('.nearest-land-line').remove();
        runG.selectAll('.nearest-land-point').remove();

        // Reset highlight
        d3.select(this).attr('stroke-width', 0).attr('opacity', 0.9);
      });

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
          const group = enter.append('g').attr('class', 'callout-group').style('cursor', 'pointer');

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

  return svg.node();
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
    title = 'Wind rose',
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
    { position = 'right', padFromRose = 14, maxWidth = 140, fontSize = 18 } = {}
  ) {
    selection.select('.legend').remove();

    const outerR = innerHole + rPx(rMaxRose);
    let lx = outerR + padFromRose,
      ly = -outerR;

    const legend = selection
      .append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${lx},${ly})`);

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
          .attr('transform', `translate(0, ${i * (Math.max(sh, fontSize) + rowGap)})`);
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

  const labelsForLegend = speedLabels;
  makeLegend(g, labelsForLegend, { position: 'right', padFromRose: 14 });
  // --- draw sectors once and keep a handle to the PATHS ---
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

  // --- one tooltip div for the page ---
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

      // Mid-direction of this sector; d3.arc uses 0 rad = North, clockwise
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
