'use strict';

/**
 * Pipeline notifications. Sends the build result through Alertmanager so the
 * team gets pipeline events and production alerts in the same channel.
 * Falls back to a direct webhook (ALERT_WEBHOOK_URL) if Alertmanager is down.
 *
 *   node scripts/notify.js <success|failure|unstable>
 */
const { postAlert, fetchJson } = require('./lib/ops');
const { ALERTMANAGER_URL: AM } = require('./lib/endpoints');
const status = process.argv[2] || 'unknown';
const { JOB_NAME = 'local', BUILD_NUMBER = '0', BUILD_URL = '', VERSION = 'unknown', FAILED_STAGE = '' } = process.env;

const failed = status === 'failure';
const summary = failed
  ? `Pipeline ${JOB_NAME} #${BUILD_NUMBER} FAILED${FAILED_STAGE ? ` at stage "${FAILED_STAGE}"` : ''} (version ${VERSION})`
  : `Pipeline ${JOB_NAME} #${BUILD_NUMBER} ${status.toUpperCase()} (version ${VERSION})`;

async function main() {
  console.log(summary);
  try {
    const r = await postAlert(AM, {
      labels: { alertname: failed ? 'PipelineFailed' : 'PipelineFinished', severity: failed ? 'warning' : 'info', env: 'ci', job: JOB_NAME, source: 'jenkins' },
      annotations: { summary, build_url: BUILD_URL },
      durationMs: failed ? 10 * 60 * 1000 : 60 * 1000,
    });
    if (r.ok) return console.log('Notification sent via Alertmanager.');
    throw new Error(`Alertmanager returned ${r.status}`);
  } catch (err) {
    console.log(`Alertmanager unavailable (${err.message}).`);
  }
  if (process.env.ALERT_WEBHOOK_URL) {
    await fetchJson(process.env.ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `${summary}\n${BUILD_URL}`, content: `${summary}\n${BUILD_URL}` }),
    }).catch((e) => console.log(`Webhook failed: ${e.message}`));
    console.log('Notification sent directly to ALERT_WEBHOOK_URL.');
  }
}

main();
