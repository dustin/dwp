// Computes lifetime-odometer milestone crossings (e.g. every 1km) from run
// summary data. Since we only have each run's starting odometer reading and
// total distance (not the full GPS track on this page), the crossing time is
// linearly interpolated across the run's duration by distance -- i.e. it
// assumes a roughly constant pace over the run. That's a good enough
// approximation for "when did I cross X km lifetime" purposes.
//
// With `onFoil`, it's the on-foil odometer instead (foil_km_before from
// fetchMeta plus the run's distance_on_foil), interpolated the same way.
export function computeOdometerCrossings(runs, stepKm, onFoil = false) {
  const crossings = [];
  for (const run of runs) {
    const dist = onFoil ? (run.distance_on_foil || 0) / 1000 : run.distance_km;
    if (!(dist > 0)) continue;
    const start = onFoil ? run.foil_km_before || 0 : run.odometer_km;
    const end = start + dist;
    const firstMultiple = Math.floor(start / stepKm) + 1;
    for (let m = firstMultiple; m * stepKm <= end; m++) {
      const milestone_km = m * stepKm;
      const fraction = (milestone_km - start) / dist;
      const ts = new Date(run.ts.getTime() + fraction * run.duration_sec * 1000);
      crossings.push({
        milestone_km,
        ts,
        linked_ts: { date: ts, id: run.id },
        into_run_km: { into: milestone_km - start, total: dist },
        region: run.region,
        start_beach: run.start_beach,
        end_beach: run.end_beach,
        foil: run.foil,
        id: run.id,
      });
    }
  }
  return crossings.sort((a, b) => a.milestone_km - b.milestone_km);
}
