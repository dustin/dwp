-- One-time: synthesize the end of Dustin's 2026-11-06 Sugar Beach run
-- (a5bff5a0), whose recording stopped at 14:19:37, still foiling about
-- 900 m off Keawakapu. He rode with Jeff and Apphia and landed at Maluaka,
-- at about the same spot as them, five minutes before them (Jeff landed at
-- 14:41:38, Apphia at 14:43:38, so 14:37:38).
--
-- The shape is Apphia's track (885b4f9e) from her point nearest where
-- Dustin's recording stopped (about 210 m away) to her landing, shifted to
-- start at his last point (the shift fades out along the way, so it still
-- ends where she landed), and with her timing stretched to fit his
-- landing time. The points go in synth_points (schema.sql), so they count
-- toward the run's distance and duration but not its speeds, heart rates
-- or time on foil.
--
-- Create synth_points and replace run_points from schema.sql first. Then
-- run ./synth-end-2026-11-06 (which fills in run-stats.sql and runs this
-- on the lake) and publish. Safe to re-run: it replaces the run's
-- synthesized points. To undo, delete the run's synth_points rows and
-- restat it (e.g. the bot's !trim undo).

use lake;

begin;

call lake.set_commit_message('dustin', 'synthesized end of run a5bff5a0 (recording stopped early)');

SET VARIABLE run = 'a5bff5a0-4dbc-436b-8b60-8f6c5caede79'::uuid;
SET VARIABLE tpl = '885b4f9e-80a7-4f4c-8dfc-cbefbb3135e6'::uuid;
SET VARIABLE landed = '2026-11-06 14:37:38-10'::timestamptz;

-- Where the recording stopped.
CREATE TEMP TABLE cut AS
SELECT ts, lat, lon, distance FROM dws
WHERE dwid = getvariable('run')
ORDER BY ts DESC LIMIT 1;

-- Apphia's track from her point nearest that, with how far along it each
-- point is (0 to 1, by her distance) and the time stretch.
CREATE TEMP TABLE seg AS
WITH t AS (SELECT * FROM dws WHERE dwid = getvariable('tpl')),
k AS (
  SELECT t.ts FROM t, cut
  ORDER BY ST_Distance_Sphere(ST_Point(t.lat, t.lon), ST_Point(cut.lat, cut.lon))
  LIMIT 1
),
s AS (SELECT t.* FROM t WHERE t.ts >= (SELECT ts FROM k))
SELECT s.ts, s.lat, s.lon,
  (s.distance - first_value(s.distance) over w)
    / (last_value(s.distance) over w - first_value(s.distance) over w) AS f,
  epoch(s.ts - first_value(s.ts) over w)
    / epoch(last_value(s.ts) over w - first_value(s.ts) over w) AS tf,
  first_value(s.lat) over w AS lat0, first_value(s.lon) over w AS lon0
FROM s
WINDOW w AS (ORDER BY s.ts ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING);

CREATE TEMP TABLE synth AS
WITH p AS (
  SELECT
    cut.ts + to_microseconds((epoch(getvariable('landed') - cut.ts) * seg.tf * 1e6)::bigint) AS ts,
    seg.lat + (cut.lat - seg.lat0) * (1 - seg.f) AS lat,
    seg.lon + (cut.lon - seg.lon0) * (1 - seg.f) AS lon
  FROM seg, cut
  WHERE seg.tf > 0
),
step AS (
  SELECT p.*,
    ST_Distance_Sphere(ST_Point(p.lat, p.lon),
      ST_Point(coalesce(lag(p.lat) over (ORDER BY p.ts), cut.lat),
               coalesce(lag(p.lon) over (ORDER BY p.ts), cut.lon))) AS d
  FROM p, cut
)
SELECT step.ts, step.lat, step.lon,
  cut.distance + sum(step.d) over (ORDER BY step.ts) AS distance
FROM step, cut;

DELETE FROM synth_points WHERE dwid = getvariable('run');
INSERT INTO synth_points BY NAME
SELECT getvariable('run') AS dwid, epoch(ts) AS tsi, ts,
       (ts AT TIME ZONE 'Pacific/Honolulu')::date AS date,
       (ts AT TIME ZONE 'Pacific/Honolulu')::time AS "time",
       lat, lon, distance,
       'end shaped from apphia 885b4f9e (rode together); landed Maluaka ~5 min before her' AS source,
       now() AS added_at
FROM synth;

DROP TABLE seg;
DROP TABLE synth;
DROP TABLE cut;

-- The run's stats again (synth-end-2026-11-06 puts run-stats.sql here).
-- @run-stats.sql

SELECT (SELECT count(*) FROM synth_points WHERE dwid = getvariable('run')) AS synth_points,
       round(distance_km, 2) AS distance_km, round(duration_sec / 60, 1) AS duration_min,
       round(avg_speed_kmh, 1) AS avg_speed_kmh, max_speed_kmh,
       round(distance_on_foil) AS distance_on_foil, paddle_up_count,
       (SELECT name FROM beaches WHERE id = end_pos) AS end_beach
FROM dwlist WHERE id = getvariable('run');

commit;
