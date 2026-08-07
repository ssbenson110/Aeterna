#!/usr/bin/env bash
# Start AETERNA in the background and write a pid file.
cd "$(dirname "$0")/.."
[ -f data/server.pid ] && kill "$(cat data/server.pid)" 2>/dev/null
AETERNA_DEMO=${AETERNA_DEMO:-1} AETERNA_RATE_MULTIPLIER=${AETERNA_RATE_MULTIPLIER:-20} PORT=${PORT:-4173} nohup node server/index.js > /tmp/aeterna.log 2>&1 &
echo $! > data/server.pid
sleep 1.5
curl -sf "http://localhost:${PORT:-4173}/api/health" && echo " <- ready"
