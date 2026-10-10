-- One rider's run list, crashes and buoy snapshots, for the web.
--
-- upload-runs.sh runs this once per rider with the rider variable set:
--
--   duckdb --init init.sql -cmd "set variable rider = 'dustin';" < export-lists.sql
--
-- It writes to /Users/dustin/stuff/dwlists/ and upload-runs.sh moves the
-- files to runs/rider=<rider>/ on the CDN.

use lake;

SELECT CASE WHEN getvariable('rider') IS NULL
  THEN error('set variable rider first') END AS rider_check;
-- Crash export

copy (SELECT
    dwid,
    ts,
    date,
    time,
    lat,
    lon,
    speed,
    avg_speed
FROM (
    SELECT
        dwid,
        ts,
        date,
        time,
        lat,
        lon,
        speed,

        AVG(speed) OVER (
            PARTITION BY filename
            ORDER BY ts
            RANGE BETWEEN INTERVAL 15 SECOND PRECEDING AND CURRENT ROW
        ) AS avg_speed,

        MIN(ts) OVER (PARTITION BY dwid) AS min_ts,
        MAX(ts) OVER (PARTITION BY dwid) AS max_ts,

        LAG(speed) OVER (PARTITION BY filename ORDER BY ts) AS prev_speed
    FROM dws
    WHERE dwid IN (SELECT id FROM dwlist WHERE rider = getvariable('rider'))
) t
WHERE
    avg_speed > 15  -- average speed still “high”
    AND speed < 5   -- current speed is “low”

    AND COALESCE(prev_speed, 0) >= 5

    AND ts > (min_ts + INTERVAL '5' MINUTE)
    AND ts < (max_ts - INTERVAL '5' MINUTE)
ORDER BY
    ts) to '/Users/dustin/stuff/dwlists/crashes.csv';

-- Run buoy snapshots
--
-- Buoy conditions at each North Shore run's midpoint
--
-- The buoy page compares every North Shore run against current conditions.
-- Fetching each run's whole day of buoy data in the browser takes a request
-- pair per run, so export just the reading nearest each run's midpoint here:
-- the nearest spectrum (one row per frequency bin) and the nearest NDBC
-- standard report (swell_partition rank 1), each within 3 hours. A run with
-- neither still gets one row of nulls, so the page can tell "no buoy data"
-- from "not exported yet". Mirrors fetchBuoySnapshot in web/lib/components/data.js.

copy (
  with runs as (
    select id as dwid, to_timestamp(ts + duration_sec / 2) as mid
    from dwlist_resolved
    where region = 'Maui North Shore'
      and rider = getvariable('rider')
      -- BUOY_DATA_START in web/lib/components/data.js
      and to_timestamp(ts) >= TIMESTAMPTZ '2026-07-22 00:00:00-10'
  ),
  slots as (select distinct ts from swell_spectrum where site = 'pauwela'),
  reports as (select * from swell_partition where site = 'pauwela' and rank = 1),
  nearest_spectrum as (
    select r.dwid, arg_min(s.ts, (abs(epoch(s.ts) - epoch(r.mid)), s.ts)) as spectrum_ts
    from runs r
    join slots s on s.ts between r.mid - interval 3 hour and r.mid + interval 3 hour
    group by r.dwid
  ),
  nearest_report as (
    select r.dwid, arg_min(p, (abs(epoch(p.ts) - epoch(r.mid)), p.ts)) as p
    from runs r
    join reports p on p.ts between r.mid - interval 3 hour and r.mid + interval 3 hour
    group by r.dwid
  )
  select
    r.dwid,
    ns.spectrum_ts,
    -- When that spectrum was sampled: NDBC stamps it 4 minutes after the :56
    -- report, but until that report is out the slot holds the :26 sample
    -- (spectrumSampleTime in data.js).
    case
      when ns.spectrum_ts is null then null
      when not exists (select 1 from reports q where q.ts = ns.spectrum_ts - interval 4 minute)
       and exists (select 1 from reports q where q.ts = ns.spectrum_ts - interval 34 minute)
        then ns.spectrum_ts - interval 34 minute
      else ns.spectrum_ts - interval 4 minute
    end as sample_ts,
    s.freq, s.energy, s.direction, s.r1,
    nr.p.ts as primary_ts,
    nr.p.period as primary_period,
    nr.p.direction as primary_direction,
    nr.p.height as primary_height,
    nr.p.energy as primary_energy,
    nr.p.surfline_kj as primary_surfline_kj
  from runs r
  left join nearest_spectrum ns using (dwid)
  left join swell_spectrum s on s.site = 'pauwela' and s.ts = ns.spectrum_ts
  left join nearest_report nr using (dwid)
  order by r.dwid, s.freq
) to '/Users/dustin/stuff/dwlists/run_buoy.csv';

-- The List

COPY (
  SELECT
    dr.*,
    -- Lifetime distance *before* this run (0 for the first one), not
    -- including it -- so a run's own distance_km carries it from this
    -- reading up to the next run's odometer_km.
    COALESCE(SUM(dr.distance_km) OVER (
      ORDER BY dr.ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ), 0) AS odometer_km,
    -- False for runs entered by hand (import-manual.sql): no trackpoints,
    -- so the web draws an approximate route between the beaches, which
    -- are placed at the beach outlines' centers.
    EXISTS (SELECT 1 FROM dws WHERE dws.dwid = dr.id) AS has_track,
    ST_Y(ST_Centroid(bs.geom)) AS start_lat,
    ST_X(ST_Centroid(bs.geom)) AS start_lon,
    ST_Y(ST_Centroid(be.geom)) AS end_lat,
    ST_X(ST_Centroid(be.geom)) AS end_lon,
    wind_stats.avg_wavg,
    wind_stats.max_wavg,
    wind_stats.avg_wgust,
    wind_stats.max_wgust,
    wind_stats.avg_wdir
  FROM dwlist_resolved dr
  JOIN beaches bs ON bs.id = dr.start_pos
  JOIN beaches be ON be.id = dr.end_pos
  LEFT JOIN (
    SELECT
      dr2.id AS dwlist_id,
      AVG(w.wavg) AS avg_wavg,
      MAX(w.wavg) AS max_wavg,
      AVG(w.wgust) AS avg_wgust,
      MAX(w.wgust) AS max_wgust,
      -- Circular mean for wind direction
      CASE
      WHEN AVG(sin(radians(w.wdir))) = 0 AND AVG(cos(radians(w.wdir))) = 0 THEN NULL
      ELSE MOD(
          CAST(degrees(atan2(
          AVG(sin(radians(w.wdir))),
          AVG(cos(radians(w.wdir)))
          )) + 360 AS INTEGER),
          360
      )
      END AS avg_wdir
    FROM dwlist_resolved dr2
    LEFT JOIN wind w ON (
      w.site = CASE
        WHEN dr2.region = 'Kihei' THEN 'kihei'
        WHEN dr2.region = 'Maui North Shore' THEN 'hookipa'
      END
      AND w.ts >= to_timestamp(dr2.ts - 30 * 60)
      AND w.ts <= to_timestamp(dr2.ts + dr2.duration_sec)
    )
    WHERE dr2.region IN ('Kihei', 'Maui North Shore')
    GROUP BY dr2.id
  ) AS wind_stats ON dr.id = wind_stats.dwlist_id
  WHERE dr.rider = getvariable('rider')
) TO '/Users/dustin/stuff/dwlists/runs.csv';
