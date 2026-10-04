#!/usr/bin/env bash

#  One-command setup for the CI/CD lab (run from the repo root, needs Docker):
#     cp infra/.env.example infra/.env   # then edit it
#     ./infra/bootstrap.sh
#
#  1. Creates the shared Docker network "devops-net"
#  2. Starts SonarQube + private registry
#  3. Configures SonarQube via its Web API: admin password, project,
#     custom quality gate, Jenkins webhook, analysis token
#  4. Builds and starts Jenkins (plugins, credentials and job come from JCasC)
#  Safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/infra/.env"
SONAR="http://localhost:9000"
PROJECT_KEY="wam-pantry"
GATE="WAM Pantry Gate"

[[ -f "$ENV_FILE" ]] || { echo "Missing infra/.env — run: cp infra/.env.example infra/.env (then edit it)"; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${SONAR_ADMIN_PASSWORD:?set SONAR_ADMIN_PASSWORD in infra/.env}"

compose() { docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ENV_FILE" "$@"; }
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "Creating Docker network devops-net"
docker network inspect devops-net >/dev/null 2>&1 || docker network create devops-net

say "Starting SonarQube and the private registry"
compose up -d sonarqube registry

say "Waiting for SonarQube to be UP (first start takes 1-3 minutes)"
until curl -fs "$SONAR/api/system/status" 2>/dev/null | grep -q '"status":"UP"'; do printf '.'; sleep 5; done
echo " up"

# Use the new admin password if it was already changed on a previous run.
if curl -fs -u "admin:$SONAR_ADMIN_PASSWORD" "$SONAR/api/authentication/validate" | grep -q '"valid":true'; then
  AUTH="admin:$SONAR_ADMIN_PASSWORD"
else
  say "Changing the default SonarQube admin password"
  curl -fs -u admin:admin -X POST "$SONAR/api/users/change_password" \
    --data-urlencode "login=admin" --data-urlencode "previousPassword=admin" \
    --data-urlencode "password=$SONAR_ADMIN_PASSWORD"
  AUTH="admin:$SONAR_ADMIN_PASSWORD"
fi
api() { curl -s -u "$AUTH" -X POST "$SONAR/api/$1" "${@:2}"; }

say "Creating project $PROJECT_KEY"
api projects/create --data-urlencode "project=$PROJECT_KEY" --data-urlencode "name=WAM Pantry API" >/dev/null || true

say "Creating custom quality gate: $GATE"
api qualitygates/create --data-urlencode "name=$GATE" >/dev/null || true
# add_condition <op> <threshold> <metric> [fallback metric for newer SonarQube MQR mode]
add_condition() {
  local op="$1" error="$2"; shift 2
  for metric in "$@"; do
    if api qualitygates/create_condition --data-urlencode "gateName=$GATE" \
         --data-urlencode "metric=$metric" --data-urlencode "op=$op" --data-urlencode "error=$error" \
         | grep -q '"id"'; then
      echo "   + $metric $op $error"; return 0
    fi
  done
  echo "   = condition on $1 already present (or not supported)"
}
add_condition LT 80 coverage                       # overall line+branch coverage >= 80%
add_condition LT 80 new_coverage                   # new code coverage >= 80%
add_condition GT 3  duplicated_lines_density       # <= 3% duplicated lines
add_condition GT 1  sqale_rating       software_quality_maintainability_rating   # Maintainability = A
add_condition GT 1  reliability_rating software_quality_reliability_rating       # Reliability = A
add_condition GT 1  security_rating    software_quality_security_rating          # Security = A
api qualitygates/select --data-urlencode "gateName=$GATE" --data-urlencode "projectKey=$PROJECT_KEY" >/dev/null

say "Registering the Jenkins webhook (lets waitForQualityGate return instantly)"
if ! curl -s -u "$AUTH" "$SONAR/api/webhooks/list" | grep -q 'sonarqube-webhook'; then
  api webhooks/create --data-urlencode "name=jenkins" --data-urlencode "url=http://jenkins:8080/sonarqube-webhook/" >/dev/null
fi

if [[ -z "${SONAR_TOKEN:-}" ]]; then
  say "Generating a SonarQube analysis token for Jenkins"
  RESPONSE="$(api user_tokens/generate --data-urlencode "name=jenkins-$(date +%s)" --data-urlencode "type=GLOBAL_ANALYSIS_TOKEN")"
  SONAR_TOKEN="$(printf '%s' "$RESPONSE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  [[ -n "$SONAR_TOKEN" ]] || { echo "Token generation failed: $RESPONSE"; exit 1; }
  if grep -q '^SONAR_TOKEN=' "$ENV_FILE"; then
    sed -i.bak "s|^SONAR_TOKEN=.*|SONAR_TOKEN=$SONAR_TOKEN|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "SONAR_TOKEN=$SONAR_TOKEN" >> "$ENV_FILE"
  fi
  echo "   token saved to infra/.env"
fi

say "Building and starting Jenkins (first build of the image takes a few minutes)"
compose up -d --build jenkins

say "Waiting for Jenkins"
until curl -fs -o /dev/null "http://localhost:8080/login"; do printf '.'; sleep 5; done
echo " up"

cat <<EOF

  Jenkins     http://localhost:8080   (admin / JENKINS_ADMIN_PASSWORD from infra/.env)
  SonarQube   http://localhost:9000   (admin / SONAR_ADMIN_PASSWORD)
  Registry    http://localhost:5000/v2/_catalog

  The job "wam-pantry" is already created. Click "Build with Parameters" once
  (the first run registers the parameters); after that every push to main
  is picked up automatically within ~2 minutes.

  After the first successful run:
  Staging http://localhost:3001  Production http://localhost:3000
  Grafana http://localhost:3030  Prometheus http://localhost:9090  Alerts http://localhost:9095
EOF
