-- Import all the things v3

begin;

create temp table allthethings as
  select
    regexp_replace(regexp_replace(filename, '^.*/', ''), '\.csv', '') AS filename,
    "Timestamp (from 1970)" as tsi,
     date, time,
     Lat as lat,
     Long as lon,
     "Speed (m/s)" * 3.6 as speed,
     Heading as heading,
     HR as hr,
     "Distance (m)" as distance_orig,
     0::double as distance,
     0::double as avg_speed_15s,
     0::double as avg_speed_1k,
     "Calories (SUM)" as calories
  from read_csv("/Users/dustin/Library/Mobile Documents/iCloud~TNT~Waterspeed/Documents/runs/*.csv")
  where regexp_replace(regexp_replace(filename, '^.*/', ''), '\.csv', '') not in (select filename from dwlist where id in (select distinct dwid from dws));

CREATE or replace TEMP TABLE tmp_distance AS
WITH points AS (
    SELECT
        filename,
        tsi,
        -- Your installation expects (lat, lon)
        ST_Point(lat, lon)                                   AS pt,
        LAG(ST_Point(lat, lon)) OVER (
            PARTITION BY filename
            ORDER BY tsi
        )                                                   AS prev_pt
    FROM allthethings
),
segments AS (
    SELECT
        filename,
        tsi,
        pt,
        prev_pt,
        CASE
            WHEN prev_pt IS NULL THEN 0
            ELSE ST_Distance_Sphere(prev_pt, pt)
        END                                                 AS seg_dist
    FROM points
)
SELECT
    filename,
    tsi,
    SUM(seg_dist) OVER (
        PARTITION BY filename
        ORDER BY tsi
        ROWS UNBOUNDED PRECEDING
    )                                                     AS distance
FROM segments;

MERGE INTO allthethings AS tgt
USING tmp_distance AS src
ON  tgt.filename = src.filename
AND tgt.tsi   = src.tsi
WHEN MATCHED THEN
    UPDATE SET distance = src.distance;

drop table tmp_distance;

UPDATE allthethings AS tgt
SET    avg_speed_15s = src.avg_15s
FROM (
        SELECT
            filename,
            tsi,
            AVG(speed) OVER (
              PARTITION BY filename
              ORDER BY to_timestamp(tsi)
              RANGE BETWEEN INTERVAL '15' SECOND PRECEDING AND CURRENT ROW
        ) AS avg_15s        FROM allthethings
     ) AS src
WHERE  tgt.filename = src.filename
  AND  tgt.tsi      = src.tsi;

UPDATE allthethings AS tgt
SET
  avg_speed_1k = (
    SELECT AVG(d2.speed)
    FROM allthethings AS d2
    WHERE
      d2.filename = tgt.filename
      AND d2.distance BETWEEN tgt.distance - 1000 AND tgt.distance
  );

merge into dwlist as l
  using (
    select filename, min(tsi) as ts, min(date) as date, min(time) as time,
    max(speed) as max_speed_kmh, avg(speed) as avg_speed_kmh,
    max(tsi) - min(tsi) as duration_sec, (max(distance) / 1000) as distance_km
    from allthethings
    group by filename
  ) as ups
  on (l.filename = ups.filename)
  when matched then update
    set ts = ups.ts,
        date = ups.date, time = ups.time,
        max_speed_kmh = ups.max_speed_kmh, avg_speed_kmh = ups.avg_speed_kmh,
        duration_sec = ups.duration_sec, distance_km = ups.distance_km
  when not matched then insert (
    id, filename, sport, ts, date, time,
      max_speed_kmh, avg_speed_kmh, duration_sec, distance_km
  ) VALUES ( uuidv7(), ups.filename, 'Downwind', ups.ts, ups.date, ups.time,
      ups.max_speed_kmh, ups.avg_speed_kmh, ups.duration_sec, ups.distance_km
    );

insert into dws (dwid, tsi, ts, date, time, lat, lon, speed, heading, hr, distance, calories, nearest_land_lat, nearest_land_lon, avg_speed_15s, avg_speed_1k)
  select
     l.id,
     tsi,
     make_timestamp((tsi * 1000000)::BIGINT) as ts,
     c.date, c.time,
     c.lat,
     c.lon,
     speed,
     heading,
     nullif(hr, 0),
     c.distance,
     calories,
     nearest_lat, nearest_lon,
     avg_speed_15s, avg_speed_1k
  from allthethings as c
  join dwlist l on (c.filename = l.filename)
  left join lateral (
    select ST_X(ST_PointN(ST_ShortestLine(ST_Point(c.lat, c.lon), pp.geom), 2)) as nearest_lat,
           ST_Y(ST_PointN(ST_ShortestLine(ST_Point(c.lat, c.lon), pp.geom), 2)) as nearest_lon
      from coastline_swapped as pp
      order by ST_Distance_Sphere(
        ST_Point(c.lat, c.lon),
        ST_PointN(ST_ShortestLine(ST_Point(c.lat, c.lon), geom), 2))
      limit 1
      ) as nn on true;

drop table allthethings;

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
                QUALIFY
                    ROW_NUMBER() OVER (PARTITION BY d.dwid
                                       ORDER BY d.ts) = 1
                 OR ROW_NUMBER() OVER (PARTITION BY d.dwid
                                       ORDER BY d.ts DESC) = 1
             ) sub
        GROUP BY dwid
      ) x
WHERE l.id = x.dwid
  and (start_pos is null or end_pos is null);

-- update heart rates

UPDATE dwlist AS l
SET    min_foiling_hr = x.min_hr,
       avg_foiling_hr   = x.avg_hr
FROM   (select dwid, min(HR) as min_hr, avg(HR) as avg_hr
          from dws
          where speed > 15
          group by dwid
        ) x
  where l.id = x.dwid
    and (min_foiling_hr is null or min_foiling_hr is null);

-- update max distance

UPDATE dwlist AS l
SET    max_distance = x.dist
FROM   (select dwid, max(ST_Distance_Sphere(ST_Point(lat, lon), ST_Point(nearest_land_lat, nearest_land_lon))) as dist
          from dws
          group by dwid
        ) x
  where l.id = x.dwid
  and max_distance is null;

-- update max speed

UPDATE dwlist AS l
SET    max_speed_1k = x.maxspeed
FROM   (select dwid, max(avg_speed_1k) as maxspeed
          from dws
          group by dwid
        ) x
  where l.id = x.dwid
  and max_speed_1k is null;

-- Find the longest segments

UPDATE dwlist AS dl
SET
    longest_segment_distance = bi.total_distance,
    longest_segment_start    = bi.start_ts,
    longest_segment_end      = bi.end_ts
FROM (
    SELECT
        dwid,
        start_ts,
        end_ts,
        total_distance
    FROM (
        WITH flagged AS (
            SELECT
                dwid,
                ts,
                speed,
                distance,
                (speed > 11)               AS fast          -- boolean
            FROM dws
        ),
        island_start AS (
            SELECT
                *,
                CASE
                    WHEN fast
                         AND ( LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) IS NULL
                               OR LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) = FALSE )
                    THEN 1
                    ELSE 0
                END                       AS is_start
            FROM flagged
        ),
        grouped AS (
            SELECT
                *,
                SUM(is_start) OVER (PARTITION BY dwid ORDER BY ts) AS grp
            FROM island_start
        ),
        island_stats AS (
            SELECT
                dwid,
                grp,
                MIN(ts)                                            AS start_ts,
                MAX(ts)                                            AS end_ts,
                MAX(distance) - MIN(distance)                      AS total_distance,
                EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts)))            AS duration_sec
            FROM grouped
            WHERE fast
            GROUP BY dwid, grp
        )
        SELECT
            dwid,
            start_ts,
            end_ts,
            total_distance,
            ROW_NUMBER() OVER (PARTITION BY dwid
                               ORDER BY total_distance DESC) AS rn
        FROM island_stats
    ) AS ranked
    WHERE rn = 1
) AS bi
WHERE dl.id = bi.dwid;

-- Paddle up counts

UPDATE dwlist AS dl
SET
    paddle_up_count = pc.paddle_up_count
FROM (
    SELECT dwid, paddle_up_count
    FROM (
        WITH flagged AS (
            SELECT dwid, ts, speed, distance, (speed > 11) AS fast FROM dws
        ),
        island_start AS (
            SELECT *,
                CASE
                    WHEN fast
                         AND (LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) IS NULL
                              OR LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) = FALSE)
                    THEN 1 ELSE 0 END AS is_start
            FROM flagged
        ),
        grouped AS (
            SELECT *, SUM(is_start) OVER (PARTITION BY dwid ORDER BY ts) AS grp
            FROM island_start
        ),
        fast_islands AS (
            SELECT dwid,
                   grp,
                   MIN(ts)                                   AS start_ts,
                   MAX(ts)                                   AS end_ts,
                   EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts)))   AS duration_sec
            FROM grouped
            WHERE fast
            GROUP BY dwid, grp
        ),
        eligible_islands AS (
            SELECT dwid, grp
            FROM fast_islands
            WHERE duration_sec >= 15
        )
        SELECT dwid,
               COUNT(*) AS paddle_up_count
        FROM eligible_islands
        GROUP BY dwid
    ) cnt
) pc
WHERE dl.id = pc.dwid;

-- Find the distance to the first paddle up

UPDATE dwlist AS dl
SET    distance_to_first_paddle_up = fu.distance_to_first_paddle_up
FROM (
    SELECT dwid,
           start_dist AS distance_to_first_paddle_up
    FROM (
        SELECT dwid,
               start_ts,
               start_dist,
               ROW_NUMBER() OVER (PARTITION BY dwid ORDER BY start_ts) AS rn
        FROM (
            WITH flagged AS (
                SELECT dwid, ts, speed, distance, (speed > 11) AS fast FROM dws
            ),
            island_start AS (
                SELECT *,
                    CASE
                        WHEN fast
                             AND (LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) IS NULL
                                  OR LAG(fast) OVER (PARTITION BY dwid ORDER BY ts) = FALSE)
                        THEN 1 ELSE 0 END AS is_start
                FROM flagged
            ),
            grouped AS (
                SELECT *, SUM(is_start) OVER (PARTITION BY dwid ORDER BY ts) AS grp
                FROM island_start
            ),
            fast_islands AS (
                SELECT dwid,
                       grp,
                       MIN(ts)                                   AS start_ts,
                       MIN(distance)                    AS start_dist,
                       EXTRACT(EPOCH FROM (MAX(ts) - MIN(ts)))   AS duration_sec
                FROM grouped
                WHERE fast
                GROUP BY dwid, grp
            )
            SELECT dwid,
                   start_ts,
                   start_dist,
                   duration_sec
            FROM fast_islands
            WHERE duration_sec >= 60          -- “more than a minute”
        ) islands
    ) numbered
    WHERE rn = 1
) fu
WHERE dl.id = fu.dwid;

-- Foil distances

UPDATE dwlist AS dl
SET
    duration_on_foil = (
        SELECT
            SUM(duration_sec) FILTER (WHERE speed > 11)
        FROM (
            SELECT
                tsi,
                speed,
                lead(tsi) OVER (PARTITION BY dwid ORDER BY tsi) - tsi AS duration_sec
            FROM dws
            WHERE dwid = dl.id
        ) AS t
        WHERE t.duration_sec IS NOT NULL
    ),
    distance_on_foil = (
        SELECT
            SUM(seg_distance) FILTER (WHERE speed > 11)
        FROM (
            SELECT
                distance - LAG(distance) OVER (PARTITION BY dwid ORDER BY tsi) AS seg_distance,
                speed
            FROM dws
            WHERE dwid = dl.id
        ) AS d
        WHERE d.seg_distance IS NOT NULL
    );

commit;
