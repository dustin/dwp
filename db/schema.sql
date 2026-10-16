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
  rider VARCHAR, -- whose run this is: the subdomain, e.g. 'dustin' (migrate-riders.sql)
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
  feeling BIGINT,
  training_type BIGINT,
  board VARCHAR,
  foil VARCHAR,
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
  distance_computed double, -- the distance from WS is unreliable
  region text,
  distance_on_foil double,
  duration_on_foil double,
  max_hr double -- only for runs entered by hand (import-manual.sql)
);

create or replace view dwlist_resolved as
select d.*, bs.name as start_beach, be.name as end_beach, bs.region as region
from dwlist d
join beaches bs on bs.id = start_pos
join beaches be on be.id = end_pos
order by date, time;


-- Cam readings, one row per watcher reading (db/cam-ingest, from
-- db/cams/cam_motion.py's motion.jsonl). day is the Hawaii day. A
-- reading the watcher skipped has only skipped set. Fields the watcher
-- adds later need a column here before cam-ingest keeps them.
CREATE TABLE cam_motion(
  site VARCHAR,
  ts TIMESTAMP WITH TIME ZONE,
  day DATE,
  dx DOUBLE, -- px/s, < 0 is right to left in the picture
  dy DOUBLE, -- px/s, > 0 is toward the beach
  "left" DOUBLE, -- share of moving water going left
  "right" DOUBLE,
  pairs INTEGER, -- frame pairs measured
  seconds DOUBLE, -- clip length
  whitecaps INTEGER, -- patches (db/cams/whitecaps.py)
  skipped VARCHAR -- why there was no measurement, e.g. 'kihei light'
);

-- Cam images: the image manifest. key is the object in the CDN bucket,
-- cams/site=<site>/day=<day>/<stamp>-<kind>.jpg; file is the local copy
-- publish uploads it from (not published).
CREATE TABLE cam_images(
  site VARCHAR,
  ts TIMESTAMP WITH TIME ZONE,
  day DATE,
  kind VARCHAR, -- flow (arrow overlay), frame, ...
  key VARCHAR,
  bytes BIGINT,
  file VARCHAR
);

commit;
