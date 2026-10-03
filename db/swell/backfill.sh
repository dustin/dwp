#!/bin/sh -e
#
# Recompute swell_partition from the stored archive (swell_spectrum plus the
# rank 1 NDBC observations already in swell_partition), without fetching
# anything from NDBC. Run it after changing the derivation in update.sql.
#
# usage: swell/backfill.sh [SINCE [UNTIL]]
#   SINCE/UNTIL are anything DuckDB casts to timestamptz, e.g.
#   '2026-09-30 00:00:00-10'. Give the offset: a bare date is read in the
#   session's time zone. Both default to everything. Readings with no
#   archived spectrum to work from are left as they are.
#
# For the spectrum pairing fix (hh:00 spectrum <-> the :56 report before
# it), do it in this order:
#   1. Run update.sql as usual. Besides the normal update, that replaces
#      the provisional :26 spectra the archive picked up since early
#      September with NDBC's final :56 ones, while NDBC still has them.
#   2. swell/backfill.sh -- recomputes everything older than NDBC's window.
#   3. ./upload-conditions.sh 120 -- the normal export only covers 14 days.
#   4. Invalidate /swell_partition/* and /swell_spectrum/* in CloudFront.
#      Settled days are served with a year-long cache lifetime (see
#      upload-conditions.sh), so rewritten ones won't show up otherwise.
#
# Runs against the lake the same way import.sh does; set LAKE to point
# elsewhere.

here=`cd "$(dirname "$0")" && pwd`
lake=${LAKE:-$HOME/stuff/duck}

# update.sql still opens the NDBC realtime files while planning even though
# a backfill discards them, so hand it empty local stand-ins instead.
empty=`mktemp -d`
trap 'rm -rf "$empty"' EXIT
for ext in txt data_spec swdir swr1; do
    echo '#' > "$empty/51205.$ext"
done

vars="set variable mode = 'backfill'; set variable ndbc_base = '$empty/';"
if [ -n "$1" ]; then
    vars="$vars set variable since = '$1'::timestamptz;"
fi
if [ -n "$2" ]; then
    vars="$vars set variable until = '$2'::timestamptz;"
fi

cd "$lake"
duckdb --init init.sql -cmd "$vars" < "$here/update.sql"
