-- One-time backfill: recompute every run's foiling heart rate
-- (dwlist.min_foiling_hr, avg_foiling_hr) from run_foiling_hr, which skips
-- readings the watch held through a paddle-up. Run it after adding
-- run_foiling_hr from schema.sql:
--
--   cd ~/stuff/duck && duckdb --init init.sql < .../db/migrate-foiling-hr.sql
--
-- Safe to re-run. Runs entered by hand have no trackpoints and keep theirs.

use lake;

begin;

call lake.set_commit_message('dustin', 'foiling heart rates without stale readings');

SELECT l.rider, l.date, l.id, l.min_foiling_hr AS was, h.min_hr AS now,
       round(l.avg_foiling_hr, 1) AS avg_was, round(h.avg_hr, 1) AS avg_now
FROM dwlist l JOIN run_foiling_hr h ON h.dwid = l.id
WHERE l.min_foiling_hr IS DISTINCT FROM h.min_hr
ORDER BY h.min_hr - l.min_foiling_hr DESC;

UPDATE dwlist AS l
SET    min_foiling_hr = h.min_hr,
       avg_foiling_hr = h.avg_hr
FROM   run_foiling_hr h
WHERE  l.id = h.dwid
  AND  (l.min_foiling_hr IS DISTINCT FROM h.min_hr
        OR l.avg_foiling_hr IS DISTINCT FROM h.avg_hr);

commit;
