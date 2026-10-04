'use strict';

const express = require('express');
const { validateItem, CATEGORIES } = require('../utils/validation');
const { badRequest } = require('../utils/errors');

function itemsRouter({ inventory, authenticate, requireAdmin }) {
  const router = express.Router();

  // Public: students can browse what is available before logging in.
  router.get('/', (req, res) => {
    const { category, inStock } = req.query;
    if (category && !CATEGORIES.includes(category)) throw badRequest(`Unknown category: ${category}`);
    res.json(inventory.list({ category, inStock: inStock === 'true' }));
  });

  router.get('/low-stock', authenticate, requireAdmin, (_req, res) => res.json(inventory.lowStock()));

  router.get('/expiring', authenticate, requireAdmin, (req, res) => {
    const days = Number.parseInt(req.query.days ?? '7', 10);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw badRequest('days must be 0-365');
    res.json(inventory.expiringWithin(days));
  });

  router.get('/:id', (req, res) => res.json(inventory.get(req.params.id)));

  router.post('/', authenticate, requireAdmin, (req, res) => {
    res.status(201).json(inventory.create(validateItem(req.body)));
  });

  router.patch('/:id', authenticate, requireAdmin, (req, res) => {
    res.json(inventory.update(req.params.id, validateItem(req.body, { partial: true })));
  });

  router.delete('/:id', authenticate, requireAdmin, (req, res) => {
    inventory.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { itemsRouter };
