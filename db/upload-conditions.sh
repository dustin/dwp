#!/bin/sh -e

lake=$HOME/stuff/duck
wind=/Users/dustin/stuff/wind/
swell=/Users/dustin/stuff/swell/
swell_partition=/Users/dustin/stuff/swell_partition/
swell_spectrum=/Users/dustin/stuff/swell_spectrum/

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

# Cache lifetimes. Only the newest day partitions change in normal
# operation: today's, and yesterday's for a while after midnight (the 23:56
# reading isn't published until about 00:35, and NDBC revises its newest
# spectrum half an hour after first posting it). Everything older is
# settled, so browsers and CloudFront can keep it. Not "immutable": a
# backfill re-export (swell/backfill.sh) does rewrite old days, and then
# needs a CloudFront invalidation to show up promptly.
short_cache="public, max-age=300"
long_cache="public, max-age=31536000"

# Day partitions are Hawaii calendar days (see export-conditions.sql). BSD
# date (macOS) first, GNU date as a fallback.
hst_day() {
    TZ=Pacific/Honolulu date -v-"$1"d +%F 2>/dev/null ||
        TZ=Pacific/Honolulu date -d "$1 days ago" +%F
}
today=`hst_day 0`
yesterday=`hst_day 1`
settled=`hst_day 2`

# upload LOCAL_DIR REMOTE: sync one partitioned table, recent days with a
# short cache lifetime and the rest with a long one.
upload() {
    src=$1
    dst=$2
    rclone copy "$src" "$dst" \
        --include "**/day=$today/**" --include "**/day=$yesterday/**" \
        --header-upload "Content-Encoding: gzip" \
        --header-upload "Content-Type: text/csv; charset=utf-8" \
        --header-upload "Cache-Control: $short_cache"
    # Excluded paths are also spared from sync's deletions, so the recent
    # days uploaded above stay put.
    rclone sync "$src" "$dst" \
        --exclude "**/day=$today/**" --exclude "**/day=$yesterday/**" \
        --header-upload "Content-Encoding: gzip" \
        --header-upload "Content-Type: text/csv; charset=utf-8" \
        --header-upload "Cache-Control: $long_cache" \
        --max-age 14d
    # The day that just aged out of "recent" was last uploaded with the
    # short lifetime and won't change again; re-upload it once (a small
    # file per site) so it gets the long one. rclone only applies headers
    # on upload, hence --ignore-times.
    rclone copy "$src" "$dst" \
        --include "**/day=$settled/**" --ignore-times \
        --header-upload "Content-Encoding: gzip" \
        --header-upload "Content-Type: text/csv; charset=utf-8" \
        --header-upload "Cache-Control: $long_cache"
}

# Optional: how many days of swell_partition/swell_spectrum to export
# (default 14). Pass a bigger number once after swell/backfill.sh.
buoy_days=${1:-14}

export=`pwd`/export-conditions.sql
cd $lake
duckdb --init init.sql -cmd "set variable buoy_export_days = $buoy_days;" < $export

find "$wind" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" ts
    done

upload "$wind" s3:db.downwind.pro/wind/

find "$swell" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" ts
    done

upload "$swell" s3:db.downwind.pro/swell/

find "$swell_partition" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" ts
    done

upload "$swell_partition" s3:db.downwind.pro/swell_partition/

find "$swell_spectrum" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" ts
    done

upload "$swell_spectrum" s3:db.downwind.pro/swell_spectrum/
