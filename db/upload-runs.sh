#!/bin/sh -e
# Kept for callers outside this repo: everything goes through ./publish now.
exec "$(dirname "$0")/publish"
