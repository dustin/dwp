use lake;

-- How far back to export the derived buoy tables (swell_partition and
-- swell_spectrum). Normally the last two weeks; after a swell/backfill.sh,
-- export everything it rewrote, e.g. via upload-conditions.sh 120.
set variable buoy_export_days = coalesce(getvariable('buoy_export_days'), 14);

-- Wind

copy (select * from wind where day > current_timestamp - interval '14 days')
      to '/Users/dustin/stuff/wind' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);

-- Swells

copy (select * from swell where day > current_timestamp - interval '14 days')
      to '/Users/dustin/stuff/swell' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);

copy (select * from swell_partition where day > current_timestamp - to_days(getvariable('buoy_export_days')))
      to '/Users/dustin/stuff/swell_partition' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);

-- Raw per-frequency-bin spectral readings (swell_spectrum has no day column of
-- its own -- it's an append-only archive -- so derive one here the same way
-- update.sql derives it for swell_partition).
copy (
  select *, CAST(ts AT TIME ZONE 'Pacific/Honolulu' AS DATE) as day
  from swell_spectrum
  where ts > current_timestamp - to_days(getvariable('buoy_export_days'))
) to '/Users/dustin/stuff/swell_spectrum' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);
