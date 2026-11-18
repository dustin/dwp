-- The dwp database's session settings, before the file is attached
-- (hm-module.nix adds the ATTACH and, for the server, quack_serve): the
-- extensions its views and macros use.
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;

SET autoinstall_known_extensions = 1;
SET autoload_known_extensions = 1;
SET allow_asterisks_in_http_paths = true;
SET s3_url_style = 'path';
SET http_keep_alive = false;
