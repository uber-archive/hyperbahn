#!/usr/bin/env bash
set -e

find test \
    -name '*.js' \
    -not -path 'test/lib/*' \
    -not -path 'test/time-series/constant-low-volume*' \
    -not -path 'test/todo.js' \
    -not -path 'test/index.js' \
    -not -path 'test/reap-time.js' |
while read FILE; do
    if ! git grep -l "require.*\./${FILE#*/}" | grep -q 'test/index' ; then
        echo "Could not find $FILE" >&2
        exit 1
    fi
done

echo "All tests included!"
