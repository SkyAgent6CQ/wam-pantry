#!/usr/bin/env bash
# Deploys an image to an environment with health verification and automatic rollback.
#
#   scripts/deploy.sh <staging|production> <image>
#
# Requires JWT_SECRET and ADMIN_PASSWORD in the environment (Jenkins injects them
# from its credential store). Assumes the external Docker network "devops-net".
set -euo pipefail

ENVIRONMENT="${1:?usage: deploy.sh <staging|production> <image>}"
IMAGE="${2:?usage: deploy.sh <staging|production> <image>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$ENVIRONMENT" in
  staging)    CONTAINER="pantry-staging"; PORT="${STAGING_PORT:-3001}" ;;
  production) CONTAINER="pantry-prod";    PORT="${PROD_PORT:-3000}" ;;
  *) echo "Unknown environment: $ENVIRONMENT" >&2; exit 2 ;;
esac

HEALTH_URL="${HEALTH_URL:-http://${CONTAINER}:3000/health}"
PROJECT="wam-${ENVIRONMENT}"
mkdir -p "$ROOT/reports"

export APP_IMAGE="$IMAGE" APP_ENV="$ENVIRONMENT" CONTAINER_NAME="$CONTAINER" HOST_PORT="$PORT"

compose() { docker compose -p "$PROJECT" -f "$ROOT/deploy/docker-compose.yml" "$@"; }

# Remember what is running now so we can roll back to it.
PREVIOUS="$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null || true)"
echo "${PREVIOUS}" > "$ROOT/reports/previous-${ENVIRONMENT}.txt"
echo "==> Deploying ${IMAGE} to ${ENVIRONMENT} (container ${CONTAINER}, host port ${PORT})"
echo "    Currently running: ${PREVIOUS:-<nothing>}"

docker network inspect devops-net >/dev/null 2>&1 || docker network create devops-net >/dev/null

if compose up -d --remove-orphans --wait --wait-timeout 90 \
   && "$ROOT/scripts/wait-for-health.sh" "$HEALTH_URL" 60; then
  echo "${IMAGE}" > "$ROOT/reports/deployed-${ENVIRONMENT}.txt"
  echo "==> ${ENVIRONMENT} is healthy on ${IMAGE}"
  exit 0
fi

echo "!! Deployment to ${ENVIRONMENT} failed health checks. Recent logs:" >&2
docker logs --tail 40 "$CONTAINER" 2>&1 || true

if [[ "${NO_ROLLBACK:-0}" != "1" && -n "$PREVIOUS" && "$PREVIOUS" != "$IMAGE" ]]; then
  echo "==> Rolling back ${ENVIRONMENT} to ${PREVIOUS}" >&2
  APP_IMAGE="$PREVIOUS" compose up -d --remove-orphans --wait --wait-timeout 90 \
    && echo "==> Rollback complete: ${ENVIRONMENT} is back on ${PREVIOUS}" >&2
else
  echo "!! No previous version to roll back to." >&2
fi
exit 1
