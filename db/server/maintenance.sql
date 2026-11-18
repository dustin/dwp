-- Nightly upkeep for the dwp database (server/hm-module.nix's
-- dwp-db-maintenance), run in the server's own session. A DuckDB file
-- needs little: a checkpoint folds the WAL in and frees space that
-- deletes left behind, then the file's size for the log.
use dwp;

select 'checkpointing' as log;
checkpoint dwp;

select 'size' as log;
select database_size, wal_size, free_blocks, total_blocks
  from pragma_database_size() where database_name = 'dwp';
