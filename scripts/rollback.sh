#!/usr/bin/env bash
# Rolls an environment back to the image that was running before the last deploy
# (recorded by deploy.sh), or to an explicit image.
#
#   scripts/rollback.sh <staging|production> [image]
set -euo pipefail
ENVIRONMENT="${1:?usage: rollback.sh <staging|production> [image]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${2:-$(cat "$ROOT/reports/previous-${ENVIRONMENT}.txt" 2>/dev/null || true)}"

if [[ -z "$TARGET" ]]; then
  echo "!! No previous image recorded for ${ENVIRONMENT}; nothing to roll back to." >&2
  exit 1
fi
echo "==> Rolling back ${ENVIRONMENT} to ${TARGET}"
NO_ROLLBACK=1 "$ROOT/scripts/deploy.sh" "$ENVIRONMENT" "$TARGET"
