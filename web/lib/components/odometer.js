// Computes lifetime-odometer milestone crossings (e.g. every 1km) from run
// summary data. Since we only have each run's starting odometer reading and
// total distance (not the full GPS track on this page), the crossing time is
// linearly interpolated across the run's duration by distance -- i.e. it
// assumes a roughly constant pace over the run. That's a good enough
// approximation for "when did I cross X km lifetime" purposes.
export function computeOdometerCrossings(runs, stepKm) {
  const crossings = [];
  for (const run of runs) {
    if (!(run.distance_km > 0)) continue;
    const start = run.odometer_km;
    const end = start + run.distance_km;
    const firstMultiple = Math.floor(start / stepKm) + 1;
    for (let m = firstMultiple; m * stepKm <= end; m++) {
      const milestone_km = m * stepKm;
      const fraction = (milestone_km - start) / run.distance_km;
      const ts = new Date(run.ts.getTime() + fraction * run.duration_sec * 1000);
      crossings.push({
        milestone_km,
        ts,
        linked_ts: { date: ts, id: run.id },
        into_run_km: { into: milestone_km - start, total: run.distance_km },
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
