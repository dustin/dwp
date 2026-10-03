// Direction-aware wave partitioning from a single raw spectral reading
// (swell_spectrum rows for one ts: freq, energy, direction, r1).
//
// swell_partition's components come from fixed period bands (see
// db/swell/update.sql), which can't tell two systems apart when they share a
// band: a NNW 11s groundswell and a NE 8-9s trade swell both land in the
// 8-12s band, and the energy-weighted mean of 345° and 50° comes out as a
// "N" swell that isn't actually there. Here the partitions are found from
// the spectrum's own shape instead -- a 1-D watershed over frequency (each
// bin belongs to the energy peak it climbs to), where a climb also stops at
// a sharp change in direction, so two systems sitting side by side in
// frequency stay separate even without an energy valley between them.
//
// Limitation: NDBC only publishes one mean direction (alpha1) per frequency
// bin, so two systems at the *same* period from different directions are
// already blended in the source data and can't be pulled apart here.
//
// No npm: imports, so this module also runs under plain Node for testing.

const RHO = 1025;
const G = 9.80665;
const M_TO_FT = 3.2808399;

// A climb between neighboring bins whose directions differ by more than
// this is treated as a boundary between wave systems.
const DIRECTION_SPLIT_DEG = 40;
// Adjacent partitions are merged back together when their directions are
// this close and the valley between them is shallow (relative to the
// smaller peak), i.e. they're one ragged system rather than two.
const MERGE_DIRECTION_DEG = 25;
const MERGE_VALLEY_RATIO = 0.75;
// Below this period, same-direction bumps are all local wind sea/chop and
// are merged regardless of valleys; listing each wiggle as its own "swell"
// is noise.
const WIND_SEA_FREQ = 1 / 6;
// Partitions holding less than this share of the reading's total energy
// are folded into their most similar neighbor rather than listed.
const MIN_SHARE = 0.04;

export function angleDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

// Energy-weighted circular mean, in degrees [0, 360).
function circularMean(bins, weight) {
  let s = 0;
  let c = 0;
  for (const b of bins) {
    const w = weight(b);
    const t = (b.direction * Math.PI) / 180;
    s += w * Math.sin(t);
    c += w * Math.cos(t);
  }
  return (((Math.atan2(s, c) * 180) / Math.PI) % 360 + 360) % 360;
}

// Adds lo/hi bin edges (midpoints between neighboring frequencies) and the
// resulting bandwidth df to each bin, sorted by frequency. NDBC bins aren't
// evenly spaced, so the edges matter for both integration and drawing.
export function withBinEdges(rows) {
  const sorted = rows.slice().sort((a, b) => a.freq - b.freq);
  return sorted.map((d, i) => {
    const prev = sorted[i - 1]?.freq;
    const next = sorted[i + 1]?.freq;
    const lo = prev == null ? d.freq - (next - d.freq) / 2 : (prev + d.freq) / 2;
    const hi = next == null ? d.freq + (d.freq - prev) / 2 : (d.freq + next) / 2;
    return { ...d, lo, hi, df: hi - lo };
  });
}

function usable(b) {
  // NDBC uses 999 for a missing direction; zero-energy bins carry noise
  // directions that would otherwise steer the watershed.
  return b.energy > 0 && b.direction >= 0 && b.direction <= 360;
}

function summarize(bins) {
  const m0 = bins.reduce((s, b) => s + b.energy * b.df, 0);
  const peak = bins.reduce((p, b) => (b.energy > p.energy ? b : p), bins[0]);
  return {
    bins,
    m0,
    peakEnergy: peak.energy,
    peakFreq: peak.freq,
    direction: circularMean(bins, b => b.energy * b.df),
    r1: m0 > 0 ? bins.reduce((s, b) => s + b.energy * b.df * (b.r1 ?? 0), 0) / m0 : 0,
  };
}

function merge(a, b) {
  return summarize([...a.bins, ...b.bins].sort((x, y) => x.freq - y.freq));
}

// Lowest energy between two frequency-adjacent partitions.
function valleyBetween(a, b) {
  const lastA = a.bins[a.bins.length - 1];
  const firstB = b.bins[0];
  return Math.min(lastA.energy, firstB.energy);
}

// Returns partitions for one reading, largest first, each shaped like a
// swell_partition component row (rank 2+, height in feet, energy kJ/m²),
// plus peak/low/high frequency for charting.
export function partitionReading(rows, { ts = rows[0]?.ts } = {}) {
  const bins = withBinEdges(rows).filter(usable);
  if (bins.length === 0) return [];

  // Watershed: each bin climbs to its higher neighbor until it reaches a
  // local maximum -- but won't step across a sharp direction change.
  const n = bins.length;
  const contiguous = i => i + 1 < n && Math.abs(bins[i + 1].lo - bins[i].hi) < 1e-9;
  const climbTarget = i => {
    let best = i;
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= n) continue;
      if (!contiguous(Math.min(i, j))) continue;
      if (angleDiff(bins[i].direction, bins[j].direction) > DIRECTION_SPLIT_DEG) continue;
      if (bins[j].energy > bins[best].energy) best = j;
    }
    return best;
  };
  const peakOf = bins.map((_, i) => {
    let j = i;
    for (let step = 0; step < n; step++) {
      const k = climbTarget(j);
      if (k === j) break;
      j = k;
    }
    return j;
  });

  // Group into contiguous runs sharing a peak (a watershed basin can't be
  // split by another basin in 1-D, but guard anyway).
  let parts = [];
  for (let i = 0; i < n; i++) {
    const last = parts[parts.length - 1];
    if (last && last.peak === peakOf[i] && contiguous(i - 1)) last.bins.push(bins[i]);
    else parts.push({ peak: peakOf[i], bins: [bins[i]] });
  }
  parts = parts.map(p => summarize(p.bins));

  // Merge ragged neighbors that are clearly the same system.
  let merged = true;
  while (merged && parts.length > 1) {
    merged = false;
    for (let i = 0; i + 1 < parts.length; i++) {
      const a = parts[i];
      const b = parts[i + 1];
      if (
        angleDiff(a.direction, b.direction) <= MERGE_DIRECTION_DEG &&
        (valleyBetween(a, b) >= MERGE_VALLEY_RATIO * Math.min(a.peakEnergy, b.peakEnergy) ||
          Math.min(a.peakFreq, b.peakFreq) >= WIND_SEA_FREQ)
      ) {
        parts.splice(i, 2, merge(a, b));
        merged = true;
        break;
      }
    }
  }

  // Fold slivers into whichever neighbor points the most similar way.
  const total = parts.reduce((s, p) => s + p.m0, 0);
  for (;;) {
    if (parts.length <= 1) break;
    let smallest = -1;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].m0 < MIN_SHARE * total && (smallest < 0 || parts[i].m0 < parts[smallest].m0)) smallest = i;
    }
    if (smallest < 0) break;
    const p = parts[smallest];
    const neighbors = [smallest - 1, smallest + 1].filter(j => j >= 0 && j < parts.length);
    const into = neighbors.reduce((best, j) =>
      best == null || angleDiff(parts[j].direction, p.direction) < angleDiff(parts[best].direction, p.direction)
        ? j
        : best
    , null);
    const lo = Math.min(smallest, into);
    parts.splice(lo, 2, merge(parts[lo], parts[lo + 1]));
  }

  return parts
    .sort((a, b) => b.m0 - a.m0)
    .map((p, i) => ({
      ts,
      rank: i + 2,
      period: 1 / p.peakFreq,
      direction: p.direction,
      spread: p.r1,
      height: 4 * Math.sqrt(p.m0) * M_TO_FT,
      energy: (RHO * G * p.m0) / 1000,
      peakFreq: p.peakFreq,
      freqLo: p.bins[0].lo,
      freqHi: p.bins[p.bins.length - 1].hi,
      source: 'spectrum',
    }));
}

// Groups flat swell_spectrum rows by reading time.
export function groupReadings(rows) {
  const byTs = new Map();
  for (const d of rows) {
    const k = +d.ts;
    if (!byTs.has(k)) byTs.set(k, []);
    byTs.get(k).push(d);
  }
  return Array.from(byTs, ([k, bins]) => ({ ts: new Date(k), bins })).sort((a, b) => a.ts - b.ts);
}

// Spectral partitions for every reading in a window, in the same grouped
// {ts, values} shape fetchSwell/fetchSwellPartitionWindow return, so the
// partition charts can take either.
export function spectralPartitions(spectrumRows) {
  return groupReadings(spectrumRows).map(({ ts, bins }) => ({ ts, values: partitionReading(bins, { ts }) }));
}

// Similarity of two spectral readings in [0, 1]: one minus the normalized
// distance between their directional energy vectors (E·cosθ, E·sinθ)
// across frequency, so a match needs the same energy at the same periods
// coming from the same directions.
export function spectrumSimilarity(a, b) {
  const binsA = withBinEdges(a).filter(usable);
  const binsB = withBinEdges(b).filter(usable);
  const key = f => f.toFixed(4);
  const vec = bins =>
    new Map(
      bins.map(d => {
        const t = (d.direction * Math.PI) / 180;
        return [key(d.freq), { x: d.energy * d.df * Math.cos(t), y: d.energy * d.df * Math.sin(t), m: d.energy * d.df }];
      })
    );
  const va = vec(binsA);
  const vb = vec(binsB);
  let diff = 0;
  let total = 0;
  for (const k of new Set([...va.keys(), ...vb.keys()])) {
    const p = va.get(k) ?? { x: 0, y: 0, m: 0 };
    const q = vb.get(k) ?? { x: 0, y: 0, m: 0 };
    diff += Math.hypot(p.x - q.x, p.y - q.y);
    total += p.m + q.m;
  }
  return total > 0 ? 1 - diff / total : 0;
}
