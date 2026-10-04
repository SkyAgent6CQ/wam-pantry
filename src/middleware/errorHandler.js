'use strict';

const { AppError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

function errorHandler(logger) {
  // Express identifies error middleware by its 4-argument signature.
  return (err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
    }
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    // Unknown error: log full detail server-side, return a generic message (no stack traces to clients).
    logger.error('unhandled_error', { message: err.message, stack: err.stack, path: req.originalUrl });
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  };
}

module.exports = { notFoundHandler, errorHandler };
