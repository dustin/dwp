-- Runs

-- Runs

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
    ts) to '/Users/dustin/prog/downwind.pro/web/src/data/crashes.csv'

-- The List

copy (from dwlist_resolved) to '/Users/dustin/prog/downwind.pro/web/src/data/runs.csv';

-- Wind

copy (select * from wind where day > current_timestamp - interval '14 days')
      to '/Users/dustin/stuff/wind' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);
