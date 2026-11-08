-- One-time backfill: recount every run's paddle ups (dwlist.paddle_up_count,
-- distance_to_first_paddle_up) the way run-stats.sql now does, where an
-- island only counts with >= 30 s actually over 11 km/h, so a string of
-- failed attempts bridged into one island isn't a paddle up.
--
--   cd ~/stuff/duck && duckdb --init init.sql < .../db/migrate-paddle-ups.sql
--
-- It lists what it changes before changing it. Safe to re-run. Runs
-- entered by hand have no trackpoints and are left alone. Keep the island
-- rules in step with run-stats.sql.

use lake;

begin;

call lake.set_commit_message('dustin', 'paddle ups need 30 s on foil');

CREATE TEMP TABLE pu_islands AS
WITH flagged AS (
  SELECT dwid, ts, distance, (speed > 11) AS fast FROM run_points
),
changes AS (
  SELECT *, CASE WHEN LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) IS DISTINCT FROM fast
                 THEN 1 ELSE 0 END AS is_change
  FROM flagged
),
grouped AS (
  SELECT *, SUM(is_change) OVER (PARTITION BY dwid ORDER BY ts) AS grp FROM changes
),
raw AS (
  SELECT dwid, grp, fast, MIN(ts) AS start_ts, MAX(ts) AS end_ts,
         MIN(distance) AS start_distance,
         EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) AS duration_sec
  FROM grouped GROUP BY dwid, grp, fast
),
reclassified AS (
  SELECT *, (fast OR duration_sec < 15) AS effective_fast FROM raw
),
changes2 AS (
  SELECT *, CASE WHEN LAG(effective_fast) OVER (PARTITION BY dwid ORDER BY grp)
                      IS DISTINCT FROM effective_fast THEN 1 ELSE 0 END AS is_change2
  FROM reclassified
),
grouped2 AS (
  SELECT *, SUM(is_change2) OVER (PARTITION BY dwid ORDER BY grp) AS merge_grp FROM changes2
)
SELECT dwid, MIN(start_ts) AS start_ts, MIN(start_distance) AS start_distance,
       SUM(CASE WHEN fast THEN duration_sec ELSE 0 END) AS fast_sec
FROM grouped2
WHERE effective_fast
GROUP BY dwid, merge_grp;

CREATE TEMP TABLE pu AS
SELECT d.dwid,
       count(i.dwid) AS paddle_up_count,
       arg_min(i.start_distance, i.start_ts) AS distance_to_first_paddle_up
FROM (SELECT DISTINCT dwid FROM run_points) d
LEFT JOIN pu_islands i ON i.dwid = d.dwid AND i.fast_sec >= 30
GROUP BY d.dwid;

UPDATE pu SET paddle_up_count = NULL WHERE paddle_up_count = 0;

SELECT l.rider, l.date, l.id, l.paddle_up_count AS was, p.paddle_up_count AS now
FROM dwlist l JOIN pu p ON p.dwid = l.id
WHERE l.paddle_up_count IS DISTINCT FROM p.paddle_up_count
ORDER BY l.rider, l.date;

UPDATE dwlist AS l
SET    paddle_up_count = p.paddle_up_count,
       distance_to_first_paddle_up = p.distance_to_first_paddle_up
FROM   pu p
WHERE  l.id = p.dwid
  AND  (l.paddle_up_count IS DISTINCT FROM p.paddle_up_count
        OR l.distance_to_first_paddle_up IS DISTINCT FROM p.distance_to_first_paddle_up);

DROP TABLE pu;
DROP TABLE pu_islands;

commit;
