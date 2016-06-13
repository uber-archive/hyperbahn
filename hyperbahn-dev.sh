#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

H0="127.0.0.1:21300"
H1="127.0.0.1:21301"

if [ ! -d $DIR/node_modules ]; then
  npm install
fi

export LOCAL_BIN=$DIR/node_modules/.bin

if [ ! -w `npm config get prefix` ]; then
    command -v tcurl >/dev/null 2>&1 || npm install tcurl --global
else
    command -v $LOCAL_BIN/tcurl >/dev/null 2>&1 || npm install tcurl 
fi

$DIR/setup-dotfiles.sh $H0 $H1

tmux new-session -s 'hyperbahn' \; \
    new-window -n 'hyperbahn-0' \; \
    new-window -n 'hyperbahn-1' \; \
    new-window -n 'hyperbahn-adhoc' \; \
    select-window -t hyperbahn-adhoc \; \
    send "sleep 1" Enter \; \
    select-window -t hyperbahn-0 \; \
    send "sleep 1; make run-local-0" Enter \; \
    select-window -t hyperbahn-1 \; \
    send "make run-local-1" Enter \; \
    select-window -t hyperbahn-adhoc \; \
    send "sleep 1; command -v $LOCAL_BIN/tcurl >/dev/null 2>&1 && export PATH=$LOCAL_BIN:\$PATH" Enter \; \
    send "tcurl -p $H0 autobahn health_v1" Enter \; \
    send "tcurl -p $H1 autobahn health_v1" Enter \; \
    send "tcurl autobahn health_v1" Enter
