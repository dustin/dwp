-- The dwp lake's session settings, before the lake is attached (lake.nix
-- adds the ATTACH and, for the server, quack_serve). Mirrors what the
-- lake needed from the big lake's init.sql: the extensions the lake's
-- views and macros use. (The InfluxDB Accept-header secret went with the
-- old `wind` view: migrate-wind-table.sql.)
INSTALL ducklake; LOAD ducklake;
INSTALL sqlite; LOAD sqlite;
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;

SET autoinstall_known_extensions = 1;
SET autoload_known_extensions = 1;
SET allow_asterisks_in_http_paths = true;
SET s3_url_style = 'path';
SET http_keep_alive = false;
