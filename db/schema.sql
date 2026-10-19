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

-- Named launch and landing spots; dwlist.start_pos and end_pos point at
-- id. geom is lon/lat. update-beaches keeps it in step with beaches.kml.
CREATE TABLE beaches(
  id UUID,
  "name" VARCHAR,
  geom GEOMETRY,
  region VARCHAR -- e.g. 'Kihei', 'Maui North Shore'
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

-- Trackpoints whose speed must not count toward a run's top speed
-- (dwlist.max_speed_kmh), added by the bot's !glitch. The dws row itself
-- is left alone; deleting the exclusion puts it back.
CREATE TABLE speed_exclusions(
  dwid UUID,
  ts TIMESTAMP WITH TIME ZONE, -- the dws point's ts
  speed DOUBLE, -- its speed, for the record
  reason VARCHAR,
  added_at TIMESTAMP WITH TIME ZONE
);

-- Each run's top speed: the fastest trackpoint not in speed_exclusions
-- and not a lone spike, i.e. at most 6 km/h above the fastest other point
-- within 2 s of it. import.sql and !glitch set dwlist.max_speed_kmh from it.
create or replace view run_top_speed as
with p as (
  select d.dwid, d.speed,
    max(d.speed) over (partition by d.dwid order by d.ts
      range between interval 2 seconds preceding and interval 2 seconds following
      exclude current row) as near
  from dws d
  anti join speed_exclusions e on e.dwid = d.dwid and e.ts = d.ts
)
select dwid, max(speed) as max_speed_kmh
from p
where near is null or speed <= near + 6
group by dwid;

-- Each run's foiling heart rate (dwlist.min_foiling_hr, avg_foiling_hr):
-- trackpoints over 15 km/h, skipping stale readings. A watch can hold its
-- last heart rate through a paddle-up and then jump to the real one, so a
-- stretch of one unchanged value followed by a rise of 25 bpm or more is
-- left out. import.sql sets dwlist from it.
create or replace view run_foiling_hr as
with h as (
  select dwid, ts, speed, hr,
    hr is distinct from lag(hr) over (partition by dwid order by ts) as starts
  from dws
  where hr is not null
), g as (
  select *, sum(starts::int) over (partition by dwid order by ts) as held
  from h
), n as (
  select dwid, held, hr,
    lead(hr) over (partition by dwid order by held) as next_hr
  from g
  group by dwid, held, hr
)
select g.dwid, min(g.hr) as min_hr, avg(g.hr) as avg_hr
from g join n using (dwid, held)
where g.speed > 15 and (n.next_hr is null or n.next_hr < n.hr + 25)
group by g.dwid;


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

-- Wind forecasts for the stations' cells (db/forecast-ingest), kept so they
-- can be scored against what the station then saw. site is the station the
-- cell stands in for (kihei, hookipa); model is Open-Meteo's model name or
-- pacioos_wrf_mo. Live rows have issued, the model's run time (for PacIOOS,
-- when it was fetched); backfilled rows (Previous Runs API) have issued null
-- and lead_days, how many days before ts the forecast was made. day is the
-- Hawaii day of ts.
CREATE TABLE wind_forecast(
  site VARCHAR,
  model VARCHAR,
  issued TIMESTAMP WITH TIME ZONE,
  lead_days INTEGER,
  ts TIMESTAMP WITH TIME ZONE,
  day DATE,
  wavg DOUBLE, -- kn
  wdir DOUBLE  -- degrees, from
);

commit;
