-- Nightly upkeep for the dwp lake (lake/hm-module.nix's
-- dwp-lake-maintenance), run in the lake's own session. A plain DuckDB
-- file needs little: a checkpoint folds the WAL in and frees space that
-- deletes left behind, then the file's size for the log.
use lake;

select 'checkpointing' as log;
checkpoint lake;

select 'size' as log;
select database_size, wal_size, free_blocks, total_blocks
  from pragma_database_size() where database_name = 'lake';
