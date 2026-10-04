'use strict';

/**
 * Minimal structured (JSON) logger. One JSON object per line is easy to ship
 * to any log aggregator and easy to grep in `docker logs`.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function createLogger({ level = 'info', base = {}, stream = process.stdout } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(lvl, msg, fields = {}) {
    if (LEVELS[lvl] < threshold) return;
    const entry = { time: new Date().toISOString(), level: lvl, msg, ...base, ...fields };
    stream.write(`${JSON.stringify(entry)}\n`);
  }

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}

module.exports = { createLogger, LEVELS };
