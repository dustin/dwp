use lake;

-- Every ST_Point here (and coastline_swapped) is (lat, lon); DuckDB 2.0
-- makes ST_Distance_Sphere ask which order. Keep the pre-2.0 one.
LOAD spatial;
SET geometry_always_xy = false;

begin;

-- The CSV path, rider and foil come from the environment; add-run sets
-- them. DWP_RIDER is whose run this is (migrate-riders.sql); everything
-- below that looks at existing runs only looks at that rider's.
SET VARIABLE rider = CASE
  WHEN coalesce(getenv('DWP_RIDER'), '') = ''
    THEN error('set DWP_RIDER to the rider, e.g. DWP_RIDER=dustin')
  ELSE getenv('DWP_RIDER')
END;
call lake.set_commit_message('dustin', 'import DW run from filtered csv');
SET VARIABLE csv_path = coalesce(nullif(getenv('DWP_CSV'), ''), '/tmp/activity.csv');
SET VARIABLE tz = 'Pacific/Honolulu';
-- DWP_BOARD if given, else the board on the rider's latest run.
SET VARIABLE board = coalesce(
  nullif(getenv('DWP_BOARD'), ''),
  (SELECT board FROM dwlist
   WHERE rider = getvariable('rider') AND board IS NOT NULL
   ORDER BY ts DESC LIMIT 1),
  CASE WHEN getvariable('rider') = 'dustin' THEN 'Kalama Gator  95.0 lt' END);

-- Resolve DWP_FOIL (any case-insensitive piece of a foil name, e.g. 688)
-- to the one foil in the rider's dwlist rows it names. An exact name always wins. With
-- DWP_NEW_FOIL set, DWP_FOIL is a foil not used before, taken as is.
-- Without DWP_FOIL, the foil is left NULL here and filled in once the start
-- beach is known: the rider's foil on their latest run from that beach.
SET VARIABLE foil = (
  WITH known AS (SELECT DISTINCT foil FROM dwlist
                 WHERE foil IS NOT NULL AND rider = getvariable('rider')),
  hits AS (
    SELECT foil FROM known
    WHERE contains(lower(foil), lower(getenv('DWP_FOIL')))
    QUALIFY NOT bool_or(lower(foil) = lower(getenv('DWP_FOIL'))) OVER ()
         OR lower(foil) = lower(getenv('DWP_FOIL'))
  )
  SELECT CASE
    WHEN coalesce(getenv('DWP_FOIL'), '') = '' THEN NULL
    WHEN coalesce(getenv('DWP_NEW_FOIL'), '') <> '' THEN getenv('DWP_FOIL')
    WHEN count(*) = 1 THEN any_value(foil)
    WHEN count(*) = 0
      THEN error('no foil matches ''' || getenv('DWP_FOIL')
                 || ''' (add-run --new-foil to add one)')
    ELSE error('''' || getenv('DWP_FOIL') || ''' matches more than one foil: '
               || string_agg(foil, ', ' ORDER BY foil))
  END
  FROM hits
);

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
-- range must be the same run, so we match on that instead. Only the same
-- rider's runs, though: two riders on the same downwind overlap all the
-- time.
CREATE TEMP TABLE new_run_range AS
SELECT min(ts) AS start_ts, max(ts) AS end_ts FROM run_points;

CREATE TEMP TABLE existing_run AS
SELECT dwid
FROM dws
WHERE dwid IN (SELECT id FROM dwlist WHERE rider = getvariable('rider'))
GROUP BY dwid
HAVING min(ts) - INTERVAL '5 minutes' <= (SELECT end_ts FROM new_run_range)
   AND max(ts) + INTERVAL '5 minutes' >= (SELECT start_ts FROM new_run_range)
UNION
-- A run entered by hand (import-manual.sql) has no trackpoints, so match
-- it on its summary times instead, and the real track replaces it.
SELECT id
FROM dwlist l
WHERE l.rider = getvariable('rider')
  AND NOT EXISTS (SELECT 1 FROM dws WHERE dws.dwid = l.id)
  AND to_timestamp(l.ts) - INTERVAL '5 minutes' <= (SELECT end_ts FROM new_run_range)
  AND to_timestamp(l.ts + l.duration_sec) + INTERVAL '5 minutes' >= (SELECT start_ts FROM new_run_range);

SELECT 'replacing ' || count(*) || ' existing run(s): ' ||
       coalesce(string_agg(dwid::VARCHAR, ', '), '(none)') AS reimport_notice
FROM existing_run;

-- A trim on the run being replaced carries over to the new one.
CREATE TEMP TABLE old_trim AS
SELECT start_ts, end_ts, reason, added_at FROM run_trims
WHERE dwid IN (SELECT dwid FROM existing_run)
ORDER BY added_at DESC LIMIT 1;
DELETE FROM run_trims WHERE dwid IN (SELECT dwid FROM existing_run);

DELETE FROM dws WHERE dwid IN (SELECT dwid FROM existing_run);
DELETE FROM dwlist WHERE id IN (SELECT dwid FROM existing_run);

DROP TABLE existing_run;
DROP TABLE new_run_range;

CREATE TEMP TABLE new_run AS
SELECT gen_random_uuid() AS dwid;

INSERT INTO run_trims
SELECT (SELECT dwid FROM new_run), start_ts, end_ts, reason, added_at FROM old_trim;
DROP TABLE old_trim;

INSERT INTO dwlist (id, rider, sport, board, foil)
SELECT
  dwid,
  getvariable('rider'),
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

-- Stats from the trackpoints (run-stats.sql, which import_sql puts here).
CREATE TEMP TABLE restat AS SELECT dwid FROM new_run;
-- @run-stats.sql

-- No DWP_FOIL: the foil from the rider's latest run that started here.
UPDATE dwlist AS l
SET    foil = coalesce(
         (SELECT p.foil FROM dwlist p
          WHERE p.rider = l.rider AND p.start_pos = l.start_pos
            AND p.foil IS NOT NULL AND p.id <> l.id
          ORDER BY p.ts DESC LIMIT 1),
         error('no earlier run from beach ' || coalesce(l.start_pos::VARCHAR, '(none)')
               || ' to take a foil from; set DWP_FOIL'))
WHERE  l.id = (SELECT dwid FROM new_run) AND l.foil IS NULL;

SELECT foil FROM dwlist WHERE id = (SELECT dwid FROM new_run);

DROP TABLE new_run;

commit;
