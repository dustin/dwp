-- One-time repair: since DuckDB 2.0 (2026-10-21 ~09:00 HST), cam-ingest
-- stored every cam_motion reading 10 hours early (read_json now types the
-- stamps as TIMESTAMPTZ, and ::timestamp turned them into Hawaii wall time),
-- so readings no longer matched their cam_images and the pages showed no
-- pictures. It also skipped the real readings from 09:00 to 19:00 HST that
-- day, as older than the lake's newest. Drop everything stored after the
-- last good reading; the next ./cam-ingest re-adds it all from motion.jsonl
-- with the right times:
--
--   cd ~/stuff/duck && duckdb --init quack-init.sql < .../db/migrate-cam-motion-tz.sql
--   then the conditions job (cam-ingest, publish) as usual
--
-- Safe to re-run before cam-ingest; don't re-run after new readings arrive.

use lake;

begin;

call lake.set_commit_message('dustin', 'drop cam readings stored 10 hours early');

select site, count(*) as dropping, min(ts) as first, max(ts) as last
from cam_motion where ts > '2026-10-21 19:05:00+00'::timestamptz group by site order by site;

delete from cam_motion where ts > '2026-10-21 19:05:00+00'::timestamptz;

commit;
