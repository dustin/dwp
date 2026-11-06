-- One-time move of publish's manifest from ~/stuff/dwp-manifest.sqlite on
-- dsstudio into the lake (publish_manifest, see schema.sql), so publish
-- can run from any host. Run it on dsstudio, where the quack server can
-- read that file, with nothing publishing (the bot's !publish, the buoy
-- job):
--
--   cd ~/stuff/duck && duckdb --init quack-init.sql < .../db/migrate-manifest.sql
--
-- It refuses to run twice: publish_manifest must not exist yet. Keep the
-- sqlite file until a publish has run; it's unused after that.

use lake;

load sqlite;

begin;

call lake.set_commit_message('dustin', 'publish manifest moves into the lake');

CREATE TABLE publish_manifest(
  key VARCHAR,
  sha256 VARCHAR,
  size BIGINT,
  headers VARCHAR,
  fingerprint VARCHAR,
  uploaded_at TIMESTAMP WITH TIME ZONE
);

insert into publish_manifest
  select key, sha256, size, headers, fingerprint, to_timestamp(uploaded_at)
  from sqlite_scan('/Users/dustin/stuff/dwp-manifest.sqlite', 'objects');

select count(*) as objects, max(uploaded_at) as newest from publish_manifest;

commit;
