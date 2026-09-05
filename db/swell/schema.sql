-- NDBC's primary wave observation plus frequency-band components derived from
-- the corresponding directional spectrum. Rank 1 is the standard
-- meteorological observation; subsequent ranks are distinct wave systems.

CREATE TABLE swell_partition(
  site VARCHAR,
  ts TIMESTAMP WITH TIME ZONE,
  day DATE,
  rank INTEGER,      -- 1 = NDBC primary observation; 2+ = spectral components
  period DOUBLE,     -- NDBC dominant or energy-weighted component period, seconds
  direction DOUBLE,  -- NDBC mean or energy-weighted component direction, degrees true
  spread DOUBLE,     -- null for rank 1; r1 for spectral components
  height DOUBLE,     -- meters; significant height or Hs-style component height
  energy DOUBLE      -- kJ/m^2, derived from the reported height or component m0
);

create or replace view swells_text as (
select
  site, ts,
  string_agg(
    printf(
      '%.1f'' @ %.1fs - %d° (%.2fm, %.2f kJ/m², ~%.0f kJ/m)',
      height * 3.28,
      period,
      direction::int,
      height,
      energy,
      energy * 9.80665 * power(period, 2) / (2 * pi())
    ),
    ', ' order by rank
  ) as swells
from swell_partition
group by all
);
