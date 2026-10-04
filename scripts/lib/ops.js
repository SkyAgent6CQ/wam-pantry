'use strict';

/** Small helpers shared by the pipeline's Node scripts (no dependencies). */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeoutMs || 5000) });
  const text = await res.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, body };
}

/** Repeats `check` until it returns a truthy value or the timeout expires. */
async function pollUntil(check, { timeoutMs = 60000, intervalMs = 2000, label = 'condition' } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await check();
      if (result) return { result, elapsedMs: Date.now() - start };
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  const reason = lastError ? ` (last error: ${lastError.message})` : '';
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${label}${reason}`);
}

async function promQuery(promUrl, query) {
  const { body } = await fetchJson(`${promUrl}/api/v1/query?query=${encodeURIComponent(query)}`);
  if (body?.status !== 'success') throw new Error(`Prometheus query failed: ${query}`);
  return body.data.result;
}

async function activeAlerts(alertmanagerUrl, alertname) {
  const filter = alertname ? `&filter=${encodeURIComponent(`alertname="${alertname}"`)}` : '';
  const { body } = await fetchJson(`${alertmanagerUrl}/api/v2/alerts?active=true&silenced=false&inhibited=false${filter}`);
  return Array.isArray(body) ? body : [];
}

async function postAlert(alertmanagerUrl, { labels, annotations, durationMs = 2 * 60 * 1000 }) {
  const now = new Date();
  const payload = [{
    labels,
    annotations,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + durationMs).toISOString(),
  }];
  return fetchJson(`${alertmanagerUrl}/api/v2/alerts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

module.exports = { sleep, fetchJson, pollUntil, promQuery, activeAlerts, postAlert };
