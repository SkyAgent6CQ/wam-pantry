'use strict';

const crypto = require('node:crypto');

/**
 * In-memory repository. The services only talk to this small interface
 * (insert/get/list/update/remove per collection), so it can be swapped for
 * PostgreSQL or MongoDB later without touching business logic.
 */
function createMemoryStore() {
  const collections = { users: new Map(), items: new Map(), bookings: new Map() };

  function col(name) {
    const c = collections[name];
    if (!c) throw new Error(`Unknown collection: ${name}`);
    return c;
  }

  return {
    newId: () => crypto.randomUUID(),
    insert(name, doc) {
      const record = { ...doc, createdAt: doc.createdAt || new Date().toISOString() };
      col(name).set(record.id, record);
      return { ...record };
    },
    get(name, id) {
      const doc = col(name).get(id);
      return doc ? { ...doc } : null;
    },
    list(name, predicate = () => true) {
      return [...col(name).values()].filter(predicate).map((d) => ({ ...d }));
    },
    update(name, id, patch) {
      const existing = col(name).get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      col(name).set(id, updated);
      return { ...updated };
    },
    remove(name, id) {
      return col(name).delete(id);
    },
    count(name) {
      return col(name).size;
    },
  };
}

const SEED_ITEMS = [
  { name: 'Rice (1kg bag)', category: 'dry', quantity: 120, unit: 'bag' },
  { name: 'Pasta (500g)', category: 'dry', quantity: 90, unit: 'pack' },
  { name: 'Canned chickpeas', category: 'canned', quantity: 60, unit: 'can' },
  { name: 'Canned tomatoes', category: 'canned', quantity: 8, unit: 'can' },
  { name: 'Fresh apples', category: 'fresh', quantity: 40, unit: 'kg', expiresOn: '2026-12-31' },
  { name: 'Toothpaste', category: 'hygiene', quantity: 5, unit: 'tube' },
];

module.exports = { createMemoryStore, SEED_ITEMS };
