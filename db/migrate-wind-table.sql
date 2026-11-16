-- One-off: turn the lake's `wind` view (InfluxDB on bee1, read over HTTP
-- on every query) into the table schema.sql declares, filled with
-- everything the view has. From then on db/wind-ingest keeps it current
-- with the buoy job, and publish and the bot no longer need bee1.
--
--   cd ~/.config/lakes/dwp && duckdb --init quack-init.sql < ~/prog/downwind.pro/db/migrate-wind-table.sql
--
-- Needs bee1's InfluxDB up while it runs (the view reads it), and the
-- lake's Accept: application/csv secret (db/lake/init.sql), which nothing
-- needs after this. Publish re-checks every wind day once afterwards (the
-- rows' types may differ from the view's, which changes their
-- fingerprints); the CSVs only upload where their bytes changed. Run it
-- once: a second run finds no view and stops.
use lake;
begin;
CREATE TEMP TABLE wind_copy AS
  SELECT site::VARCHAR AS site, ts::TIMESTAMPTZ AS ts,
         (ts::TIMESTAMPTZ at time zone 'Pacific/Honolulu')::date AS day,
         day::DATE AS view_day,
         wavg::DOUBLE AS wavg, wdir::DOUBLE AS wdir,
         wgust::DOUBLE AS wgust, wlull::DOUBLE AS wlull
  FROM wind;
DROP VIEW wind;
CREATE TABLE wind(
  site VARCHAR,
  ts TIMESTAMP WITH TIME ZONE,
  day DATE,
  wavg DOUBLE,
  wdir DOUBLE,
  wgust DOUBLE,
  wlull DOUBLE
);
INSERT INTO wind SELECT * EXCLUDE (view_day) FROM wind_copy ORDER BY ts;
-- Readings whose day the view gave as something other than the Hawaii
-- day (expected 0; publish files them under the Hawaii day from now on).
SELECT count(*) AS readings, min(ts) AS first, max(ts) AS last,
       count(*) FILTER (WHERE view_day IS DISTINCT FROM day) AS other_day
FROM wind_copy;
DROP TABLE wind_copy;
commit;
