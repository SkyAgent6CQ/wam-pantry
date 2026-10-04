'use strict';

const { notFound, conflict } = require('../utils/errors');

function createInventoryService({ store, config, metrics }) {
  function refreshLowStockGauge() {
    if (metrics) metrics.lowStockItems.set(lowStock().length);
  }

  function list({ category, inStock } = {}) {
    return store
      .list('items', (i) => (!category || i.category === category) && (!inStock || i.quantity > 0))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function get(id) {
    const item = store.get('items', id);
    if (!item) throw notFound(`Item ${id} not found`);
    return item;
  }

  function create(data) {
    const duplicate = store.list('items', (i) => i.name.toLowerCase() === data.name.toLowerCase());
    if (duplicate.length) throw conflict(`An item named "${data.name}" already exists`);
    const item = store.insert('items', { id: store.newId(), unit: 'unit', ...data });
    refreshLowStockGauge();
    return item;
  }

  function update(id, patch) {
    get(id);
    const item = store.update('items', id, patch);
    refreshLowStockGauge();
    return item;
  }

  function remove(id) {
    get(id);
    store.remove('items', id);
    refreshLowStockGauge();
  }

  /** Atomically adjusts stock for several lines; all-or-nothing. */
  function adjustStock(lines, direction) {
    const items = lines.map((l) => ({ line: l, item: get(l.itemId) }));
    if (direction < 0) {
      const short = items.filter(({ line, item }) => item.quantity < line.quantity);
      if (short.length) {
        throw conflict(`Insufficient stock for: ${short.map(({ item }) => item.name).join(', ')}`);
      }
    }
    items.forEach(({ line, item }) => store.update('items', item.id, { quantity: item.quantity + direction * line.quantity }));
    refreshLowStockGauge();
  }

  function lowStock() {
    return store.list('items', (i) => i.quantity <= config.lowStockThreshold);
  }

  function expiringWithin(days, now = new Date()) {
    const limit = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return store.list('items', (i) => i.expiresOn && new Date(i.expiresOn) <= limit);
  }

  return { list, get, create, update, remove, adjustStock, lowStock, expiringWithin, refreshLowStockGauge };
}

module.exports = { createInventoryService };
