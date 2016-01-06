#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PUBLIC_IP="$(node scripts/public-ip.js)"

H0="$PUBLIC_IP:21300"
H1="$PUBLIC_IP:21301"
H2="$PUBLIC_IP:21302"
H3="$PUBLIC_IP:21303"
H4="$PUBLIC_IP:21304"

tmux new-session -s 'hyperbahn' -n 'hyperbahn-0' \; \
    new-window -n 'hyperbahn-1' \; \
    new-window -n 'hyperbahn-2' \; \
    new-window -n 'hyperbahn-3' \; \
    new-window -n 'hyperbahn-4' \; \
    new-window -n 'hyperbahn-adhoc' \; \
    send -t hyperbahn-0 'make run-staging-0' Enter \; \
    send -t hyperbahn-1 'make run-staging-1' Enter \; \
    send -t hyperbahn-2 'make run-staging-2' Enter \; \
    send -t hyperbahn-3 'make run-staging-3' Enter \; \
    send -t hyperbahn-4 'make run-staging-4' Enter \; \
    select-window -t hyperbahn-adhoc \; \
    send "tcurl -p $H0 autobahn health_v1" Enter \; \
    send "tcurl -p $H4 autobahn health_v1" Enter \;
