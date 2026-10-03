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
--
-- Backfill mode recomputes swell_partition from what's already stored
-- instead of fetching from NDBC: spectra from swell_spectrum, and NDBC's
-- primary observations from swell_partition's own rank 1 rows (the only
-- copy of them older than NDBC's window). Use it after changing the
-- derivation below; swell/backfill.sh wraps it. Optionally bounded with
-- since/until (timestamptz, inclusive; give an offset, or it's read in the
-- session's time zone):
--   duckdb mydb.duckdb \
--     -cmd "set variable mode = 'backfill';" \
--     -cmd "set variable since = '2026-07-22'::timestamptz;" \
--     < swell/update.sql

set variable station = coalesce(getvariable('station'), '51205');
set variable site = coalesce(getvariable('site'), 'pauwela');
set variable mode = coalesce(getvariable('mode'), 'update');
set variable since = coalesce(getvariable('since'), '-infinity'::timestamptz);
set variable until = coalesce(getvariable('until'), 'infinity'::timestamptz);
-- Where the realtime files come from; overridable for testing against
-- saved copies.
set variable ndbc_base = coalesce(getvariable('ndbc_base'), 'https://www.ndbc.noaa.gov/data/realtime2/');

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
-- same fetch instead of hitting NDBC twice. In backfill mode they come from
-- swell_spectrum instead. (DuckDB resolves read_text's URLs while planning,
-- before the mode filters below can rule them out, so a backfill still
-- reads whatever ndbc_base points at; backfill.sh points it at empty local
-- files so a backfill never touches NDBC and works offline.)
create or replace temp table fetched_spectrum as
with energy as (
  select ts, freq, value as energy
  from parse_wide_pairs(getvariable('ndbc_base') || getvariable('station') || '.data_spec')
  where getvariable('mode') = 'update'
),
direction as (
  select ts, freq, value as direction
  from parse_wide_pairs(getvariable('ndbc_base') || getvariable('station') || '.swdir')
  where getvariable('mode') = 'update'
),
spread as (
  select ts, freq, value as r1
  from parse_wide_pairs(getvariable('ndbc_base') || getvariable('station') || '.swr1')
  where getvariable('mode') = 'update'
)
select getvariable('site') as site, e.ts, e.freq, e.energy, d.direction, sp.r1
from energy e
join direction d using (ts, freq)
join spread sp using (ts, freq);

create or replace temp table incoming_spectrum as
with readings as (
  select * from fetched_spectrum
  union all
  select site, ts, freq, energy, direction, r1
  from swell_spectrum
  where getvariable('mode') = 'backfill'
    and site = getvariable('site')
    -- Padded past the range: a reading's spectrum is stamped 4 minutes
    -- after it, and readings without their own spectrum carry forward the
    -- last kJ for up to 3 hours (see the end of incoming_swell).
    and ts between getvariable('since') - interval 3 hours
               and getvariable('until') + interval 1 hour
)
select
  *,
  (
    coalesce(lead(freq) over (partition by ts order by freq), freq) -
    coalesce(lag(freq) over (partition by ts order by freq), freq)
  ) / 2 as bin_width
from readings;

-- NDBC's primary observations: the standard meteorological feed, or in
-- backfill mode the rank 1 rows already stored (padded to match the
-- spectra above; incoming_swell trims back to since/until).
create or replace temp table primary_observations as
select
  getvariable('site') as site,
  ts,
  CAST(ts AT TIME ZONE 'Pacific/Honolulu' AS DATE) as day,
  period,
  direction,
  height
from parse_stdmet(getvariable('ndbc_base') || getvariable('station') || '.txt')
where getvariable('mode') = 'update'
union all
select site, ts, day, period, direction, height
from swell_partition
where getvariable('mode') = 'backfill'
  and site = getvariable('site')
  and rank = 1
  and ts between getvariable('since') - interval 3 hours
             and getvariable('until') + interval 1 hour;

create or replace temp table incoming_swell as
with banded_spectra as (
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
    -- Period of the most energetic bin in the band. Surfline's per-swell
    -- periods (and its kJ figure) track the peak, which runs longer than the
    -- energy-weighted mean; since wavelength goes as T^2, that matters.
    1.0 / arg_max(bs.freq, bs.energy) as peak_period,
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
    -- NDBC stamps each hourly spectrum on the hour, 4 minutes after the
    -- standard observation it belongs to: the hh:00 spectrum is the
    -- previous hour's :56 report. (Checked against Surfline's buoy data,
    -- which has both half-hourly samples: NDBC's final 19:00 spectrum is
    -- exactly Surfline's 18:56 one.) Before the :56 sample is in, NDBC
    -- briefly serves the :26 one in that slot; see the merge below.
    where ts between bs.ts - interval 15 minutes
                 and bs.ts
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
component_kj as (
  -- See swell_partition.surfline_kj. Per component, single-wave energy
  -- rho*g*H^2/8 times deep-water wavelength g*T^2/(2*pi), with H = 4*sqrt(m0)
  -- and T = the band's peak period; that simplifies to rho*g^2*m0*T^2/pi.
  -- Summed over spectral components only: rank 1 is the whole sea state, so
  -- including it would double-count the same energy. Uses every band with
  -- any energy (not just ranked_components' m0 >= 0.02), because small
  -- long-period swells still carry a noticeable share at long wavelengths.
  select
    site,
    ts,
    round(sum(
      1025 * power(9.80665, 2) * m0 * power(peak_period, 2) / pi()
    ) / 1000) as surfline_kj
  from components
  where m0 > 0
  group by all
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
-- Readings without their own spectrum (the :26 reports) reuse the most
-- recent spectral kJ, the way Surfline carries its last partition set
-- forward. Capped at 3 hours so a stalled spectral feed goes null rather
-- than repeating a stale figure indefinitely.
select
  r.*,
  case
    when r.ts - k.ts <= interval 3 hours then k.surfline_kj
  end as surfline_kj
from all_rows r
asof left join component_kj k
  on r.site = k.site and r.ts >= k.ts
-- A backfill only rewrites the requested range (the padding above was just
-- context). Either mode only replaces a stored reading when it has spectra
-- to work from: where the archive has a gap, or at the start of NDBC's
-- window where the spectrum before it has already rolled off, the row
-- already stored is the best there is. New readings always go in, so a
-- stalled spectral feed doesn't hold back the standard observations.
where (getvariable('mode') = 'update'
       or r.ts between getvariable('since') and getvariable('until'))
  and (r.ts - k.ts <= interval 3 hours
       or (getvariable('mode') = 'update'
           and not exists (select 1 from swell_partition p
                           where p.site = r.site and p.ts = r.ts)));

-- swell_spectrum is the raw archive we can't re-fetch once NDBC's ~45-day
-- window rolls past it, so it only ever grows: never delete from it, even
-- though each run only recomputes/replaces the recent window in
-- swell_partition below.
--
-- It does take NDBC's revisions, though. NDBC fills each hourly slot with
-- the :26 sample first and replaces it with the :56 sample half an hour
-- later, so a run in between captures a provisional spectrum for the
-- newest hour. Overwriting it with what NDBC serves now keeps every slot
-- the :56 sample the pairing above expects. (Before this, the archive kept
-- whichever it saw first: about 60% of September's hours were the
-- provisional :26 sample. A run with NDBC's window still covering them
-- corrects them.)
merge into swell_spectrum as s
using (
  -- A backfill read these from swell_spectrum; nothing to add or revise.
  select * from incoming_spectrum where getvariable('mode') = 'update'
) as ins
on (s.site = ins.site and s.ts = ins.ts and s.freq = ins.freq)
when matched and (s.energy is distinct from ins.energy
                  or s.direction is distinct from ins.direction
                  or s.r1 is distinct from ins.r1) then
  update set energy = ins.energy, direction = ins.direction, r1 = ins.r1
when not matched then
  insert (site, ts, freq, energy, direction, r1)
  values (ins.site, ins.ts, ins.freq, ins.energy, ins.direction, ins.r1);

-- swell_partition, by contrast, is recomputed each run: every reading in
-- incoming_swell replaces all of its stored rows, so a formula/banding
-- change actually recomputes rather than silently keeping old values.
delete from swell_partition
where site = getvariable('site')
  and ts in (select ts from incoming_swell);

insert into swell_partition (
  site, ts, day, rank, period, direction, spread, height, energy, surfline_kj
)
select site, ts, day, rank, period, direction, spread, height, energy, surfline_kj
from incoming_swell;

drop table incoming_swell;
drop table primary_observations;
drop table incoming_spectrum;
drop table fetched_spectrum;

commit;
