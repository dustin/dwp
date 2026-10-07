#!/bin/sh -e


lake=$HOME/stuff/duck

h=`pwd`
import=`pwd`/import.sql
cd $lake
echo "Full import"
duckdb --init init.sql < $import

cd "$h"
./upload-runs.sh
