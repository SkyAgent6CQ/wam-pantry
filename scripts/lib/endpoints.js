'use strict';

/**
 * Internal service endpoints and tool paths used by the pipeline scripts.
 *
 * Transport: these services talk over the private Docker bridge network
 * "devops-net" on a single host; the traffic never leaves the machine and none
 * of the lab services terminate TLS, so the internal scheme defaults to plain
 * HTTP. In a real deployment set INTERNAL_SCHEME=https (behind a TLS proxy or
 * service mesh). Reviewed for SonarQube rule S5332 — see docs/SECURITY.md.
 *
 * Binaries: commands are invoked by absolute path rather than via the PATH
 * lookup, so a writable directory on PATH cannot substitute a malicious
 * executable (SonarQube rule S4036). Override with GIT_BIN / DOCKER_BIN.
 */
const env = process.env;
const SCHEME = env.INTERNAL_SCHEME || 'http';
const internal = (host, port) => `${SCHEME}://${host}:${port}`;

module.exports = {
  PROMETHEUS_URL: env.PROMETHEUS_URL || internal('prometheus', 9090),
  ALERTMANAGER_URL: env.ALERTMANAGER_URL || internal('alertmanager', 9093),
  GRAFANA_URL: env.GRAFANA_URL || internal('grafana', 3000),
  APP_URLS: {
    production: env.PROD_APP_URL || internal('pantry-prod', 3000),
    staging: env.STAGING_APP_URL || internal('pantry-staging', 3000),
  },
  GIT_BIN: env.GIT_BIN || '/usr/bin/git',
  DOCKER_BIN: env.DOCKER_BIN || '/usr/bin/docker',
};
