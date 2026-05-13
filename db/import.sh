#!/bin/sh -e


lake=$HOME/stuff/duck
srcdir='/Users/dustin/Library/Mobile Documents/iCloud~TNT~Waterspeed/Documents/runs'

# mv "$srcdir/"Waterspeed-List* $HOME/Downloads/list.csv

importlist=`pwd`/import-list.sql
import=`pwd`/import.sql
cd $lake
echo "List import"
duckdb --init init.sql < $importlist
echo "Individual import"
duckdb --init init.sql < $import

cd /Users/dustin/prog/downwind.pro/db
