#!/bin/sh 
set -e

HOSTS=$@

HYPERBAHN_HOSTS_JSON=$HOME/.hyperbahn-hosts.json
TCURLRC=$HOME/.tcurlrc;

# comma and newline separated quoted list with 4-space indent
HOSTS_CSV=$(printf -- "    \"%s\",\n" ${HOSTS[*]} | sed '$s/\,//')

if [ ! -f $HYPERBAHN_HOSTS_JSON ]; then
cat << EOF > $HYPERBAHN_HOSTS_JSON
[
$HOSTS_CSV
]
EOF
fi

if [ ! -f $TCURLRC ]; then
cat << EOF > $TCURLRC
{
    "hostlist": "$HYPERBAHN_HOSTS_JSON"
}
EOF
fi
