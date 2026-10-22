-- A run's computed stats in dwlist, from its trackpoints within its trim
-- (run_points in schema.sql). Recomputes every run in the temp table
-- restat(dwid), which the caller makes, inside the caller's transaction:
-- import.sql pulls this in for a new run (dwp_publish.import_sql), and the
-- bot's !trim for a run it trims (dwp_publish.run_stats_sql). Runs with
-- no trackpoints are left alone.
--
-- Every ST_Point here (and coastline_swapped) is (lat, lon); the caller
-- sets geometry_always_xy = false.

CREATE TEMP TABLE restat_points AS
SELECT * FROM run_points WHERE dwid IN (SELECT dwid FROM restat);

UPDATE dwlist AS l
SET ts = ups.ts,
    date = ups.date, time = ups.time,
    max_speed_kmh = ups.max_speed_kmh, avg_speed_kmh = ups.avg_speed_kmh,
    duration_sec = ups.duration_sec, distance_km = ups.distance_km
FROM (
  SELECT
    dwid,
    min(tsi) AS ts, arg_min(date, tsi) AS date, arg_min(time, tsi) AS time,
    max(speed) AS max_speed_kmh, avg(speed) AS avg_speed_kmh,
    max(tsi) - min(tsi) AS duration_sec, (max(distance) / 1000) AS distance_km
  FROM restat_points
  GROUP BY dwid
) AS ups
WHERE l.id = ups.dwid;
-- dwlist.ts is `double` and stores tsi (epoch seconds), despite the column name.

-- Top speed without lone spikes or excluded points (schema.sql).
UPDATE dwlist AS l
SET    max_speed_kmh = t.max_speed_kmh
FROM   run_top_speed t
WHERE  l.id = t.dwid AND l.id IN (SELECT dwid FROM restat);

-- Name the start and end beaches
UPDATE dwlist AS l
SET    start_pos = x.start_loc,
       end_pos   = x.end_loc
FROM   (
        SELECT
            dwid,
            MAX(CASE WHEN which_row = 'first' THEN beach_id END) AS start_loc,
            MAX(CASE WHEN which_row = 'last'  THEN beach_id END) AS end_loc
        FROM (
                SELECT
                    d.dwid,
                    CASE
                        WHEN ROW_NUMBER() OVER (PARTITION BY d.dwid
                                                ORDER BY d.ts) = 1
                             THEN 'first'
                        ELSE 'last'
                    END                                               AS which_row,
                    ( SELECT b.id
                      FROM   beaches b
                      ORDER BY ST_Length(
                                 ST_ShortestLine(
                                     ST_Point(d.lat, d.lon), ST_FlipCoordinates(b.geom)))
                      LIMIT 1 )                                      AS beach_id
                FROM   restat_points d
                QUALIFY
                    ROW_NUMBER() OVER (PARTITION BY d.dwid
                                       ORDER BY d.ts) = 1
                 OR ROW_NUMBER() OVER (PARTITION BY d.dwid
                                       ORDER BY d.ts DESC) = 1
             ) sub
        GROUP BY dwid
      ) x
WHERE l.id = x.dwid;

-- heart rates, without stale readings (schema.sql)
UPDATE dwlist AS l
SET    min_foiling_hr = x.min_hr,
       avg_foiling_hr = x.avg_hr
FROM   run_foiling_hr x
WHERE  l.id = x.dwid AND l.id IN (SELECT dwid FROM restat);

-- max distance
UPDATE dwlist AS l
SET    max_distance = x.dist
FROM   (select dwid, max(ST_Distance_Sphere(ST_Point(lat, lon), ST_Point(nearest_land_lat, nearest_land_lon))) as dist
          from restat_points
          group by dwid
        ) x
WHERE l.id = x.dwid;

-- max speed
UPDATE dwlist AS l
SET    max_speed_1k = x.maxspeed
FROM   (select dwid, max(avg_speed_1k) as maxspeed
          from restat_points
          group by dwid
        ) x
WHERE l.id = x.dwid;

-- Debounced on/off-foil islands, shared by the four blocks below.
-- raw_islands: alternating fast/slow runs from speed > 11.
-- fast_islands_merged: slow gaps under 15s are bridged (reclassified
-- fast) and re-merged, since a brief drop does not mean coming off foil.
CREATE TEMP TABLE raw_islands AS
WITH flagged AS (
  SELECT dwid, ts, distance, (speed > 11) AS fast
  FROM restat_points
),
changes AS (
  SELECT *,
    CASE WHEN LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) IS DISTINCT FROM fast
         THEN 1 ELSE 0 END AS is_change
  FROM flagged
),
grouped AS (
  SELECT *, SUM(is_change) OVER (PARTITION BY dwid ORDER BY ts) AS grp
  FROM changes
)
SELECT
  dwid, grp, fast,
  MIN(ts)       AS start_ts,
  MAX(ts)       AS end_ts,
  MIN(distance) AS start_distance,
  MAX(distance) AS end_distance,
  EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts))) AS duration_sec
FROM grouped
GROUP BY dwid, grp, fast;

CREATE TEMP TABLE fast_islands_merged AS
WITH reclassified AS (
  SELECT *,
    CASE
      WHEN fast THEN TRUE
      WHEN NOT fast AND duration_sec < 15 THEN TRUE   -- bridge brief drops
      ELSE FALSE
    END AS effective_fast
  FROM raw_islands
),
changes2 AS (
  SELECT *,
    CASE WHEN LAG(effective_fast) OVER (PARTITION BY dwid ORDER BY grp) IS DISTINCT FROM effective_fast
         THEN 1 ELSE 0 END AS is_change2
  FROM reclassified
),
grouped2 AS (
  SELECT *, SUM(is_change2) OVER (PARTITION BY dwid ORDER BY grp) AS merge_grp
  FROM changes2
)
SELECT
  dwid,
  effective_fast                                  AS fast,
  MIN(start_ts)                                   AS start_ts,
  MAX(end_ts)                                      AS end_ts,
  MIN(start_distance)                              AS start_distance,
  MAX(end_distance)                                AS end_distance,
  MAX(end_distance) - MIN(start_distance)         AS total_distance,
  EXTRACT(EPOCH FROM (MAX(end_ts) - MIN(start_ts))) AS duration_sec
FROM grouped2
GROUP BY dwid, merge_grp, effective_fast;

DROP TABLE raw_islands;

-- The island stats below start from scratch, since a trim can leave a run
-- with no islands that count.
UPDATE dwlist
SET    longest_segment_distance = NULL, longest_segment_start = NULL,
       longest_segment_end = NULL, paddle_up_count = NULL,
       distance_to_first_paddle_up = NULL, duration_on_foil = NULL,
       distance_on_foil = NULL
WHERE  id IN (SELECT DISTINCT dwid FROM restat_points);

-- longest segment
UPDATE dwlist AS dl
SET
    longest_segment_distance = bi.total_distance,
    longest_segment_start    = bi.start_ts,
    longest_segment_end      = bi.end_ts
FROM (
    SELECT dwid, start_ts, end_ts, total_distance,
           ROW_NUMBER() OVER (PARTITION BY dwid ORDER BY total_distance DESC) AS rn
    FROM fast_islands_merged
    WHERE fast
) AS bi
WHERE bi.rn = 1 AND dl.id = bi.dwid;

-- paddle up counts: only merged fast islands sustained >= 30s count
UPDATE dwlist AS dl
SET paddle_up_count = pc.paddle_up_count
FROM (
    SELECT dwid, COUNT(*) AS paddle_up_count
    FROM fast_islands_merged
    WHERE fast AND duration_sec >= 30
    GROUP BY dwid
) pc
WHERE dl.id = pc.dwid;

-- distance to first paddle up (first qualifying island, same >= 30s bar)
UPDATE dwlist AS dl
SET distance_to_first_paddle_up = fu.start_distance
FROM (
    SELECT dwid, start_distance,
           ROW_NUMBER() OVER (PARTITION BY dwid ORDER BY start_ts) AS rn
    FROM fast_islands_merged
    WHERE fast AND duration_sec >= 30
) fu
WHERE fu.rn = 1 AND dl.id = fu.dwid;

-- foil distances: sum across all merged fast islands, any duration
UPDATE dwlist AS dl
SET
    duration_on_foil = fo.dur,
    distance_on_foil = fo.dist
FROM (
    SELECT dwid, SUM(duration_sec) AS dur, SUM(total_distance) AS dist
    FROM fast_islands_merged
    WHERE fast
    GROUP BY dwid
) fo
WHERE dl.id = fo.dwid;

DROP TABLE fast_islands_merged;
DROP TABLE restat_points;
DROP TABLE restat;
