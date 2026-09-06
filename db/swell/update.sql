-- Update swell_partition from the NDBC standard meteorological feed directly
-- over HTTP. This is the same primary buoy observation Surfline displays:
-- significant wave height, dominant period, and mean wave direction.
--
-- Also captures the raw per-frequency-bin spectral readings into
-- swell_spectrum before any banding, so the swell_partition derivation can
-- be recomputed later without re-fetching (NDBC only keeps ~45 days).
--
-- Defaults to the Pauwela buoy (NDBC station 51205). Override station/site
-- without editing the file via -cmd, e.g.:
--   duckdb mydb.duckdb \
--     -cmd "set variable station = '51201';" \
--     -cmd "set variable site = 'waimea';" \
--     < swell/update.sql
--
-- Source (per station):
--   https://www.ndbc.noaa.gov/data/realtime2/<station>.txt
-- NDBC keeps a rolling ~45 days here, so this should run at least that often
-- to avoid gaps.

set variable station = coalesce(getvariable('station'), '51205');
set variable site = coalesce(getvariable('site'), 'pauwela');

install httpfs;
load httpfs;

create or replace macro parse_stdmet(url) as table
select
  -- NDBC timestamps are UTC. AT TIME ZONE 'UTC' makes that explicit so the
  -- naive-to-timestamptz conversion doesn't depend on the session's local
  -- TimeZone setting (which silently relabels rather than shifts otherwise).
  strptime(line[1:16], '%Y %m %d %H %M') at time zone 'UTC' as ts,
  regexp_extract(line, '^(?:\S+\s+){8}([0-9.]+)', 1)::double as height,
  regexp_extract(line, '^(?:\S+\s+){9}([0-9.]+)', 1)::double as period,
  regexp_extract(line, '^(?:\S+\s+){11}([0-9.]+)', 1)::double as direction
from (
  select unnest(str_split(content, chr(10))) as line
  from read_text(url)
)
where line not like '#%' and trim(line) <> ''
  and regexp_matches(line, '^(?:\S+\s+){8}[0-9.]+(?:\s+[0-9.]+){2}\s+[0-9.]+');

create or replace macro parse_wide_pairs(url) as table
select
  strptime(line[1:16], '%Y %m %d %H %M') at time zone 'UTC' as ts,
  unnest(regexp_extract_all(line, '([0-9.]+) \(([0-9.]+)\)', 1))::double as value,
  unnest(regexp_extract_all(line, '([0-9.]+) \(([0-9.]+)\)', 2))::double as freq
from (
  select unnest(str_split(content, chr(10))) as line
  from read_text(url)
)
where line not like '#%' and trim(line) <> '';

begin;

-- Raw per-bin spectral readings, fetched once and kept around so both
-- swell_spectrum (below) and the banding logic (in incoming_swell) read the
-- same fetch instead of hitting NDBC twice.
create or replace temp table incoming_spectrum as
with energy as (
  select ts, freq, value as energy
  from parse_wide_pairs(
    'https://www.ndbc.noaa.gov/data/realtime2/' || getvariable('station') || '.data_spec'
  )
),
direction as (
  select ts, freq, value as direction
  from parse_wide_pairs(
    'https://www.ndbc.noaa.gov/data/realtime2/' || getvariable('station') || '.swdir'
  )
),
spread as (
  select ts, freq, value as r1
  from parse_wide_pairs(
    'https://www.ndbc.noaa.gov/data/realtime2/' || getvariable('station') || '.swr1'
  )
)
select
  getvariable('site') as site,
  e.ts,
  e.freq,
  e.energy,
  d.direction,
  sp.r1,
  (
    coalesce(lead(e.freq) over (partition by e.ts order by e.freq), e.freq) -
    coalesce(lag(e.freq) over (partition by e.ts order by e.freq), e.freq)
  ) / 2 as bin_width
from energy e
join direction d using (ts, freq)
join spread sp using (ts, freq);

create or replace temp table incoming_swell as
with primary_observations as (
  select
    getvariable('site') as site,
    ts,
    CAST(ts AT TIME ZONE 'Pacific/Honolulu' AS DATE) as day,
    period,
    direction,
    height
  from parse_stdmet(
    'https://www.ndbc.noaa.gov/data/realtime2/' || getvariable('station') || '.txt'
  )
),
banded_spectra as (
  -- Broad period bands retain the distinct long-period swell, local swell,
  -- wind sea, and chop systems that the earlier nearest-peak assignment merged.
  select *,
    case
      when freq < 1.0 / 12 then 1
      when freq < 1.0 / 8 then 2
      when freq < 1.0 / 5 then 3
      else 4
    end as band
  from incoming_spectrum
),
components as (
  select
    po.site,
    po.ts,
    po.day,
    bs.band,
    sum(bs.energy * bs.bin_width) as m0,
    sum(bs.energy * bs.bin_width * bs.freq) / sum(bs.energy * bs.bin_width) as mean_freq,
    mod(
      degrees(atan2(
        sum(bs.energy * bs.bin_width * sin(radians(bs.direction))),
        sum(bs.energy * bs.bin_width * cos(radians(bs.direction)))
      )) + 360,
      360
    ) as direction,
    sum(bs.energy * bs.bin_width * bs.r1) / sum(bs.energy * bs.bin_width) as r1
  from banded_spectra bs
  join lateral (
    select *
    from primary_observations
    -- Spectral files are timestamped at the hour; their corresponding
    -- standard observation is the 56-minute report from that hour.
    where ts between bs.ts + interval 45 minutes
                 and bs.ts + interval 75 minutes
    order by ts
    limit 1
  ) po on true
  group by all
),
ranked_components as (
  select *,
    row_number() over (partition by site, ts order by m0 desc, band) + 1 as rank
  from components
  where m0 >= 0.02
),
primary_rows as (
  select
    site,
    ts,
    day,
    1 as rank,
    period,
    direction,
    null::double as spread,
    height,
    round(1025 * 9.80665 * power(height, 2) / 16 / 1000, 2) as energy
  from primary_observations
),
component_rows as (
  select
    site,
    ts,
    day,
    rank,
    round(1.0 / mean_freq, 1) as period,
    direction,
    r1 as spread,
    round(4 * sqrt(m0), 2) as height,
    round(1025 * 9.80665 * m0 / 1000, 2) as energy
  from ranked_components
),
all_rows as (
  select * from primary_rows
  union all
  select * from component_rows
)
select
  *,
  -- See swell_partition.surfline_kj: summed across every component sharing
  -- this (site, ts), then repeated on each of that reading's rows so this
  -- is computed once here instead of in every consumer.
  round(sum(
    (1025 * 9.80665 * power(height, 2) / 8) * (9.80665 * power(period, 2) / (2 * pi())) / 1000
  ) over (partition by site, ts)) as surfline_kj
from all_rows;

-- swell_spectrum is append-only: it's the raw archive we can't re-fetch once
-- NDBC's ~45-day window rolls past it, so it should only ever grow, even
-- though each run only recomputes/replaces the recent window in
-- swell_partition below. Insert whatever this run saw that isn't already
-- captured; never delete from it.
merge into swell_spectrum as s
using incoming_spectrum as ins
on (s.site = ins.site and s.ts = ins.ts and s.freq = ins.freq)
when not matched then
  insert (site, ts, freq, energy, direction, r1)
  values (ins.site, ins.ts, ins.freq, ins.energy, ins.direction, ins.r1);

-- swell_partition, by contrast, is fully recomputed each run from whatever's
-- in incoming_swell: replace only the source's rolling realtime window, so
-- a formula/banding change actually recomputes rather than silently keeping
-- old values.
delete from swell_partition
where site = getvariable('site')
  and ts between (select min(ts) from incoming_swell)
             and (select max(ts) from incoming_swell);

insert into swell_partition (
  site, ts, day, rank, period, direction, spread, height, energy, surfline_kj
)
select site, ts, day, rank, period, direction, spread, height, energy, surfline_kj
from incoming_swell;

drop table incoming_swell;
drop table incoming_spectrum;

commit;
