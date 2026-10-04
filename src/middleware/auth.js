'use strict';

const { unauthorized, forbidden } = require('../utils/errors');

function authenticate(userService) {
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized());
    try {
      req.user = userService.verifyToken(token);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

function requireRole(role) {
  return (req, _res, next) => (req.user?.role === role ? next() : next(forbidden()));
}

module.exports = { authenticate, requireRole };
