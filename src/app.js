'use strict';

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { loadConfig } = require('./config');
const { createLogger } = require('./utils/logger');
const { createMetrics } = require('./metrics');
const { createMemoryStore, SEED_ITEMS } = require('./store/memoryStore');
const { createUserService } = require('./services/userService');
const { createInventoryService } = require('./services/inventoryService');
const { createBookingService } = require('./services/bookingService');
const { requestMetrics } = require('./middleware/requestMetrics');
const { authenticate, requireRole } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { authRouter } = require('./routes/auth');
const { itemsRouter } = require('./routes/items');
const { bookingsRouter } = require('./routes/bookings');
const { systemRouter } = require('./routes/system');

/**
 * Builds the Express app with all dependencies injected. Tests call this with
 * overrides (silent logger, fixed clock) and never open a real port.
 */
function createApp(overrides = {}) {
  const config = { ...loadConfig(overrides.env), ...overrides.config };
  const logger = overrides.logger || createLogger({ level: config.logLevel, base: { env: config.appEnv, version: config.version } });
  const metrics = createMetrics({ appEnv: config.appEnv, version: config.version });
  const store = overrides.store || createMemoryStore();

  const userService = createUserService({ store, config });
  const inventory = createInventoryService({ store, config, metrics });
  const bookings = createBookingService({ store, inventory, metrics, clock: overrides.clock });

  if (store.count('items') === 0 && overrides.seed !== false) {
    SEED_ITEMS.forEach((item) => inventory.create(item));
  }
  inventory.refreshLowStockGauge();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '20kb' }));
  app.use(requestMetrics(metrics, logger));

  const auth = authenticate(userService);
  const requireAdmin = requireRole('admin');
  const limiter = rateLimit({ windowMs: 60_000, limit: config.rateLimitPerMinute, standardHeaders: 'draft-7', legacyHeaders: false });

  app.use(systemRouter({ config, metrics, store, startedAt: new Date().toISOString() }));
  app.use('/api', limiter);
  app.use('/api/auth', authRouter({ userService }));
  app.use('/api/items', itemsRouter({ inventory, authenticate: auth, requireAdmin }));
  app.use('/api/bookings', bookingsRouter({ bookings, config, authenticate: auth, requireAdmin }));
  app.get('/api/admin/stats', auth, requireAdmin, (_req, res) => {
    res.json({
      users: store.count('users'),
      items: store.count('items'),
      lowStock: inventory.lowStock().length,
      confirmedBookings: bookings.listAll({ status: 'confirmed' }).length,
    });
  });

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return { app, config, logger, metrics, store, services: { userService, inventory, bookings } };
}

module.exports = { createApp };
