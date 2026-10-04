'use strict';

const express = require('express');

/** Health, readiness, version, metrics and (non-production) chaos endpoints. */
function systemRouter({ config, metrics, store, startedAt }) {
  const router = express.Router();

  // Liveness: the process is up and the event loop responds.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: config.appEnv, version: config.version, uptimeSeconds: Math.round(process.uptime()) });
  });

  // Readiness: dependencies are usable (here: the store is seeded).
  router.get('/ready', (_req, res) => {
    const ready = store.count('items') > 0;
    res.status(ready ? 200 : 503).json({ ready, items: store.count('items') });
  });

  router.get('/api/version', (_req, res) => {
    res.json({ version: config.version, commit: config.gitCommit, env: config.appEnv, startedAt });
  });

  router.get('/metrics', async (_req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.send(await metrics.register.metrics());
  });

  // Incident simulation for monitoring demos. Only mounted when CHAOS_ENABLED=true
  // (staging), never in production.
  if (config.chaosEnabled) {
    router.get('/api/chaos/error', () => {
      throw new Error('Simulated failure (chaos endpoint)');
    });
    router.get('/api/chaos/slow', async (req, res) => {
      const ms = Math.min(Number.parseInt(req.query.ms ?? '1500', 10) || 1500, 5000);
      await new Promise((resolve) => { setTimeout(resolve, ms); });
      res.json({ delayedMs: ms });
    });
  }

  return router;
}

module.exports = { systemRouter };
