#!/usr/bin/env bash
# Stops everything. Add --volumes to also delete Jenkins/SonarQube/registry/Grafana data.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLAG="${1:-}"
for p in wam-production wam-staging; do docker compose -p "$p" -f "$ROOT/deploy/docker-compose.yml" down $FLAG 2>/dev/null; done
docker compose -p wam-monitoring -f "$ROOT/monitoring/docker-compose.yml" down $FLAG
docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ROOT/infra/.env" down $FLAG
echo "Stopped. (Network devops-net kept; remove with: docker network rm devops-net)"
