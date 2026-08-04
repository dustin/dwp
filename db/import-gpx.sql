-- ============================================================
-- Import a single downwind run from a GPX file, with a
-- hand-entered dwlist row (no CSV / Waterspeed export involved).
-- ============================================================

INSTALL spatial; LOAD spatial;
INSTALL icu;     LOAD icu;

use lake;

begin;

call lake.set_commit_message('dustin', 'import DW run from gpx');

-- ------------------------------------------------------------
-- 0. CONFIG — edit these per run
-- ------------------------------------------------------------
SET VARIABLE gpx_path = '/tmp/activity.gpx';
SET VARIABLE tz = 'Pacific/Honolulu';

-- ------------------------------------------------------------
-- 1. Reserve a new dwid (UUID) and insert the dwlist row.
--    sport is always 'Downwind'. equip_1 = board, equip_2 =
--    foil, equip_3 = whatever else (mast/wing/fin). Everything
--    else in dwlist is either derived below or left NULL/unused.
-- ------------------------------------------------------------
CREATE TEMP TABLE new_run AS
SELECT gen_random_uuid() AS dwid;

INSERT INTO dwlist (id, sport, equip_1, equip_2, equip_3)
SELECT
  dwid,
  'Downwind',
  'Kalama barracuda  96.0 lt',    -- TODO
  'F4 Orca 800',     -- TODO
  NULL                    -- TODO, if applicable
FROM new_run;

-- ------------------------------------------------------------
-- 2. Parse the GPX into individual trackpoints.
-- ------------------------------------------------------------
CREATE TEMP TABLE gpx_points AS
WITH raw AS (
  SELECT content FROM read_text(getvariable('gpx_path'))
),
pts AS (
  SELECT unnest(regexp_extract_all(content, '(?s)<trkpt[^>]*>.*?</trkpt>')) AS pt
  FROM raw
)
SELECT
  row_number() OVER ()                                            AS rn,
  regexp_extract(pt, 'lat="([^"]+)"', 1)::DOUBLE                  AS lat,
  regexp_extract(pt, 'lon="([^"]+)"', 1)::DOUBLE                  AS lon,
  regexp_extract(pt, '<ele>([^<]+)</ele>', 1)::DOUBLE             AS ele,
  regexp_extract(pt, '<time>([^<]+)</time>', 1)::TIMESTAMPTZ      AS time_utc,
  nullif(regexp_extract(pt, '<gpxtpx:hr>([^<]+)</gpxtpx:hr>', 1), '')::INTEGER AS hr
FROM pts;

-- ------------------------------------------------------------
-- 3. Derive tsi/date/time (local), speed, and cumulative
--    distance from consecutive points.
-- ------------------------------------------------------------
CREATE TEMP TABLE run_points AS
WITH ordered AS (
  SELECT
    rn,
    time_utc                                                    AS ts,           -- straight from the GPX, no reconstruction
    epoch(time_utc)                                             AS tsi,
    (time_utc AT TIME ZONE getvariable('tz'))                   AS ts_local,
    lat, lon, hr
  FROM gpx_points
),
segs AS (
  SELECT
    rn, ts, tsi, ts_local, lat, lon, hr,
    -- cumulative distance: consecutive-point deltas, as before
    ST_Distance_Sphere(
      ST_Point(lat, lon),
      LAG(ST_Point(lat, lon)) OVER (ORDER BY rn)
    )                                                            AS seg_dist,
    -- via_dist = prev→this + this→next; direct_dist = prev→next
    -- ratio > 1 indicates a detour (bad GPS fix)
    ST_Distance_Sphere(
      LAG(ST_Point(lat, lon)) OVER (ORDER BY rn),
      LEAD(ST_Point(lat, lon)) OVER (ORDER BY rn)
    )                                                            AS direct_dist,
    COALESCE(
      ST_Distance_Sphere(ST_Point(lat, lon), LAG(ST_Point(lat, lon)) OVER (ORDER BY rn)),
      0
    ) + COALESCE(
      ST_Distance_Sphere(ST_Point(lat, lon), LEAD(ST_Point(lat, lon)) OVER (ORDER BY rn)),
      0
    )                                                            AS via_dist,
    -- "instant" speed: baseline against the earliest point within
    -- the trailing 2s window, not just the immediately previous
    -- point. GPS position error is roughly constant regardless of
    -- baseline, so a longer baseline gives a better signal-to-noise
    -- ratio than a 1-sample (often ~1s) delta.
    FIRST_VALUE(ST_Point(lat, lon)) OVER (
      ORDER BY ts RANGE BETWEEN INTERVAL '2' SECOND PRECEDING AND CURRENT ROW
    )                                                            AS pt_2s_ago,
    FIRST_VALUE(ts) OVER (
      ORDER BY ts RANGE BETWEEN INTERVAL '2' SECOND PRECEDING AND CURRENT ROW
    )                                                            AS ts_2s_ago
  FROM ordered
),
gps_outliers AS (
  SELECT
    *,
    -- Flag as outlier if via_dist is more than 50% longer than direct_dist
    -- This threshold catches the wave-chop multipath signature: jump out & snap back
    CASE WHEN direct_dist > 0 AND via_dist > (direct_dist * 1.5) THEN TRUE ELSE FALSE END AS is_gps_outlier
  FROM segs
),
speeds AS (
  SELECT
    *,
    ST_Distance_Sphere(ST_Point(lat, lon), pt_2s_ago)             AS inst_dist,
    EXTRACT(EPOCH FROM (ts - ts_2s_ago))                          AS inst_dt
  FROM gps_outliers
),
corrected_points AS (
  SELECT
    rn, ts, tsi, lat, lon,
    -- For distance calculation: if this row is an outlier, use previous point's position;
    -- otherwise use current position. This ensures correct seg_dist for non-outliers.
    CASE WHEN rn = 1 THEN ST_Point(lat, lon)
         WHEN is_gps_outlier THEN LAG(ST_Point(lat, lon)) OVER (ORDER BY rn)
         ELSE ST_Point(lat, lon)
    END AS adjusted_point,
    -- Re-derive date/time from ts
    ts::DATE                                                      AS date,
    ts::TIME                                                      AS time,
    -- Calculate speed: same logic as before (2-second window baseline)
    CASE WHEN inst_dt > 0 THEN (inst_dist / inst_dt) * 3.6 ELSE 0 END AS speed,
    NULL::DOUBLE                                                  AS heading,      -- GPX has no heading/course field
    hr,
    NULL::DOUBLE                                                  AS distance_orig, -- GPX has no device distance field
    NULL::DOUBLE                                                  AS calories       -- GPX has no calorie field,
    is_gps_outlier                                                   -- Flag for outlier detection
  FROM speeds
),
corrected_dist AS (
  SELECT
    *,
    -- Recalculate seg_dist using adjusted positions (outliers hold previous position)
    CASE WHEN rn = 1 THEN NULL
         ELSE ST_Distance_Sphere(adjusted_point, LAG(adjusted_point) OVER (ORDER BY rn))
    END AS corrected_seg_dist
  FROM corrected_points
),
final_points AS (
  SELECT
    ts,
    tsi,
    date, time,
    -- For outliers, hold the last known-good position; for good points, use actual position
    CASE WHEN rn = 1 THEN lat  -- First point always uses its own position (no prev to hold from)
         WHEN is_gps_outlier THEN LAG(lat) OVER (ORDER BY rn ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
         ELSE lat
    END                                                             AS lat,
    CASE WHEN rn = 1 THEN lon  -- First point always uses its own position (no prev to hold from)
         WHEN is_gps_outlier THEN LAG(lon) OVER (ORDER BY rn ROWS BETWEEN 1 PRECEDING AND 1 PRECEDING)
         ELSE lon
    END                                                             AS lon,
    speed,
    heading, hr,
    distance_orig,
    -- Distance: use corrected_seg_dist which accounts for held positions
    SUM(COALESCE(corrected_seg_dist, 0)) OVER (
      ORDER BY rn ROWS UNBOUNDED PRECEDING
    )                                                                AS distance,
    calories
  FROM corrected_dist
)
SELECT * FROM final_points;

-- ------------------------------------------------------------
-- 4. Rolling 15s and 1km average speeds (same logic as the
--    CSV path, just scoped to this single run's points).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 5. Insert the trackpoints into dws, with nearest-land lookup
--    (same approach as the CSV import).
-- ------------------------------------------------------------
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

DROP TABLE gpx_points;
DROP TABLE run_points;
DROP TABLE run_points_avg;

-- ------------------------------------------------------------
-- 6. Roll the summary stats up into dwlist for this run.
-- ------------------------------------------------------------
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
-- NOTE: dwlist.ts is `double` (matches the original CSV import's convention
-- of storing tsi there, despite the column name) -- min(tsi) is correct as-is.

-- ------------------------------------------------------------
-- 7. Everything below is unchanged from the CSV import path --
--    it already operates generically per-dwid, so it applies
--    cleanly to the new run. Scoped with l.id = new dwid.
-- ------------------------------------------------------------

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

-- ------------------------------------------------------------
-- Debounced on/off-foil islands, shared by the four blocks below.
--
-- Two-stage run-length encoding:
--   1. raw_islands: alternating fast/slow runs from the raw
--      speed > 11 flag, as before.
--   2. bridge short slow gaps: any slow island under 15s didn't
--      really take you off foil, so it's reclassified as fast.
--   3. re-merge: consecutive raw islands that end up with the
--      same (bridged) fast/slow value get combined into one
--      island. A paddle-up only counts once this merged fast
--      island lasts at least 30s.
-- ------------------------------------------------------------
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
