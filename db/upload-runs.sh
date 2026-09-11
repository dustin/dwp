#!/bin/sh -e

lake=$HOME/stuff/duck
dwruns=/Users/dustin/stuff/dwruns/

consolidate() {
    d=`dirname $1`
    t=$2
    echo "Doing $d"
    cd $d

    duckdb -c "copy (select * from read_csv_auto('data_*.csv', header=true) order by $t) to 'data.csv' (format csv, header true)"
    rm data_*.csv
    gzip -9v data.csv
    mv data.csv.gz data.csv
}


export=`pwd`/export-runs.sql
cd $lake
duckdb --init init.sql < $export


find "$dwruns" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" tsi
    done

rclone sync $dwruns s3:db.downwind.pro/runs/ \
    --header-upload "Content-Encoding: gzip" \
    --header-upload "Content-Type: text/csv; charset=utf-8" \
    --max-age 14d

