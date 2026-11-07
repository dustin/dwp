-- One-time backfill for runs far from Maui (e.g. Hood River), matching
-- run-stats.sql:
--   * start_pos/end_pos become null (an unknown beach) when the run's first
--     or last trackpoint is over 10 km from every known beach;
--   * max_distance becomes null (unknown) when it's over 60 km.
--
-- First replace dwlist_resolved from schema.sql (it now left-joins the
-- beaches), or runs with an unknown beach drop out of the view and the
-- site. Then:
--
--   cd ~/stuff/duck && duckdb --init init.sql < .../db/migrate-far-runs.sql
--
-- It lists what it changes before changing it. Safe to re-run. Runs
-- entered by hand have no trackpoints and are left alone.

use lake;
LOAD spatial;
SET geometry_always_xy = false;

begin;

call lake.set_commit_message('dustin', 'unknown beach and distance from land for runs far from Maui');

CREATE TEMP TABLE far_ends AS
WITH ends AS (
  SELECT dwid,
         arg_min(lat, ts) AS start_lat, arg_min(lon, ts) AS start_lon,
         arg_max(lat, ts) AS end_lat, arg_max(lon, ts) AS end_lon
  FROM run_points
  GROUP BY dwid
),
-- Metres from (lat, lon) to the nearest point of the nearest beach.
near AS (
  SELECT e.dwid,
         (SELECT min(ST_Distance_Sphere(ST_Point(e.start_lat, e.start_lon),
                   ST_PointN(ST_ShortestLine(ST_Point(e.start_lat, e.start_lon),
                                             ST_FlipCoordinates(b.geom)), 2)))
          FROM beaches b) AS start_m,
         (SELECT min(ST_Distance_Sphere(ST_Point(e.end_lat, e.end_lon),
                   ST_PointN(ST_ShortestLine(ST_Point(e.end_lat, e.end_lon),
                                             ST_FlipCoordinates(b.geom)), 2)))
          FROM beaches b) AS end_m
  FROM ends e
)
SELECT * FROM near WHERE start_m > 10000 OR end_m > 10000;

SELECT l.rider, l.date, l.id, r.start_beach, round(f.start_m / 1000, 1) AS start_km,
       r.end_beach, round(f.end_m / 1000, 1) AS end_km
FROM far_ends f JOIN dwlist l ON l.id = f.dwid JOIN dwlist_resolved r ON r.id = l.id
ORDER BY l.date;

SELECT rider, date, id, round(max_distance / 1000, 1) AS max_distance_km
FROM dwlist WHERE max_distance > 60000 ORDER BY date;

UPDATE dwlist AS l
SET    start_pos = CASE WHEN f.start_m > 10000 THEN NULL ELSE l.start_pos END,
       end_pos   = CASE WHEN f.end_m > 10000 THEN NULL ELSE l.end_pos END
FROM   far_ends f
WHERE  l.id = f.dwid;

UPDATE dwlist SET max_distance = NULL WHERE max_distance > 60000;

DROP TABLE far_ends;

commit;
