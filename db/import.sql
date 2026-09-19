use lake;

begin;

call lake.set_commit_message('dustin', 'import DW run from filtered csv');

SET VARIABLE csv_path = '/tmp/activity.csv';
SET VARIABLE tz = 'Pacific/Honolulu';
SET VARIABLE board = 'Kalama Gator  95.0 lt';
SET VARIABLE foil = 'F4 Hammerhead 585';

-- All filtering happens in gpx_filter.py; speed_final_kmh,
-- lat_filtered/lon_filtered, and distance_cumulative_m are
-- already the values to trust, so nothing is re-derived here.
CREATE TEMP TABLE run_points AS
SELECT
  time_utc::TIMESTAMPTZ                                          AS ts,
  epoch(time_utc::TIMESTAMPTZ)                                   AS tsi,
  (time_utc::TIMESTAMPTZ AT TIME ZONE getvariable('tz'))::DATE   AS date,
  (time_utc::TIMESTAMPTZ AT TIME ZONE getvariable('tz'))::TIME   AS time,
  lat_filtered                                                    AS lat,
  lon_filtered                                                    AS lon,
  speed_final_kmh                                                 AS speed,
  NULL::DOUBLE                                                    AS heading,      -- still not present in the source data
  hr,
  NULL::DOUBLE                                                    AS distance_orig, -- still not present in the source data
  distance_cumulative_m                                           AS distance,
  NULL::DOUBLE                                                    AS calories       -- still not present in the source data
FROM read_csv_auto(getvariable('csv_path'));

-- Re-import support: match an existing run by overlapping time
-- range rather than an exact timestamp, and replace it in place
-- instead of creating a duplicate. An exact match on the earliest
-- trackpoint timestamp isn't reliable: GPX files that have been
-- laundered through another system can come back with timestamps
-- shifted by a few seconds. Since no two real runs ever start
-- within a few minutes of each other or overlap in time, any
-- existing run whose (buffered) time range overlaps the new run's
-- range must be the same run, so we match on that instead.
CREATE TEMP TABLE new_run_range AS
SELECT min(ts) AS start_ts, max(ts) AS end_ts FROM run_points;

CREATE TEMP TABLE existing_run AS
SELECT dwid
FROM dws
GROUP BY dwid
HAVING min(ts) - INTERVAL '5 minutes' <= (SELECT end_ts FROM new_run_range)
   AND max(ts) + INTERVAL '5 minutes' >= (SELECT start_ts FROM new_run_range);

SELECT 'replacing ' || count(*) || ' existing run(s): ' ||
       coalesce(string_agg(dwid::VARCHAR, ', '), '(none)') AS reimport_notice
FROM existing_run;

DELETE FROM dws WHERE dwid IN (SELECT dwid FROM existing_run);
DELETE FROM dwlist WHERE id IN (SELECT dwid FROM existing_run);

DROP TABLE existing_run;
DROP TABLE new_run_range;

CREATE TEMP TABLE new_run AS
SELECT gen_random_uuid() AS dwid;

INSERT INTO dwlist (id, sport, board, foil)
SELECT
  dwid,
  'Downwind',
  getvariable('board'),
  getvariable('foil')
FROM new_run;

CREATE TEMP TABLE run_points_avg AS
SELECT
  p.*,
  AVG(p.speed) OVER (
    ORDER BY p.ts
    RANGE BETWEEN INTERVAL '15' SECOND PRECEDING AND CURRENT ROW
  ) AS avg_speed_15s,
  (
    SELECT AVG(d2.speed)
    FROM run_points d2
    WHERE d2.distance BETWEEN p.distance - 1000 AND p.distance
  ) AS avg_speed_1k
FROM run_points p;

INSTALL spatial; LOAD spatial;

INSERT INTO dws (
  dwid, tsi, ts, date, time, lat, lon, speed, heading, hr,
  distance, calories, nearest_land_lat, nearest_land_lon,
  avg_speed_15s, avg_speed_1k
)
SELECT
  (SELECT dwid FROM new_run) AS dwid,
  p.tsi,
  p.ts,
  p.date, p.time,
  p.lat, p.lon,
  p.speed,
  p.heading,
  nullif(p.hr, 0),
  p.distance,
  p.calories,
  nearest_lat, nearest_lon,
  p.avg_speed_15s, p.avg_speed_1k
FROM run_points_avg AS p
LEFT JOIN LATERAL (
  SELECT ST_X(ST_PointN(ST_ShortestLine(ST_Point(p.lat, p.lon), pp.geom), 2)) AS nearest_lat,
         ST_Y(ST_PointN(ST_ShortestLine(ST_Point(p.lat, p.lon), pp.geom), 2)) AS nearest_lon
  FROM coastline_swapped AS pp
  ORDER BY ST_Distance_Sphere(
    ST_Point(p.lat, p.lon),
    ST_PointN(ST_ShortestLine(ST_Point(p.lat, p.lon), pp.geom), 2))
  LIMIT 1
) AS nn ON true;

DROP TABLE run_points;
DROP TABLE run_points_avg;

UPDATE dwlist AS l
SET ts = ups.ts,
    date = ups.date, time = ups.time,
    max_speed_kmh = ups.max_speed_kmh, avg_speed_kmh = ups.avg_speed_kmh,
    duration_sec = ups.duration_sec, distance_km = ups.distance_km
FROM (
  SELECT
    min(tsi) AS ts, min(date) AS date, min(time) AS time,
    max(speed) AS max_speed_kmh, avg(speed) AS avg_speed_kmh,
    max(tsi) - min(tsi) AS duration_sec, (max(distance) / 1000) AS distance_km
  FROM dws
  WHERE dwid = (SELECT dwid FROM new_run)
) AS ups
WHERE l.id = (SELECT dwid FROM new_run);
-- dwlist.ts is `double` and stores tsi (epoch seconds), despite the column name.

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
                FROM   dws d
                WHERE  d.dwid = (SELECT dwid FROM new_run)
                QUALIFY
                    ROW_NUMBER() OVER (PARTITION BY d.dwid
                                       ORDER BY d.ts) = 1
                 OR ROW_NUMBER() OVER (PARTITION BY d.dwid
                                       ORDER BY d.ts DESC) = 1
             ) sub
        GROUP BY dwid
      ) x
WHERE l.id = x.dwid;

-- heart rates
UPDATE dwlist AS l
SET    min_foiling_hr = x.min_hr,
       avg_foiling_hr = x.avg_hr
FROM   (select dwid, min(HR) as min_hr, avg(HR) as avg_hr
          from dws
          where speed > 15 and dwid = (SELECT dwid FROM new_run)
          group by dwid
        ) x
WHERE l.id = x.dwid;

-- max distance
UPDATE dwlist AS l
SET    max_distance = x.dist
FROM   (select dwid, max(ST_Distance_Sphere(ST_Point(lat, lon), ST_Point(nearest_land_lat, nearest_land_lon))) as dist
          from dws
          where dwid = (SELECT dwid FROM new_run)
          group by dwid
        ) x
WHERE l.id = x.dwid;

-- max speed
UPDATE dwlist AS l
SET    max_speed_1k = x.maxspeed
FROM   (select dwid, max(avg_speed_1k) as maxspeed
          from dws
          where dwid = (SELECT dwid FROM new_run)
          group by dwid
        ) x
WHERE l.id = x.dwid;

-- Debounced on/off-foil islands, shared by the four blocks below.
-- raw_islands: alternating fast/slow runs from speed > 11.
-- fast_islands_merged: slow gaps under 15s are bridged (reclassified
-- fast) and re-merged, since a brief drop doesn't mean coming off foil.
CREATE TEMP TABLE raw_islands AS
WITH flagged AS (
  SELECT dwid, ts, distance, (speed > 11) AS fast
  FROM dws
  WHERE dwid = (SELECT dwid FROM new_run)
),
changes AS (
  SELECT *,
    CASE WHEN LAG(fast) OVER (ORDER BY ts) IS DISTINCT FROM fast
         THEN 1 ELSE 0 END AS is_change
  FROM flagged
),
grouped AS (
  SELECT *, SUM(is_change) OVER (ORDER BY ts) AS grp
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
    CASE WHEN LAG(effective_fast) OVER (ORDER BY grp) IS DISTINCT FROM effective_fast
         THEN 1 ELSE 0 END AS is_change2
  FROM reclassified
),
grouped2 AS (
  SELECT *, SUM(is_change2) OVER (ORDER BY grp) AS merge_grp
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

DROP TABLE new_run;

commit;
