#!/bin/sh 
set -e

tmux new-session -s 'hyperbahn' -n 'hyperbahn-0' \; \
    new-window -n 'hyperbahn-1' \; \
    new-window -n 'hyperbahn-adhoc' \; \
    select-window -t:0 \; \
    send-keys 'make run-local-0' Enter \; \
    select-window -t:1 \; \
    send-keys 'make run-local-1' Enter \; \
    select-window -t:2 \; \
    send-keys 'sleep 1; tcurl -p 127.0.0.1:21300 autobahn health_v1' Enter \; \
    send-keys 'tcurl -p 127.0.0.1:21301 autobahn health_v1' Enter \; \
    attach
