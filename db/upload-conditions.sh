#!/bin/sh -e

lake=$HOME/stuff/duck
wind=/Users/dustin/stuff/wind/
swell=/Users/dustin/stuff/swell/
swell_partition=/Users/dustin/stuff/swell_partition/

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

export=`pwd`/export-conditions.sql
cd $lake
duckdb --init init.sql < $export

find "$wind" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" ts
    done

rclone sync $wind s3:db.downwind.pro/wind/ \
    --header-upload "Content-Encoding: gzip" \
    --header-upload "Content-Type: text/csv; charset=utf-8" \
    --max-age 14d

find "$swell" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" ts
    done

rclone sync $swell s3:db.downwind.pro/swell/ \
    --header-upload "Content-Encoding: gzip" \
    --header-upload "Content-Type: text/csv; charset=utf-8" \
    --max-age 14d

find "$swell_partition" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" ts
    done

rclone sync "$swell_partition" s3:db.downwind.pro/swell_partition/ \
    --header-upload "Content-Encoding: gzip" \
    --header-upload "Content-Type: text/csv; charset=utf-8" \
    --max-age 14d
