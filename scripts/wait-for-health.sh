#!/usr/bin/env bash
# Polls a health URL until it returns HTTP 200 or the timeout (seconds) expires.
#   scripts/wait-for-health.sh <url> [timeout_seconds]
set -uo pipefail
URL="${1:?usage: wait-for-health.sh <url> [timeout]}"
TIMEOUT="${2:-60}"
DEADLINE=$(( $(date +%s) + TIMEOUT ))

until curl -fsS --max-time 3 "$URL" >/dev/null 2>&1; do
  if (( $(date +%s) >= DEADLINE )); then
    echo "!! ${URL} not healthy after ${TIMEOUT}s" >&2
    exit 1
  fi
  sleep 2
done
echo "    ${URL} -> healthy"
