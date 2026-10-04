'use strict';

const { createApp } = require('./app');

async function main() {
  const { app, config, logger, services } = createApp();
  await services.userService.ensureAdmin();

  const server = app.listen(config.port, () => {
    logger.info('server_started', { port: config.port });
  });

  // Graceful shutdown so `docker stop` / redeploys don't drop in-flight requests.
  const shutdown = (signal) => {
    logger.info('shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'startup_failed', error: err.message }));
  process.exit(1);
});
