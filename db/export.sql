-- Runs

use lake;

copy (select
        d.*, ST_Distance_Sphere(ST_Point(lat, lon), ST_Point(nearest_land_lat, nearest_land_lon)) distance_to_land
      from dws d
      join dwlist l on d.dwid = l.id
      where to_timestamp(l.ts) > current_timestamp - interval '14 days'
      )
      to '/Users/dustin/stuff/dwruns' (partition_by dwid, OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);

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
) t
WHERE
    avg_speed > 15  -- average speed still “high”
    AND speed < 5   -- current speed is “low”

    AND COALESCE(prev_speed, 0) >= 5

    AND ts > (min_ts + INTERVAL '5' MINUTE)
    AND ts < (max_ts - INTERVAL '5' MINUTE)
ORDER BY
    ts) to '/Users/dustin/prog/downwind.pro/web/src/data/crashes.csv';

-- The List

COPY (
  SELECT
    dr.*,
    wind_stats.avg_wavg,
    wind_stats.max_wavg,
    wind_stats.avg_wgust,
    wind_stats.max_wgust,
    wind_stats.avg_wdir
  FROM dwlist_resolved dr
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
) TO '/Users/dustin/prog/downwind.pro/web/src/data/runs.csv';

-- Wind

copy (select * from wind where day > current_timestamp - interval '14 days')
      to '/Users/dustin/stuff/wind' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);
