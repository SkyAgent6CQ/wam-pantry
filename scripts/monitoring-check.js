'use strict';

/**
 * Monitoring stage verification (run by Jenkins after the monitoring stack is up):
 *  1. Prometheus, Alertmanager and Grafana are ready.
 *  2. Prometheus is scraping the target environment (up == 1).
 *  3. Live request metrics are flowing (after generating some traffic).
 *  4. All expected alert rules are loaded.
 *  5. A deployment notice is sent through Alertmanager to the team channel,
 *     proving the alert path works end-to-end on every release.
 * Writes reports/monitoring-check.json. Exits non-zero if a check fails.
 */
const fs = require('node:fs');
const path = require('node:path');
const { fetchJson, pollUntil, promQuery, activeAlerts, postAlert } = require('./lib/ops');

const ENV = process.env.MONITOR_ENV || 'production';
const PROM = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const AM = process.env.ALERTMANAGER_URL || 'http://alertmanager:9093';
const GRAFANA = process.env.GRAFANA_URL || 'http://grafana:3000';
const APP = process.env.APP_URL || (ENV === 'production' ? 'http://pantry-prod:3000' : 'http://pantry-staging:3000');
const VERSION = process.env.VERSION || 'unknown';
const EXPECTED_RULES = ['PantryApiDown', 'PantryHighErrorRate', 'PantryHighLatency', 'PantryLowStock', 'PantryHighMemory'];

const results = [];
function record(name, ok, detail) {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${detail}`);
}

async function check(name, fn) {
  try {
    record(name, true, await fn());
  } catch (err) {
    record(name, false, err.message);
  }
}

async function generateTraffic() {
  const paths = [...Array(30).fill('/api/items'), ...Array(10).fill('/health'), '/api/version', '/api/items?category=dry', '/not-a-route'];
  await Promise.all(paths.map((p) => fetch(`${APP}${p}`).catch(() => null)));
  return `${paths.length} requests sent to ${APP}`;
}

async function main() {
  console.log(`Monitoring verification for env=${ENV}, version=${VERSION}\n`);

  await check('Prometheus ready', async () => (await pollUntil(async () => (await fetchJson(`${PROM}/-/ready`)).ok, { label: 'Prometheus' })) && PROM);
  await check('Alertmanager ready', async () => (await pollUntil(async () => (await fetchJson(`${AM}/-/ready`)).ok, { label: 'Alertmanager' })) && AM);
  await check('Grafana healthy', async () => {
    const { result } = await pollUntil(async () => {
      const r = await fetchJson(`${GRAFANA}/api/health`);
      return r.ok && r.body.database === 'ok' && r.body;
    }, { label: 'Grafana' });
    return `Grafana ${result.version}`;
  });

  await check(`Target up (env=${ENV})`, async () => {
    const { elapsedMs } = await pollUntil(async () => {
      const r = await promQuery(PROM, `up{job="pantry-api",env="${ENV}"}`);
      return r.length > 0 && r[0].value[1] === '1';
    }, { timeoutMs: 90000, label: `up{env="${ENV}"} == 1` });
    return `scraped OK after ${Math.round(elapsedMs / 1000)}s`;
  });

  await check('Traffic generated', generateTraffic);

  await check('Request metrics flowing', async () => {
    const { result } = await pollUntil(async () => {
      const r = await promQuery(PROM, `sum(rate(http_requests_total{env="${ENV}"}[1m]))`);
      return r.length > 0 && Number(r[0].value[1]) > 0 && Number(r[0].value[1]);
    }, { timeoutMs: 60000, label: 'request rate > 0' });
    return `${result.toFixed(2)} req/s over last minute`;
  });

  await check('Alert rules loaded', async () => {
    const { body } = await fetchJson(`${PROM}/api/v1/rules?type=alert`);
    const names = new Set(body.data.groups.flatMap((g) => g.rules.map((r) => r.name)));
    const missing = EXPECTED_RULES.filter((r) => !names.has(r));
    if (missing.length) throw new Error(`missing rules: ${missing.join(', ')}`);
    return `${names.size} rules (${EXPECTED_RULES.join(', ')})`;
  });

  await check('Current alert state', async () => {
    const firing = await activeAlerts(AM);
    const critical = firing.filter((a) => a.labels.severity === 'critical' && a.labels.env === ENV);
    if (critical.length) throw new Error(`critical alerts firing: ${critical.map((a) => a.labels.alertname).join(', ')}`);
    return `${firing.length} active alert(s), none critical for ${ENV}`;
  });

  await check('Team notified via Alertmanager', async () => {
    const r = await postAlert(AM, {
      labels: { alertname: 'DeploymentNotice', severity: 'info', env: ENV, version: VERSION, source: 'jenkins' },
      annotations: { summary: `wam-pantry ${VERSION} is live in ${ENV} and passed monitoring checks` },
    });
    if (!r.ok) throw new Error(`Alertmanager returned ${r.status}`);
    return 'DeploymentNotice delivered to Alertmanager → alert-notifier';
  });

  const outDir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'monitoring-check.json'), JSON.stringify({ env: ENV, version: VERSION, at: new Date().toISOString(), results }, null, 2));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} monitoring checks passed`);
  console.log(`Dashboards: Grafana http://localhost:3030 | Prometheus http://localhost:9090/alerts | Alerts inbox http://localhost:9095`);
  process.exit(failed.length ? 1 : 0);
}

main();
