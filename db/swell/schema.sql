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

-- Raw per-frequency-bin spectral readings (data_spec/swdir/swr1, joined),
-- captured before any banding/derivation. NDBC only keeps ~45 days of these
-- source files, so this is what lets swell_partition's bands/formulas be
-- recomputed later for whatever window has already been captured, without
-- needing to re-derive everything from scratch every time the logic changes.
CREATE TABLE swell_spectrum(
  site VARCHAR,
  ts TIMESTAMP WITH TIME ZONE,
  freq DOUBLE,       -- Hz
  energy DOUBLE,     -- m^2/Hz, raw NDBC spectral density (data_spec)
  direction DOUBLE,  -- degrees true, alpha1 (swdir)
  r1 DOUBLE          -- 0-1, first normalized polar coefficient (swr1); higher = narrower/more confident direction
);

create or replace view swells_text as (
select
  site, ts,
  string_agg(
    printf(
      '%.1f'' @ %.1fs - %d° (%.2fm, %.2f kJ/m²)',
      height * 3.28,
      period,
      direction::int,
      height,
      energy
    ),
    ', ' order by rank
  ) as swells,
  -- Approximates Surfline's displayed "kJ" figure: the sum, across every
  -- detected wave system in this reading, of single-wave energy
  -- (rho*g*H^2/8 -- note /8, not the statistical Hs/16 form the `energy`
  -- column above uses) times deep-water wavelength L = g*T^2/(2*pi).
  -- Reverse-engineered against ~12 real Surfline readings spanning 8-14s
  -- periods and 1-6 components each: consistent to within a few percent
  -- once summed across components, vs. wildly wrong using height/period
  -- from a single dominant reading alone. Not Surfline's actual formula
  -- (undocumented), just the closest match found so far.
  round(sum(
    (1025 * 9.80665 * power(height, 2) / 8) * (9.80665 * power(period, 2) / (2 * pi())) / 1000
  )) as surfline_kj
from swell_partition
group by all
);
