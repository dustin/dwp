-- Add NDBC standard meteorological readings to the swell table: wave
-- height, dominant period, mean wave direction and water temperature, one
-- row per report. swell/collect wraps it; see there.
--
-- Takes the site and a list of files (URLs or local paths, gzipped or not),
-- in any of NDBC's stdmet layouts: realtime2 (MM for missing), the monthly
-- and yearly archives (99/999 for missing), and the archives before 2005,
-- which have no minute column. Readings the swell table already has for
-- the site are left alone, so overlapping files are fine:
--   duckdb mydb.duckdb \
--     -cmd "set variable site = 'waimea';" \
--     -cmd "set variable files = ['https://www.ndbc.noaa.gov/data/realtime2/51201.txt'];" \
--     < swell/stdmet.sql

install httpfs;
load httpfs;

begin;

call lake.set_commit_message('dustin', 'adding ' || getvariable('site') || ' buoy readings');

create or replace temp table incoming_stdmet as
with lines as (
  select regexp_split_to_array(trim(line), '\s+') as f
  from read_csv(getvariable('files'), columns = {'line': 'VARCHAR'},
                header = false, delim = chr(1), quote = '', escape = '',
                auto_detect = false)
  where line not like '#%' and line not like 'YY%' and trim(line) <> ''
),
fields as (
  -- Archives before 2005 have no minute column, so everything after the
  -- hour sits one field earlier.
  select f, case when len(f) = 17 then 0 else 1 end as m
  from lines
),
readings as (
  select
    strptime(f[1] || ' ' || f[2] || ' ' || f[3] || ' ' || f[4] || ' ' ||
             case when m = 1 then f[5] else '00' end,
             '%Y %m %d %H %M') at time zone 'UTC' as ts,
    try_cast(f[8 + m] as double) as wave_height,
    try_cast(f[9 + m] as double) as wave_period,
    try_cast(f[11 + m] as double) as wave_direction,
    try_cast(f[14 + m] as double) as water_temp
  from fields
),
cleaned as (
  select
    ts,
    case when wave_height < 99 then wave_height end as wave_height,
    case when wave_period < 99 then wave_period end as wave_period,
    case when wave_direction < 999 then wave_direction::int end as wave_direction,
    case when water_temp < 99 then water_temp end as water_temp
  from readings
)
select
  getvariable('site') as site,
  ts,
  CAST(ts AT TIME ZONE 'Pacific/Honolulu' AS DATE) as day,
  wave_height, wave_period, wave_direction, water_temp
from cleaned
where coalesce(wave_height, wave_period, wave_direction, water_temp) is not null
-- The same report can be in more than one file (a monthly archive and
-- realtime2); keep one.
qualify row_number() over (partition by ts order by wave_height is null, wave_period is null) = 1;

insert into swell (site, ts, day, wave_height, wave_period, wave_direction, water_temp)
select i.site, i.ts, i.day, i.wave_height, i.wave_period, i.wave_direction, i.water_temp
from incoming_stdmet i
where not exists (select 1 from swell s where s.site = i.site and s.ts = i.ts);

drop table incoming_stdmet;

commit;
