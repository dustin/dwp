begin;

CREATE TABLE dws(
  tsi DOUBLE,
  ts TIMESTAMP WITH TIME ZONE,
  date DATE,
  "time" TIME,
  lat DOUBLE,
  lon DOUBLE,
  speed DOUBLE,
  heading DOUBLE,
  hr INTEGER,
  distance DOUBLE,
  calories DOUBLE,
  nearest_land_lat DOUBLE,
  nearest_land_lon DOUBLE,
  avg_speed_15s DOUBLE,
  avg_speed_1k DOUBLE,
  dwid UUID
);

CREATE TABLE dwlist(
  id UUID,
  ts DOUBLE, -- originally timestamp_from_1970
  date DATE,
  "time" TIME,
  distance_km DOUBLE,
  duration_sec DOUBLE,
  paused_sec DOUBLE,
  avg_speed_kmh DOUBLE,
  max_speed_kmh DOUBLE,
  "name" VARCHAR,
  description VARCHAR,
  wind_speed_kn DOUBLE,
  wind_direction VARCHAR,
  sport VARCHAR,
  city VARCHAR,
  country VARCHAR,
  feeling BIGINT,
  training_type BIGINT,
  equip_1 VARCHAR,
  equip_2 VARCHAR,
  equip_3 VARCHAR,
  filename VARCHAR,

  -- computed stats
  start_pos UUID,
  end_pos UUID,
  max_speed_1k double,
  max_distance double, -- max distance to land
  min_foiling_hr double,
  avg_foiling_hr double,
  longest_segment_distance double,
  longest_segment_start timestamptz,
  longest_segment_end timestamptz,
  paddle_up_count int,
  distance_to_first_paddle_up double,
  distance_computed double -- the distance from WS is unreliable
);

create view dwlist_resolved as
select d.*, bs.name as start_beach, be.name as end_beach
from dwlist d
join beaches bs on bs.id = start_pos
join beaches be on be.id = end_pos
order by date, time;


commit;

