-- Update swell_partition for a buoy by reading its spectral wave files
-- directly over HTTP -- no local fetch step, no intermediate files. Safe to
-- re-run: only new (site, ts, rank) rows get inserted.
--
-- Defaults to the Pauwela buoy (NDBC station 51205). Override station/site
-- without editing the file via -cmd, e.g.:
--   duckdb mydb.duckdb \
--     -cmd "set variable station = '51201';" \
--     -cmd "set variable site = 'waimea';" \
--     < swell/update.sql
--
-- Sources (per station):
--   https://www.ndbc.noaa.gov/data/realtime2/<station>.data_spec  (energy density)
--   https://www.ndbc.noaa.gov/data/realtime2/<station>.swdir      (direction, alpha1)
--   https://www.ndbc.noaa.gov/data/realtime2/<station>.swr1       (spread, r1)
-- NDBC keeps a rolling ~45 days here, so this should run at least that often
-- to avoid gaps.

set variable station = coalesce(getvariable('station'), '51205');
set variable site = coalesce(getvariable('site'), 'pauwela');

install httpfs;
load httpfs;

create or replace macro parse_wide_pairs(url) as table
select
  strptime(line[1:16], '%Y %m %d %H %M') as ts,
  unnest(regexp_extract_all(line, '([0-9.]+) \(([0-9.]+)\)', 1))::double as value,
  unnest(regexp_extract_all(line, '([0-9.]+) \(([0-9.]+)\)', 2))::double as freq
from (
  select unnest(str_split(content, chr(10))) as line
  from read_text(url)
)
where line not like '#%' and trim(line) <> '';

begin;

merge into swell_partition as s
using (
  with energy as (
    select ts, freq, value as energy
    from parse_wide_pairs('https://www.ndbc.noaa.gov/data/realtime2/' || getvariable('station') || '.data_spec')
  ),
  direction as (
    select ts, freq, value as direction
    from parse_wide_pairs('https://www.ndbc.noaa.gov/data/realtime2/' || getvariable('station') || '.swdir')
  ),
  spread as (
    select ts, freq, value as r1
    from parse_wide_pairs('https://www.ndbc.noaa.gov/data/realtime2/' || getvariable('station') || '.swr1')
  ),
  joined as (
    select e.ts, e.freq, e.energy, d.direction, sp.r1
    from energy e
    join direction d using (ts, freq)
    join spread sp using (ts, freq)
  ),
  smoothed as (
    -- 3-bin moving average knocks down single-bin noise spikes before peak-picking.
    -- bin_width is the frequency span this bin represents (midpoints to its
    -- neighbors), needed later to integrate energy over a band.
    select *,
      avg(energy) over (
        partition by ts order by freq
        rows between 1 preceding and 1 following
      ) as energy_smooth,
      (
        coalesce(lead(freq) over (partition by ts order by freq), freq) -
        coalesce(lag(freq) over (partition by ts order by freq), freq)
      ) / 2 as bin_width
    from joined
  ),
  neighbors as (
    select *,
      lag(energy_smooth) over (partition by ts order by freq) as prev,
      lead(energy_smooth) over (partition by ts order by freq) as next
    from smoothed
  ),
  localmax as (
    select * from neighbors
    where energy_smooth > coalesce(prev, -1) and energy_smooth > coalesce(next, -1)
  ),
  suppressed as (
    -- Non-maximum suppression: drop a peak if a stronger one sits within
    -- 0.03 Hz of it. Without this, one real swell can get reported twice
    -- from two adjacent noisy bins that both count as local maxima.
    select lm.* from localmax lm
    where not exists (
      select 1 from localmax lm2
      where lm2.ts = lm.ts
        and lm2.energy_smooth > lm.energy_smooth
        and abs(lm2.freq - lm.freq) < 0.03
    )
  ),
  candidates as (
    -- Keep peaks that are both non-trivial in absolute terms and at least
    -- 15% as energetic as the strongest component in that reading, so a
    -- calm day's noise floor doesn't get reported as a "swell".
    select *, max(energy_smooth) over (partition by ts) as ts_max
    from suppressed
  ),
  peaks as (
    select ts, freq as peak_freq, direction, r1,
      row_number() over (partition by ts order by energy_smooth desc) as rank
    from candidates
    where energy_smooth > 0.1 and energy_smooth > 0.15 * ts_max
  ),
  assigned as (
    -- Assign every original frequency bin to its nearest surviving peak, so
    -- each component's height/energy comes from integrating over the whole
    -- band around it rather than just the single peak bin.
    select sm.ts, sm.energy, sm.bin_width, p.rank, p.peak_freq, p.direction, p.r1
    from smoothed sm
    join peaks p on p.ts = sm.ts
    qualify row_number() over (partition by sm.ts, sm.freq order by abs(sm.freq - p.peak_freq)) = 1
  ),
  banded as (
    select ts, rank, peak_freq, direction, r1,
      sum(energy * bin_width) as m0 -- m^2, variance of surface elevation in this band
    from assigned
    group by ts, rank, peak_freq, direction, r1
  )
  select
    getvariable('site') as site,
    ts,
    CAST(ts AT TIME ZONE 'Pacific/Honolulu' AS DATE) as day,
    rank,
    round(1.0 / peak_freq, 1) as period,
    direction,
    r1 as spread,
    round(4 * sqrt(m0), 2) as height,               -- meters, Hs-style
    round(1025 * 9.80665 * m0 / 1000, 2) as energy  -- kJ/m^2, rho * g * m0
  from banded
) as ins
on (s.site = ins.site and s.ts = ins.ts and s.rank = ins.rank)
when not matched then
  insert (site, ts, day, rank, period, direction, spread, height, energy)
  values (ins.site, ins.ts, ins.day, ins.rank, ins.period, ins.direction, ins.spread, ins.height, ins.energy)
;

commit;
