-- One-time backfill: recompute every run's top speed (dwlist.max_speed_kmh)
-- from run_top_speed, which skips lone spikes and excluded points. Run it
-- after adding speed_exclusions and run_top_speed from schema.sql:
--
--   cd ~/stuff/duck && duckdb --init init.sql < .../db/migrate-top-speed.sql
--
-- Safe to re-run. Runs entered by hand have no trackpoints and keep theirs.

use lake;

begin;

call lake.set_commit_message('dustin', 'top speeds without lone spikes');

SELECT l.rider, l.date, l.id, round(l.max_speed_kmh, 1) AS was,
       round(t.max_speed_kmh, 1) AS now
FROM dwlist l JOIN run_top_speed t ON t.dwid = l.id
WHERE l.max_speed_kmh IS DISTINCT FROM t.max_speed_kmh
ORDER BY l.max_speed_kmh - t.max_speed_kmh DESC;

UPDATE dwlist AS l
SET    max_speed_kmh = t.max_speed_kmh
FROM   run_top_speed t
WHERE  l.id = t.dwid AND l.max_speed_kmh IS DISTINCT FROM t.max_speed_kmh;

commit;
