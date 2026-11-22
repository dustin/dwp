-- A run's computed stats in dwlist, from its trackpoints within its trim
-- (run_points in schema.sql). Recomputes every run in the temp table
-- restat(dwid), which the caller makes, inside the caller's transaction:
-- import.sql pulls this in for a new run (dwp_publish.import_sql), and the
-- bot's !trim for a run it trims (dwp_publish.run_stats_sql). Runs with
-- no trackpoints are left alone.
--
-- No spatial: distances are dwp_haversine below, the formula DuckDB
-- spatial's ST_Distance_Sphere uses (db/nearest_land.py haversine), and the
-- beach shapes come in as plain edges (beach_edges, which the caller makes
-- with dwp_publish.beach_edges_sql).

-- The runs as a constant list: a filter on it reaches below run_points'
-- (and the views') windows, so they only see these runs' points. Joining
-- on restat instead runs the windows over every run's trackpoints, which
-- ran the database server out of memory (2026-11-22).
SET VARIABLE restat_ids = (SELECT list(dwid) FROM restat);

-- ST_Distance_Sphere's haversine (DuckDB spatial sgl.hpp), points (lat, lon).
CREATE OR REPLACE TEMP MACRO dwp_hav_a(la1, lo1, la2, lo2) AS
  pow(sin((la2 - la1) / 2.0), 2.0) + cos(la1) * cos(la2) * pow(sin((lo2 - lo1) / 2.0), 2.0);
CREATE OR REPLACE TEMP MACRO dwp_haversine(lat1, lon1, lat2, lon2) AS
  6371000.0 * (2.0 * atan2(
    sqrt(dwp_hav_a(lat1 * pi() / 180.0, lon1 * pi() / 180.0, lat2 * pi() / 180.0, lon2 * pi() / 180.0)),
    sqrt(1.0 - dwp_hav_a(lat1 * pi() / 180.0, lon1 * pi() / 180.0, lat2 * pi() / 180.0, lon2 * pi() / 180.0))));

CREATE TEMP TABLE restat_points AS
SELECT * FROM run_points WHERE list_contains(getvariable('restat_ids'), dwid);

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
WHERE  l.id = t.dwid AND list_contains(getvariable('restat_ids'), t.dwid);

-- Name the start and end beaches: the nearest beach to the first and last
-- trackpoints, or none (null, an unknown beach) when even that one is
-- over 10 km away, e.g. a run off Hood River.
-- "Nearest" is what ST_ShortestLine gave before this stopped using spatial
-- (2026-11-22): planar distance in (lat, lon) degrees to each beach shape,
-- 0 inside a polygon; the 10 km is dwp_haversine (ST_Distance_Sphere's
-- formula) to that nearest point. beach_edges (dwp_publish.beach_edges_sql)
-- holds the shapes' edges.
CREATE TEMP TABLE restat_ends AS
WITH e AS (
  SELECT dwid,
         arg_min({'lat': lat, 'lon': lon}, ts) AS s,
         arg_max({'lat': lat, 'lon': lon}, ts) AS e,
         count(*) AS n
  FROM restat_points
  GROUP BY dwid
)
SELECT dwid, 'first' AS which, s.lat, s.lon FROM e
UNION ALL
-- a one-point run has a first point only, as before
SELECT dwid, 'last', e.lat, e.lon FROM e WHERE n > 1;

UPDATE dwlist AS l
SET    start_pos = x.start_loc,
       end_pos   = x.end_loc
FROM   (
  WITH seg AS (
    SELECT p.dwid, p.which, p.lat, p.lon, b.beach, b.part, b.poly,
           b.ax, b.ay, b.bx - b.ax AS dx, b.by - b.ay AS dy,
           b.poly AND ((b.ay > p.lon) <> (b.by > p.lon))
             AND p.lat < b.ax + (p.lon - b.ay) * (b.bx - b.ax) / (b.by - b.ay) AS crosses
    FROM restat_ends p CROSS JOIN beach_edges b
    WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL
  ), t AS (
    SELECT *, greatest(0.0, least(1.0, coalesce(
             ((lat - ax) * dx + (lon - ay) * dy) / nullif(dx * dx + dy * dy, 0), 0.0))) AS t
    FROM seg
  ), near AS (
    SELECT *, ax + t * dx AS px, ay + t * dy AS py FROM t
  ), parts AS (
    SELECT dwid, which, lat, lon, beach, part,
           sum(crosses::int) % 2 = 1 AS inside,
           arg_min({'d2': (px - lat) ** 2 + (py - lon) ** 2, 'px': px, 'py': py},
                   (px - lat) ** 2 + (py - lon) ** 2) AS c
    FROM near
    GROUP BY ALL
  ), per_beach AS (
    SELECT dwid, which, lat, lon, beach,
           CASE WHEN bool_or(inside) THEN {'d2': 0.0, 'px': any_value(lat), 'py': any_value(lon)}
                ELSE arg_min(c, c.d2) END AS c
    FROM parts
    GROUP BY dwid, which, lat, lon, beach
  ), best AS (
    SELECT dwid, which, lat, lon, arg_min({'beach': beach, 'px': c.px, 'py': c.py}, c.d2) AS b
    FROM per_beach
    GROUP BY dwid, which, lat, lon
  )
  -- every run with points gets a row, so one with no position gets nulls
  SELECT r.dwid,
         max(CASE WHEN r.which = 'first'
                   AND dwp_haversine(r.lat, r.lon, best.b.px, best.b.py) <= 10000
                  THEN best.b.beach END) AS start_loc,
         max(CASE WHEN r.which = 'last'
                   AND dwp_haversine(r.lat, r.lon, best.b.px, best.b.py) <= 10000
                  THEN best.b.beach END) AS end_loc
  FROM restat_ends r LEFT JOIN best USING (dwid, which)
  GROUP BY r.dwid
) x
WHERE l.id = x.dwid;

DROP TABLE restat_ends;

-- heart rates, without stale readings (schema.sql)
UPDATE dwlist AS l
SET    min_foiling_hr = x.min_hr,
       avg_foiling_hr = x.avg_hr
FROM   run_foiling_hr x
WHERE  l.id = x.dwid AND list_contains(getvariable('restat_ids'), x.dwid);

-- max distance, or null (unknown) past 60 km: about half the widest channel
-- between the main islands (Kaʻieʻiewaho, ~116 km), so the most any
-- Hawaiian crossing could be from land. Further than that, the run is
-- somewhere the coastline doesn't cover (e.g. Hood River).
-- dwp_publish.py's tracks use the same 60000.
UPDATE dwlist AS l
SET    max_distance = CASE WHEN x.dist <= 60000 THEN x.dist END
FROM   (select dwid, max(dwp_haversine(lat, lon, nearest_land_lat, nearest_land_lon)) as dist
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
-- fast_sec is the time actually over 11 km/h, without the bridged gaps.
-- Synthesized points (synth_points in schema.sql) have no speed, so they
-- say nothing about being on foil and are left out.
CREATE TEMP TABLE raw_islands AS
WITH flagged AS (
  SELECT dwid, ts, distance, (speed > 11) AS fast
  FROM restat_points
  WHERE NOT synthetic
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
  SELECT *, fast AS raw_fast, duration_sec AS raw_sec,
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
  EXTRACT(EPOCH FROM (MAX(end_ts) - MIN(start_ts))) AS duration_sec,
  SUM(CASE WHEN raw_fast THEN raw_sec ELSE 0 END) AS fast_sec
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

-- paddle up counts: only merged fast islands with >= 30s actually on foil
-- count. A string of failed attempts (short flights a few seconds apart,
-- bridged into one island) doesn't.
UPDATE dwlist AS dl
SET paddle_up_count = pc.paddle_up_count
FROM (
    SELECT dwid, COUNT(*) AS paddle_up_count
    FROM fast_islands_merged
    WHERE fast AND fast_sec >= 30
    GROUP BY dwid
) pc
WHERE dl.id = pc.dwid;

-- distance to first paddle up (first qualifying island, same bar)
UPDATE dwlist AS dl
SET distance_to_first_paddle_up = fu.start_distance
FROM (
    SELECT dwid, start_distance,
           ROW_NUMBER() OVER (PARTITION BY dwid ORDER BY start_ts) AS rn
    FROM fast_islands_merged
    WHERE fast AND fast_sec >= 30
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
DROP TABLE beach_edges;
RESET VARIABLE restat_ids;
