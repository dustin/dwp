-- Nightly upkeep for the dwp lake (lake.nix's dwp-lake-maintenance), run
-- in the lake's own session. The same steps as the big lake's
-- maintenance.sql, without offlining: this lake is small enough to keep
-- every file local.
--
-- delete_orphaned_files removes every file under DATA_PATH that this
-- catalog doesn't list, so DATA_PATH must belong to this lake alone.
use lake;

select 'merging adjacent files' as log;
call ducklake_merge_adjacent_files('lake');

select 'expiring snapshots' as log;
call ducklake_expire_snapshots('lake');

select 'cleaning orphans' as log;
call ducklake_delete_orphaned_files('lake', dry_run => false, cleanup_all => true);

select 'cleaning up old files' as log;
call ducklake_cleanup_old_files('lake', cleanup_all => true);

select 'live files' as log;
from ducklake_table_info('lake')
select sum(file_count) as files, format_bytes(sum(file_size_bytes)::bigint) as size;
