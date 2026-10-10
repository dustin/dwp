#!/bin/sh -e

# Export and publish runs for every rider.
#
#   ./upload-runs.sh            tracks from the last 14 days, all run lists
#   DWP_FULL=1 ./upload-runs.sh every track (after a CDN rebuild)
#
# The CDN layout, under s3:db.downwind.pro/runs/:
#
#   rider=<rider>/runs.csv          the run list (plus crashes.csv and
#   rider=<rider>/crashes.csv       run_buoy.csv), short cache: they change
#   rider=<rider>/run_buoy.csv      with every import
#   rider=<rider>/dwid=<id>/data.csv  one run's track
#
# Dustin's lists are also copied into web/rider/data/, which the site falls
# back to when the CDN copy can't be fetched.

lake=$HOME/stuff/duck
dwruns=/Users/dustin/stuff/dwruns/
dwlists=/Users/dustin/stuff/dwlists/
webdata=$(cd "$(dirname "$0")/../web/rider/data" && pwd)
db=$(cd "$(dirname "$0")" && pwd)

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

cd $lake
duckdb --init init.sql < $db/export-runs.sql

riders=`duckdb --init init.sql -noheader -list -c "use lake; select distinct rider from dwlist where rider is not null order by 1" |
    grep -E '^[a-z][a-z0-9-]*$'`
[ -n "$riders" ] || { echo "no riders in dwlist (run migrate-riders.sql)" >&2; exit 1; }

mkdir -p $dwlists
for rider in $riders; do
    echo "Lists for $rider"
    cd $lake
    duckdb --init init.sql -cmd "set variable rider = '$rider';" < $db/export-lists.sql
    if [ "$rider" = dustin ]; then
        cp $dwlists/runs.csv $dwlists/crashes.csv $dwlists/run_buoy.csv $webdata/
    fi
    mkdir -p "$dwruns/rider=$rider"
    for f in runs crashes run_buoy; do
        gzip -9 -n -c $dwlists/$f.csv > "$dwruns/rider=$rider/$f.csv"
    done
done

find "$dwruns" -type f -name 'data_0.csv' -print0 |
    while IFS= read -r -d '' file; do
        consolidate "$file" tsi
    done

# Tracks. The rider-level lists are excluded here (which also spares them
# from sync's deletions) and uploaded below with a short cache lifetime.
rclone sync $dwruns s3:db.downwind.pro/runs/ \
    --exclude "/rider=*/*.csv" \
    --header-upload "Content-Encoding: gzip" \
    --header-upload "Content-Type: text/csv; charset=utf-8" \
    --max-age 14d

rclone copy $dwruns s3:db.downwind.pro/runs/ \
    --include "/rider=*/*.csv" --ignore-times \
    --header-upload "Content-Encoding: gzip" \
    --header-upload "Content-Type: text/csv; charset=utf-8" \
    --header-upload "Cache-Control: public, max-age=300"
