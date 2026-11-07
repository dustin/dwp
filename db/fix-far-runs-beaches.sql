-- One-time fix after the first migrate-far-runs.sql, whose 1 km cutoff
-- took the beach off 84 Maui and Molokaʻi runs (e.g. Maliko starts, 1.4 km
-- from the beach's outline). Gives every tracked run with no start or end
-- beach its nearest beach again, as run-stats.sql does, when that beach
-- is within the new 10 km cutoff. Runs far from any beach (Hood River)
-- stay unknown.
--
--   cd ~/stuff/duck && duckdb --init quack-init.sql < .../db/fix-far-runs-beaches.sql
--
-- Lists what it changes first. Safe to re-run.

use lake;
LOAD spatial;
SET geometry_always_xy = false;

begin;

call lake.set_commit_message('dustin', 'restore beaches within 10 km after migrate-far-runs');

CREATE TEMP TABLE beach_fix AS
WITH ends AS (
  SELECT p.dwid,
         arg_min(p.lat, p.ts) AS start_lat, arg_min(p.lon, p.ts) AS start_lon,
         arg_max(p.lat, p.ts) AS end_lat, arg_max(p.lon, p.ts) AS end_lon
  FROM run_points p JOIN dwlist l ON l.id = p.dwid
  WHERE l.start_pos IS NULL OR l.end_pos IS NULL
  GROUP BY p.dwid
)
SELECT e.dwid,
       (SELECT CASE WHEN ST_Distance_Sphere(ST_Point(e.start_lat, e.start_lon),
                 ST_PointN(ST_ShortestLine(ST_Point(e.start_lat, e.start_lon),
                                           ST_FlipCoordinates(b.geom)), 2)) <= 10000
                 THEN b.id END
        FROM beaches b
        ORDER BY ST_Length(ST_ShortestLine(ST_Point(e.start_lat, e.start_lon),
                                           ST_FlipCoordinates(b.geom)))
        LIMIT 1) AS start_pos,
       (SELECT CASE WHEN ST_Distance_Sphere(ST_Point(e.end_lat, e.end_lon),
                 ST_PointN(ST_ShortestLine(ST_Point(e.end_lat, e.end_lon),
                                           ST_FlipCoordinates(b.geom)), 2)) <= 10000
                 THEN b.id END
        FROM beaches b
        ORDER BY ST_Length(ST_ShortestLine(ST_Point(e.end_lat, e.end_lon),
                                           ST_FlipCoordinates(b.geom)))
        LIMIT 1) AS end_pos
FROM ends e;

SELECT l.rider, l.date, l.id, bs.name AS start_beach, be.name AS end_beach
FROM beach_fix f JOIN dwlist l ON l.id = f.dwid
LEFT JOIN beaches bs ON bs.id = coalesce(l.start_pos, f.start_pos)
LEFT JOIN beaches be ON be.id = coalesce(l.end_pos, f.end_pos)
ORDER BY l.date;

UPDATE dwlist AS l
SET    start_pos = coalesce(l.start_pos, f.start_pos),
       end_pos   = coalesce(l.end_pos, f.end_pos)
FROM   beach_fix f
WHERE  l.id = f.dwid;

DROP TABLE beach_fix;

commit;
