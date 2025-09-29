#!/bin/sh

root=/Users/dustin/stuff/dwruns/

consolidate() {
    d=`dirname $1`
    echo "Doing $d"
    cd $d

    duckdb -c "copy (select * from read_csv_auto('data_*.csv', header=true) order by tsi) to 'data.csv' (format csv, header true)"
    rm data_*.csv
}

find "$root" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file"
    done

rclone sync $root s3:db.downwind.pro/runs/  --progress
