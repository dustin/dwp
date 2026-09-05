-- Backfill swell_partition for one station/year from NDBC's historical
-- archive, reading directly over HTTP -- no local files, same as update.sql.
--
-- Set station/year/site for the backfill you want, then:
--   duckdb mydb.duckdb < swell/historical.sql
-- Either edit the defaults below, or override without editing the file via
-- an --init script (e.g. `duckdb mydb.duckdb --init vars.sql < swell/historical.sql`
-- where vars.sql contains `set variable year = '2022';`, etc.) -- the
-- coalesce()s below mean a value set before this script runs wins.
set variable station = coalesce(getvariable('station'), '51205');
set variable year = coalesce(getvariable('year'), '2023');
set variable site = coalesce(getvariable('site'), 'pauwela');

-- NDBC's historical archive uses a different layout than realtime2: the
-- frequency bins are column headers instead of inline "(freq)" pairs, e.g.
--   #YY  MM DD hh mm  .0200  .0325  .0375 ...
--   2023 01 01 01 40   0.00   0.00   0.00 ...
-- and the files are gzipped. Not every station has archived spectral data
-- for every year, or at all -- NDBC returns a plain HTTP 404 for those, and
-- that comes through here as a hard error (there's no graceful "skip" in
-- SQL), so check https://www.ndbc.noaa.gov/station_history.php?station=<station>
-- first if you're not sure a year exists.
--
-- Sources (per station/year):
--   https://www.ndbc.noaa.gov/data/historical/swden/<station>w<year>.txt.gz  (energy density)
--   https://www.ndbc.noaa.gov/data/historical/swdir/<station>d<year>.txt.gz  (direction, alpha1)
--   https://www.ndbc.noaa.gov/data/historical/swr1/<station>j<year>.txt.gz   (spread, r1)

install httpfs;
load httpfs;

create or replace macro parse_wide_columns(url) as table
with lines as (
  select line
  from read_csv(url, header=false, sep=chr(1), columns={'line': 'VARCHAR'})
),
header as (
  select regexp_split_to_array(trim(line), '\s+')[6:] as freqs
  from lines where line like '#YY%'
),
rows as (
  select regexp_split_to_array(trim(line), '\s+') as tok
  from lines where line not like '#%' and trim(line) <> ''
)
select
  strptime(tok[1] || ' ' || tok[2] || ' ' || tok[3] || ' ' || tok[4] || ' ' || tok[5], '%Y %m %d %H %M') as ts,
  unnest(tok[6:])::double as value,
  unnest(h.freqs)::double as freq
from rows, header h;

begin;

merge into swell_partition as s
using (
  with energy as (
    select ts, freq, value as energy
    from parse_wide_columns('https://www.ndbc.noaa.gov/data/historical/swden/' || getvariable('station') || 'w' || getvariable('year') || '.txt.gz')
  ),
  direction as (
    select ts, freq, value as direction
    from parse_wide_columns('https://www.ndbc.noaa.gov/data/historical/swdir/' || getvariable('station') || 'd' || getvariable('year') || '.txt.gz')
  ),
  spread as (
    select ts, freq, value as r1
    from parse_wide_columns('https://www.ndbc.noaa.gov/data/historical/swr1/' || getvariable('station') || 'j' || getvariable('year') || '.txt.gz')
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
