'use strict';

/**
 * Incident drill: deliberately breaks something and measures how long the
 * monitoring stack takes to detect it (time-to-detect) and to clear after
 * recovery (time-to-recover).
 *
 *   node scripts/simulate-incident.js app-down     # stops the production container
 *   node scripts/simulate-incident.js error-rate   # floods staging's chaos endpoint with 500s
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pollUntil, activeAlerts, fetchJson } = require('./lib/ops');
const { ALERTMANAGER_URL: AM, APP_URLS, DOCKER_BIN } = require('./lib/endpoints');

const DRILLS = {
  'app-down': { alert: 'PantryApiDown', env: 'production', container: 'pantry-prod', url: APP_URLS.production },
  'error-rate': { alert: 'PantryHighErrorRate', env: 'staging', container: 'pantry-staging', url: APP_URLS.staging },
};

const isFiring = async (alert, env) => (await activeAlerts(AM, alert)).some((a) => a.labels.env === env);
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

function docker(...args) {
  execFileSync(DOCKER_BIN, args, { stdio: 'inherit' });
}

/** Sends 5 failing requests every second in the background; returns a stop() function. */
function startErrorFlood(url) {
  const burst = () => Array.from({ length: 5 }, () => fetch(`${url}/api/chaos/error`).catch(() => null));
  const timer = setInterval(burst, 1000);
  burst();
  return () => clearInterval(timer);
}

async function run(type) {
  const drill = DRILLS[type];
  if (!drill) throw new Error(`Unknown drill "${type}". Use: ${Object.keys(DRILLS).join(', ')}`);
  const report = { type, ...drill, startedAt: new Date().toISOString() };

  log(`INCIDENT DRILL: ${type} → expecting alert ${drill.alert} (env=${drill.env})`);
  let stopFlood = () => {};
  try {
    if (type === 'app-down') {
      log(`Stopping container ${drill.container} to simulate an outage...`);
      docker('stop', drill.container);
    } else {
      log(`Sending 5 failing requests/second to ${drill.url}/api/chaos/error ...`);
      stopFlood = startErrorFlood(drill.url);
    }

    const detected = await pollUntil(() => isFiring(drill.alert, drill.env), { timeoutMs: 180000, intervalMs: 3000, label: `${drill.alert} to fire` });
    report.timeToDetectSeconds = Math.round(detected.elapsedMs / 1000);
    log(`DETECTED: ${drill.alert} is firing after ${report.timeToDetectSeconds}s — the team has been notified.`);
  } finally {
    log('Recovering...');
    stopFlood();
    if (type === 'app-down') docker('start', drill.container);
  }

  await pollUntil(async () => (await fetchJson(`${drill.url}/health`)).ok, { timeoutMs: 60000, label: 'service healthy' });
  log('Service healthy again. Waiting for the alert to resolve...');
  const resolved = await pollUntil(async () => !(await isFiring(drill.alert, drill.env)), { timeoutMs: 240000, intervalMs: 5000, label: `${drill.alert} to resolve` });
  report.timeToResolveSeconds = Math.round(resolved.elapsedMs / 1000);
  log(`RESOLVED: ${drill.alert} cleared ${report.timeToResolveSeconds}s after recovery (resolved notification sent).`);

  const out = path.join(__dirname, '..', 'reports', `incident-drill-${type}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ ...report, finishedAt: new Date().toISOString() }, null, 2));
  log(`Drill report written to ${path.relative(process.cwd(), out)}`);
}

run(process.argv[2] || 'app-down').catch((err) => {
  console.error(`Incident drill failed: ${err.message}`);
  process.exit(1);
});
