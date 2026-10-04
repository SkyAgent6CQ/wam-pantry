'use strict';

/**
 * Records count + latency for every request, labelled by the matched Express
 * route pattern (e.g. /api/items/:id) rather than the raw URL, to keep label
 * cardinality bounded.
 */
function requestMetrics(metrics, logger) {
  return (req, res, next) => {
    const end = metrics.httpRequestDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      const labels = { method: req.method, route, status: String(res.statusCode) };
      const seconds = end(labels);
      metrics.httpRequestsTotal.inc(labels);
      if (req.path !== '/metrics' && req.path !== '/health') {
        logger.info('request', { ...labels, path: req.originalUrl, ms: Math.round(seconds * 1000) });
      }
    });
    next();
  };
}

module.exports = { requestMetrics };
