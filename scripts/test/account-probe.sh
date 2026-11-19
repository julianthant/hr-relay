#!/usr/bin/env bash
set -eu
export ACCOUNT_PROFILES="$RUNNER_TEMP/account-profiles/$1"
mkdir -p "$ACCOUNT_PROFILES"
setsid node node_modules/vitest/vitest.mjs run --project unit --reporter=verbose "$TEST_FILE" &
runner=$!
while kill -0 "$runner" 2>/dev/null; do
  date -u +%FT%T.%3NZ
  ps -ww -s "$runner" -o pid,ppid,rss,args || true
  sleep 2
done
wait "$runner"
