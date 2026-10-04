'use strict';

/**
 * alert-notifier: the team's alert channel.
 *  - Receives Alertmanager webhooks on POST /alerts
 *  - Logs each alert, keeps the latest 100 in memory and shows them at GET /
 *  - Optionally forwards to Slack/Discord/Teams via ALERT_WEBHOOK_URL
 * Dependency-free on purpose (tiny image, nothing to patch).
 */
const http = require('node:http');

const PORT = Number(process.env.PORT || 9095);
const WEBHOOK = process.env.ALERT_WEBHOOK_URL || '';
const MAX = 100;
const inbox = [];

const ICON = { critical: '🔴', warning: '🟠', info: '🔵' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function format(alert) {
  const { labels = {}, annotations = {}, status } = alert;
  const icon = status === 'resolved' ? '✅' : (ICON[labels.severity] || '⚪');
  return `${icon} [${String(status).toUpperCase()}] ${labels.alertname} (env=${labels.env || '-'}, severity=${labels.severity || '-'}) — ${annotations.summary || ''}`;
}

async function forward(text) {
  if (!WEBHOOK) return;
  try {
    // "text" is read by Slack/Teams, "content" by Discord.
    await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text }) });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'forward_failed', error: err.message }));
  }
}

function render() {
  const rows = inbox.map((a) => `<tr class="${esc(a.status)} ${esc(a.labels.severity)}"><td>${esc(a.receivedAt.slice(0, 19).replace('T', ' '))}</td>
<td>${esc(a.status)}</td><td>${esc(a.labels.severity)}</td><td>${esc(a.labels.alertname)}</td><td>${esc(a.labels.env)}</td>
<td>${esc(a.annotations.summary)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5">
<title>WAM alerts inbox</title><style>
body{font-family:system-ui,sans-serif;margin:24px;background:#0f172a;color:#e2e8f0}h1{font-size:20px}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:8px 10px;border-bottom:1px solid #334155;text-align:left}
tr.firing.critical td{background:#7f1d1d}tr.firing.warning td{background:#78350f}tr.firing.info td{background:#1e3a8a}tr.resolved td{background:#14532d}
.muted{color:#94a3b8;font-size:13px}</style></head><body>
<h1>WAM Pantry — team alerts inbox</h1><p class="muted">Latest ${inbox.length} notifications from Alertmanager (auto-refreshes every 5s).
Forwarding to external webhook: ${WEBHOOK ? 'ON' : 'OFF'}</p>
<table><tr><th>Received (UTC)</th><th>Status</th><th>Severity</th><th>Alert</th><th>Env</th><th>Summary</th></tr>${rows || '<tr><td colspan="6">No alerts yet.</td></tr>'}</table>
</body></html>`;
}

function handleAlerts(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);
      const alerts = payload.alerts || [];
      alerts.forEach((a) => {
        const entry = { ...a, receivedAt: new Date().toISOString() };
        inbox.unshift(entry);
        console.log(JSON.stringify({ level: 'info', msg: 'alert', text: format(a) }));
      });
      inbox.splice(MAX);
      await forward(alerts.map(format).join('\n'));
      res.writeHead(200).end('ok');
    } catch {
      res.writeHead(400).end('invalid payload');
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/alerts') return handleAlerts(req, res);
  if (req.method === 'GET' && req.url === '/api/alerts') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(inbox));
  }
  if (req.method === 'GET' && req.url === '/health') return res.writeHead(200).end('ok');
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(render());
  }
  return res.writeHead(404).end('not found');
});

server.listen(PORT, () => console.log(JSON.stringify({ level: 'info', msg: 'alert-notifier listening', port: PORT, forwarding: Boolean(WEBHOOK) })));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
