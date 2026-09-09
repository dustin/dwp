use lake;

-- Wind

copy (select * from wind where day > current_timestamp - interval '14 days')
      to '/Users/dustin/stuff/wind' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);

-- Swells

copy (select * from swell where day > current_timestamp - interval '14 days')
      to '/Users/dustin/stuff/swell' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);

copy (select * from swell_partition where day > current_timestamp - interval '14 days')
      to '/Users/dustin/stuff/swell_partition' (partition_by (site, day), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);
