-- Tracks, for every rider: one file per run at rider=<rider>/dwid=<id>/
-- (served as runs/rider=<rider>/dwid=<id>/data.csv). Only runs from the
-- last 14 days unless DWP_FULL is set, which re-exports every track (for
-- moving the CDN to a new layout). The per-rider run lists are
-- export-lists.sql.

use lake;

copy (select
        l.rider, d.*, ST_Distance_Sphere(ST_Point(lat, lon), ST_Point(nearest_land_lat, nearest_land_lon)) distance_to_land
      from dws d
      join dwlist l on d.dwid = l.id
      where coalesce(getenv('DWP_FULL'), '') <> ''
         or to_timestamp(l.ts) > current_timestamp - interval '14 days'
      )
      to '/Users/dustin/stuff/dwruns' (partition_by (rider, dwid), OVERWRITE_OR_IGNORE true, PER_THREAD_OUTPUT false);

