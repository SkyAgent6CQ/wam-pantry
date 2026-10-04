'use strict';

const { createMemoryStore } = require('../../src/store/memoryStore');
const { createInventoryService } = require('../../src/services/inventoryService');

function setup() {
  const store = createMemoryStore();
  const gauge = { set: jest.fn() };
  const inventory = createInventoryService({ store, config: { lowStockThreshold: 10 }, metrics: { lowStockItems: gauge } });
  const rice = inventory.create({ name: 'Rice', category: 'dry', quantity: 50 });
  const soap = inventory.create({ name: 'Soap', category: 'hygiene', quantity: 3, expiresOn: '2026-10-08' });
  return { inventory, gauge, rice, soap };
}

describe('inventoryService', () => {
  test('lists items sorted by name with filters', () => {
    const { inventory } = setup();
    expect(inventory.list().map((i) => i.name)).toEqual(['Rice', 'Soap']);
    expect(inventory.list({ category: 'hygiene' })).toHaveLength(1);
  });

  test('rejects duplicate names case-insensitively', () => {
    const { inventory } = setup();
    expect(() => inventory.create({ name: 'rice', category: 'dry', quantity: 1 })).toThrow(expect.objectContaining({ status: 409 }));
  });

  test('tracks low-stock items and updates the Prometheus gauge', () => {
    const { inventory, gauge, rice } = setup();
    expect(inventory.lowStock().map((i) => i.name)).toEqual(['Soap']);
    inventory.update(rice.id, { quantity: 2 });
    expect(gauge.set).toHaveBeenLastCalledWith(2);
  });

  test('adjustStock is all-or-nothing when any line is short', () => {
    const { inventory, rice, soap } = setup();
    expect(() => inventory.adjustStock([{ itemId: rice.id, quantity: 5 }, { itemId: soap.id, quantity: 99 }], -1))
      .toThrow(/Insufficient stock for: Soap/);
    expect(inventory.get(rice.id).quantity).toBe(50); // unchanged
  });

  test('adjustStock can return stock', () => {
    const { inventory, soap } = setup();
    inventory.adjustStock([{ itemId: soap.id, quantity: 2 }], +1);
    expect(inventory.get(soap.id).quantity).toBe(5);
  });

  test('finds items expiring within N days', () => {
    const { inventory } = setup();
    expect(inventory.expiringWithin(7, new Date('2026-10-05T00:00:00Z')).map((i) => i.name)).toEqual(['Soap']);
    expect(inventory.expiringWithin(1, new Date('2026-10-05T00:00:00Z'))).toHaveLength(0);
  });

  test('get/remove unknown ids throw 404', () => {
    const { inventory } = setup();
    expect(() => inventory.get('nope')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => inventory.remove('nope')).toThrow(expect.objectContaining({ status: 404 }));
  });
});
