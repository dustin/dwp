-- Partitioned swell components for a buoy reading. Unlike `swell` (one row
-- per site/ts, a single dominant height/period/direction), a reading here
-- can produce zero or more rows -- one per distinct swell/wind-sea component
-- identified in the spectral data.

CREATE TABLE swell_partition(
  site VARCHAR,
  ts TIMESTAMP WITH TIME ZONE,
  day DATE,
  rank INTEGER,      -- 1 = most energetic component at this reading
  period DOUBLE,     -- seconds
  direction DOUBLE,  -- degrees true, alpha1 at the peak frequency
  spread DOUBLE,     -- r1 at the peak frequency; higher = narrower/more confident direction
  height DOUBLE,     -- meters; Hs-style height for this component (4*sqrt(m0) over its band)
  energy DOUBLE      -- kJ/m^2; wave energy density for this component (rho*g*m0)
);

create or replace view swells_text as (
select
  site, ts,
  string_agg(printf('%.1fs @ %d° (%.2fm, %.2f kJ/m²)', period, direction::int, height, energy), ', ' order by rank) as swells
from swell_partition
group by all
);
