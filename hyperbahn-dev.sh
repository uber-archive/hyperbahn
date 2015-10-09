#!/bin/sh 
set -e

H0="127.0.0.1:21300"
H1="127.0.0.1:21301"

if [ ! -d ./node_modules ]; then
  npm install
fi

./setup-dotfiles.sh $H0 $H1

tmux new-session -s 'hyperbahn' -n 'hyperbahn-0' \; \
    new-window -n 'hyperbahn-1' \; \
    new-window -n 'hyperbahn-adhoc' \; \
    select-window -t hyperbahn-0 \; \
    send-keys 'make run-local-0' Enter \; \
    select-window -t hyperbahn-1 \; \
    send-keys 'make run-local-1' Enter \; \
    select-window -t hyperbahn-adhoc \; \
    send-keys "sleep 1; tcurl -p $H0 autobahn health_v1" Enter \; \
    send-keys "tcurl -p $H1 autobahn health_v1" Enter \; \
    send-keys "tcurl autobahn health_v1" Enter \; \
    attach
