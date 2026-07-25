#!/bin/sh -e


lake=$HOME/stuff/duck
srcdir='/Users/dustin/Library/Mobile Documents/iCloud~TNT~Waterspeed/Documents/runs'

mv "$srcdir/"Waterspeed-List* $HOME/Downloads/list.csv
archive='/Volumes/dustin/data/waterspeed'

h=`pwd`
importlist=`pwd`/import-list.sql
import=`pwd`/import.sql
cd $lake
echo "List import"
duckdb --init init.sql < $importlist
echo "Individual import"
duckdb --init init.sql < $import

if [ -d "$archive" ]
then
    mv "$srcdir/"*.csv "$archive"
fi

cd "$h"
./upload.sh
