#!/bin/sh -e

lake=$HOME/stuff/duck

export=`pwd`/export-runs.sql
cd $lake
duckdb --init init.sql < $export
