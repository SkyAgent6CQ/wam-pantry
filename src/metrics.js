'use strict';

const client = require('prom-client');

/**
 * Prometheus metrics. A fresh registry per app instance keeps tests isolated
 * (no "metric already registered" errors when many apps are created).
 */
function createMetrics({ appEnv, version }) {
  const register = new client.Registry();
  register.setDefaultLabels({ app: 'wam-pantry', env: appEnv });
  client.collectDefaultMetrics({ register });

  const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register],
  });

  const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
  });

  const bookingsTotal = new client.Counter({
    name: 'pantry_bookings_total',
    help: 'Pickup bookings by outcome',
    labelNames: ['outcome'],
    registers: [register],
  });

  const lowStockItems = new client.Gauge({
    name: 'pantry_items_low_stock',
    help: 'Number of inventory items at or below the low-stock threshold',
    registers: [register],
  });

  const buildInfo = new client.Gauge({
    name: 'pantry_build_info',
    help: 'Build metadata (value is always 1)',
    labelNames: ['version'],
    registers: [register],
  });
  buildInfo.set({ version }, 1);

  return { register, httpRequestsTotal, httpRequestDuration, bookingsTotal, lowStockItems };
}

module.exports = { createMetrics };
