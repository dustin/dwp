-- Enter a run by hand when there's no GPS track for it (the watch app failed
-- to capture or export it), from the workout summary.
--
-- Fill in the variables below and run it against the lake the way import.sh
-- runs import.sql:
--
--   cd ~/stuff/duck && duckdb --init init.sql < .../db/import-manual.sql
--
-- then ./upload-runs.sh to export and publish.
--
-- What you get is a dwlist row with no trackpoints: the run shows up in the
-- run list, odometer, wind stats and buoy comparisons like any other. The
-- run page draws an approximate route (an arc out to sea between the start
-- and end beaches) and leaves the stats that need a track blank: time and
-- distance on foil, first paddle up, best 1k, longest segment, furthest from
-- land, min foiling HR.
--
-- If the real track turns up later, import it with import.sql as usual: it
-- replaces this row (matched by time). Re-running this script with the same
-- times replaces an earlier hand-entered row too, but it refuses to touch a
-- run that has a track.

use lake;

begin;

call lake.set_commit_message('dustin', 'enter DW run by hand (no track)');

-- Max HR normally comes from the track, so dwlist has had nowhere to keep it.
ALTER TABLE dwlist ADD COLUMN IF NOT EXISTS max_hr DOUBLE;

SET VARIABLE tz = 'Pacific/Honolulu';

-- Give the offset (-10) so the times aren't read in the session's zone.
SET VARIABLE start_time = TIMESTAMPTZ '2026-10-04 14:05:00-10';
SET VARIABLE end_time   = TIMESTAMPTZ '2026-10-04 15:10:00-10';
SET VARIABLE distance_m = 15000;
SET VARIABLE max_speed_ms = 9.0;   -- meters per second, as the watch reports it
SET VARIABLE avg_hr = 140;         -- whole-run average
SET VARIABLE max_hr = 170;
SET VARIABLE paddle_ups = 3;
-- Beach names as in the beaches table (and the run list), e.g. 'Maliko',
-- 'Kahului Harbor', 'Sugar Cove'.
SET VARIABLE start_beach = 'Maliko';
SET VARIABLE end_beach = 'Kahului Harbor';
SET VARIABLE board = 'Kalama Gator  95.0 lt';
SET VARIABLE foil = 'F4 Orca 800';

-- Bail out on a beach name that doesn't match exactly one beach.
SELECT CASE
  WHEN (SELECT count(*) FROM beaches WHERE name = getvariable('start_beach')) <> 1
    THEN error('start_beach not found (or ambiguous): ' || getvariable('start_beach'))
  WHEN (SELECT count(*) FROM beaches WHERE name = getvariable('end_beach')) <> 1
    THEN error('end_beach not found (or ambiguous): ' || getvariable('end_beach'))
  WHEN getvariable('end_time') <= getvariable('start_time')
    THEN error('end_time must be after start_time')
END AS checks;

-- Never overwrite a run that has a real track.
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM dws
  GROUP BY dwid
  HAVING min(ts) - INTERVAL '5 minutes' <= getvariable('end_time')
     AND max(ts) + INTERVAL '5 minutes' >= getvariable('start_time')
) THEN error('a run with a GPS track already covers this time') END AS no_tracked_overlap;

-- Replace an earlier hand-entered version of this run.
DELETE FROM dwlist l
WHERE NOT EXISTS (SELECT 1 FROM dws WHERE dws.dwid = l.id)
  AND to_timestamp(l.ts) - INTERVAL '5 minutes' <= getvariable('end_time')
  AND to_timestamp(l.ts + l.duration_sec) + INTERVAL '5 minutes' >= getvariable('start_time');

INSERT INTO dwlist (
  id, ts, date, time, distance_km, duration_sec, avg_speed_kmh, max_speed_kmh,
  sport, board, foil, description, start_pos, end_pos,
  paddle_up_count, avg_foiling_hr, max_hr
)
SELECT
  gen_random_uuid(),
  epoch(getvariable('start_time')),
  (getvariable('start_time') AT TIME ZONE getvariable('tz'))::DATE,
  (getvariable('start_time') AT TIME ZONE getvariable('tz'))::TIME,
  getvariable('distance_m') / 1000,
  epoch(getvariable('end_time')) - epoch(getvariable('start_time')),
  (getvariable('distance_m') / 1000)
    / ((epoch(getvariable('end_time')) - epoch(getvariable('start_time'))) / 3600),
  getvariable('max_speed_ms') * 3.6,
  'Downwind',
  getvariable('board'),
  getvariable('foil'),
  'Entered by hand, no GPS track.',
  (SELECT id FROM beaches WHERE name = getvariable('start_beach')),
  (SELECT id FROM beaches WHERE name = getvariable('end_beach')),
  getvariable('paddle_ups'),
  -- Normally the average while foiling; the whole-run average is the closest
  -- there is without a track (a little low, since it includes paddling).
  getvariable('avg_hr'),
  getvariable('max_hr');

SELECT date, time, round(distance_km, 2) AS km, duration_sec,
       round(avg_speed_kmh, 1) AS avg_kmh, round(max_speed_kmh, 1) AS max_kmh,
       paddle_up_count, start_beach, end_beach
FROM dwlist_resolved
WHERE ts = epoch(getvariable('start_time'));

commit;
