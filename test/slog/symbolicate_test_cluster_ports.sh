#!/bin/bash
set -e

file=$1
[ -n "$file" ]

prog="sed $file -e '/TEST SETUP/d' $(
  grep '^TEST SETUP:' "$file" |
  cut -d ':' -f2- |
  awk "{print \"-e 's/\" \$2 \"/\" \$1 \"/g'\"}" |
  tr '\n' ' '
)"
# echo "$prog" >&2
eval "$prog"
