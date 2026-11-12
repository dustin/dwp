-- The dwp lake's session settings, before the lake is attached (lake.nix
-- adds the ATTACH and, for the server, quack_serve). Mirrors what the
-- lake needed from the big lake's init.sql: the extensions the lake's
-- views and macros use, and the InfluxDB secret the `wind` view needs.
INSTALL ducklake; LOAD ducklake;
INSTALL sqlite; LOAD sqlite;
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;

SET autoinstall_known_extensions = 1;
SET autoload_known_extensions = 1;
SET allow_asterisks_in_http_paths = true;
SET s3_url_style = 'path';
SET http_keep_alive = false;

-- `wind` reads bee1's InfluxDB over HTTP; it answers CSV only when asked.
CREATE SECRET http_auth (
    TYPE http,
    EXTRA_HTTP_HEADERS MAP {
        'Accept': 'application/csv'
    }
);
