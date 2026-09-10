import { createWindRoseInset } from './map.js';

export const WIND_ROSE_DEFAULTS = {
  radius: 130,
  innerHole: 40,
  nDirections: 36,
  speedBreaks: [0, 15, 20, 25, 30],
  normalize: false
};

export const WIND_SPEED_COLORS = [
  '#ef4444', // red - 0-15
  '#f97316', // orange - 15-20
  '#eab308', // yellow - 20-25
  '#22c55e', // green - 25-30
  '#3b82f6' // blue - 30+
];

export function windRoseOrigin(margin = 16, size = 130, offsetY = 0) {
  return { size, margin, centerX: margin + size, centerY: margin + size + offsetY };
}

export function addWindRose(d3, svg, wind, { x, y, title, scheme }) {
  return createWindRoseInset(d3, svg, wind, {
    ...WIND_ROSE_DEFAULTS,
    x,
    y,
    title,
    colors: { type: 'ordinal', scheme }
  });
}
