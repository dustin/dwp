// Records and milestones: every run that beat or matched the previous best
// in some category. Shared by the achievements page and the index card.
import * as d3 from "npm:d3";
import * as fmt from "./formatters.js";

const km = m => `${(m / 1000).toFixed(2)} km`;
const kph = v => `${v.toFixed(1)} kph`;
const bpm = v => `${Math.round(v)} bpm`;

// Each category: how to read it off a run, how to show it, and a score
// (higher wins) at the precision shown, so a record has to beat the old
// one by enough to see, and a tie counts as matching it.
// Runs shorter than this can't set the lightest-wind record, which a short
// paddle would otherwise win.
const fullRun = d => d.distance_km >= 10;
const days = v => `${v} day${v === 1 ? "" : "s"}`;
const milestones = [100, 250, 500, ...d3.range(1000, 100001, 500)];

export const categories = [
  {key: "seg_dist", label: "Longest foil (distance)", color: "#4269d0",
   value: d => d.longest_segment_distance, score: v => Math.round(v / 10), fmt: km},
  {key: "seg_time", label: "Longest foil (time)", color: "#6cc5b0",
   value: d => (d.longest_segment_end - d.longest_segment_start) / 1000, score: v => Math.round(v), fmt: fmt.seconds},
  {key: "foil_dist", label: "Most foiling in a run", color: "#3ca951",
   value: d => d.distance_on_foil, score: v => Math.round(v / 10), fmt: km},
  {key: "avg_hr", label: "Lowest avg foiling HR", color: "#ff725c",
   value: d => d.avg_foiling_hr, score: v => -Math.round(v), fmt: bpm},
  {key: "min_hr", label: "Lowest min foiling HR", color: "#ff8ab7",
   value: d => d.min_foiling_hr, score: v => -Math.round(v), fmt: bpm},
  {key: "max_speed", label: "Top speed", color: "#efb118",
   value: d => d.max_speed_kmh, score: v => Math.round(v * 10), fmt: kph},
  {key: "best_1k", label: "Best 1 km", color: "#a463f2",
   value: d => d.max_speed_1k, score: v => -Math.floor(3600 / v + 1e-9), fmt: fmt.paceNoUnit},
  {key: "foil_speed", label: "Best avg foiling speed", color: "#97bbf5",
   value: d => d.duration_on_foil > 0 ? 3.6 * d.distance_on_foil / d.duration_on_foil : null,
   score: v => Math.round(v * 10), fmt: kph},
  // Mostly on foil, so a day that never got going doesn't count.
  {key: "light_wind", label: "Lightest wind foiled", color: "#9498a0",
   eligible: d => fullRun(d) && d.pct_dist_on_foil >= 0.8,
   value: d => d.avg_wavg, score: v => -Math.round(v), fmt: v => `${Math.round(v)} kn`},
  // Dry as the rest of the dashboard defines it (data.js isDry).
  {key: "dry", label: "Longest dry run", color: "#e45756",
   value: d => d.dry ? d.distance_km * 1000 : null, score: v => Math.round(v / 10), fmt: km},
  // Tracked per region: open-ocean runs would otherwise swamp the rest.
  {key: "max_dist", label: "Furthest from land", color: "#9c6b4e", group: d => d.region,
   value: d => d.max_distance, score: v => Math.round(v / 10), fmt: km},
  // Consecutive days with at least one dry run (other runs that day don't
  // break it). The day's first dry run is the one that extends the streak.
  // Consecutive days with at least one run.
  {key: "streak", label: "Downwind streak", color: "#17becf", ties: false,
   value: (d, ctx) => ctx.streak.get(d), score: v => v, fmt: days},
  {key: "dry_streak", label: "Dry run streak", color: "#b07aa1", ties: false,
   value: (d, ctx) => ctx.dryStreak.get(d), score: v => v, fmt: days},
  // Not a best, a milestone: the run that carried the odometer past it.
  {key: "odometer", label: "Total distance", color: "#6b6ecf", ties: false,
   value: d => d3.max(milestones.filter(m => m <= d.odometer_km + d.distance_km)),
   score: v => v, fmt: v => `${d3.format(",")(v)} km`},
];

// Walk runs in time order, tracking the best so far in each category.
// Newest first. Each record links to the record it beat or matched
// (prevRecord) and, once beaten, the record that beat it (beatenBy).
export function computeAchievements(allRuns) {
  const ctx = {streak: streaks(allRuns), dryStreak: streaks(allRuns.filter(d => d.dry))};
  const best = new Map();
  const out = [];
  for (const run of d3.sort(allRuns.filter(d => d.has_track), d => d.ts)) {
    const records = [];
    for (const c of categories) {
      if (c.eligible && !c.eligible(run)) continue;
      const v = c.value(run, ctx);
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      const group = c.group?.(run);
      const k = group == null ? c.key : `${c.key}:${group}`;
      const prevRecord = best.get(k);
      const prev = prevRecord?.value;
      const delta = prev == null ? 1 : c.score(v) - c.score(prev);
      if (delta > 0 || (delta === 0 && c.ties !== false)) {
        const r = {category: c, group, value: v, prev, matched: delta === 0, run, prevRecord};
        records.push(r);
        if (delta > 0) {
          if (prevRecord) prevRecord.beatenBy = r;
          best.set(k, r);
        }
      }
    }
    if (records.length) out.push({run, records});
  }
  return out.reverse();
}

// The streak of consecutive days with a run (in days) as of each day's
// first run.
function streaks(runs) {
  const streaks = new Map();
  let lastDay = null, streak = 0;
  for (const run of d3.sort(runs, d => d.ts)) {
    const day = d3.timeDay(run.ts);
    if (+day === +lastDay) continue;
    streak = lastDay && +d3.timeDay.offset(lastDay, 1) === +day ? streak + 1 : 1;
    lastDay = day;
    streaks.set(run, streak);
  }
  return streaks;
}
