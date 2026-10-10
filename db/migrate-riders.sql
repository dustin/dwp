-- One-time migration: give every run an owner, so more than one rider's
-- runs can live in the same lake. Every existing run is Dustin's.
--
--   cd ~/stuff/duck && duckdb --init init.sql < .../db/migrate-riders.sql
--
-- Safe to re-run. Trackpoints (dws) have no rider of their own; they
-- belong to whichever rider owns their dwlist row.

use lake;

begin;

call lake.set_commit_message('dustin', 'add rider to dwlist');

ALTER TABLE dwlist ADD COLUMN IF NOT EXISTS rider VARCHAR;
UPDATE dwlist SET rider = 'dustin' WHERE rider IS NULL;

SELECT rider, count(*) AS runs FROM dwlist GROUP BY rider ORDER BY rider;

commit;
