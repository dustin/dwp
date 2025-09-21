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
     "Distance (m)" as distance,
     "Calories (SUM)" as calories
  from read_csv("/Users/dustin/Library/Mobile Documents/iCloud~TNT~Waterspeed/Documents/runs/*.csv")
  where regexp_replace(regexp_replace(filename, '^.*/', ''), '\.csv', '') not in (select distinct filename from dws);

alter table allthethings add column avg_speed_15s double;
alter table allthethings add column avg_speed_1k double;

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


commit;
