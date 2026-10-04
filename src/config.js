'use strict';

/**
 * Centralized configuration. Every value can be overridden with an
 * environment variable so the same image runs in dev, staging and production
 * with only its environment changing (12-factor style).
 */
function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// [configKey, ENV_VAR, default, parser]. Secrets have no default in staging/production.
const SPEC = [
  ['port', 'PORT', 3000, toInt],
  ['version', 'APP_VERSION', 'dev'],
  ['gitCommit', 'GIT_COMMIT', 'unknown'],
  ['logLevel', 'LOG_LEVEL', 'info'],
  ['jwtExpiresIn', 'JWT_EXPIRES_IN', '1h'],
  ['adminEmail', 'ADMIN_EMAIL', 'admin@wam.local'],
  ['rateLimitPerMinute', 'RATE_LIMIT_PER_MINUTE', 300, toInt],
  ['lowStockThreshold', 'LOW_STOCK_THRESHOLD', 10, toInt],
  ['maxItemsPerBooking', 'MAX_ITEMS_PER_BOOKING', 10, toInt],
];

const DEV_SECRETS = { jwtSecret: 'dev-only-secret-change-me', adminPassword: 'admin-dev-password' };

function validateSecrets(config) {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set (32+ characters) in staging/production');
  }
  if (!config.adminPassword) throw new Error('ADMIN_PASSWORD must be set in staging/production');
}

function loadConfig(env = process.env) {
  const appEnv = env.APP_ENV || 'development';
  const isProdLike = appEnv === 'production' || appEnv === 'staging';
  const secretDefaults = isProdLike ? { jwtSecret: '', adminPassword: '' } : DEV_SECRETS;

  const config = { appEnv, chaosEnabled: env.CHAOS_ENABLED === 'true' };
  SPEC.forEach(([key, envVar, fallback, parse]) => {
    const raw = env[envVar];
    if (raw === undefined || raw === '') config[key] = fallback;
    else config[key] = parse ? parse(raw, fallback) : raw;
  });
  config.jwtSecret = env.JWT_SECRET || secretDefaults.jwtSecret;
  config.adminPassword = env.ADMIN_PASSWORD || secretDefaults.adminPassword;

  if (isProdLike) validateSecrets(config);
  return config;
}

module.exports = { loadConfig };
