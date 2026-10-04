'use strict';

const express = require('express');
const { validateBooking } = require('../utils/validation');

function bookingsRouter({ bookings, config, authenticate, requireAdmin }) {
  const router = express.Router();
  router.use(authenticate);

  router.post('/', (req, res) => {
    const payload = validateBooking(req.body, config.maxItemsPerBooking);
    res.status(201).json(bookings.create(req.user.sub, payload));
  });

  router.get('/mine', (req, res) => res.json(bookings.listForUser(req.user.sub)));

  router.get('/', requireAdmin, (req, res) => res.json(bookings.listAll({ status: req.query.status })));

  router.delete('/:id', (req, res) => res.json(bookings.cancel(req.params.id, req.user)));

  router.post('/:id/collect', requireAdmin, (req, res) => res.json(bookings.markCollected(req.params.id)));

  return router;
}

module.exports = { bookingsRouter };
