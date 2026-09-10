export const FOIL_THRESHOLD_KPH = 11;

export function createColorizer(data, baseHue) {
  const speeds = data.map(d => d.speed).filter(s => s != null);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);

  return speed => {
    if (speed == null) return `hsl(${baseHue}, 70%, 50%)`;
    if (speed < FOIL_THRESHOLD_KPH) return `hsl(${baseHue}, 40%, 30%)`;

    // Normalize speed to 0-1 range
    const normalized = speeds.length > 1 ? (speed - minSpeed) / (maxSpeed - minSpeed) : 0.5;

    const lightness = 30 + normalized * 40; // Range: 30% to 70%
    const saturation = 70 + normalized * 20; // Range: 70% to 90%

    return `hsl(${baseHue}, ${saturation}%, ${lightness}%)`;
  };
}

export function compareColorizers(runCsv1, runCsv2) {
  return [createColorizer(runCsv1, 140), createColorizer(runCsv2, 30)];
}
