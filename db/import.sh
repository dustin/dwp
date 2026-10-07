#!/bin/sh -e


lake=$HOME/stuff/duck

h=`pwd`
# Optional argument: an alternative import SQL file (absolute path).
import=${1:-`pwd`/import.sql}
cd $lake
echo "Full import"
duckdb --init init.sql < $import

cd "$h"
./upload-runs.sh
