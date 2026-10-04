'use strict';

const { createMemoryStore } = require('../../src/store/memoryStore');
const { createInventoryService } = require('../../src/services/inventoryService');
const { createBookingService } = require('../../src/services/bookingService');

const NOW = new Date('2026-10-05T09:00:00Z');

function setup() {
  const store = createMemoryStore();
  const inventory = createInventoryService({ store, config: { lowStockThreshold: 10 } });
  const counter = { inc: jest.fn() };
  const bookings = createBookingService({ store, inventory, metrics: { bookingsTotal: counter }, clock: () => NOW });
  const pasta = inventory.create({ name: 'Pasta', category: 'dry', quantity: 4 });
  return { store, inventory, bookings, counter, pasta };
}

describe('bookingService', () => {
  test('confirms a booking and reserves stock', () => {
    const { bookings, inventory, pasta, counter } = setup();
    const b = bookings.create('u1', { items: [{ itemId: pasta.id, quantity: 3 }], pickupDate: '2026-10-06' });
    expect(b.status).toBe('confirmed');
    expect(inventory.get(pasta.id).quantity).toBe(1);
    expect(counter.inc).toHaveBeenCalledWith({ outcome: 'confirmed' });
  });

  test('rejects past dates and dates beyond 14 days', () => {
    const { bookings, pasta } = setup();
    const items = [{ itemId: pasta.id, quantity: 1 }];
    expect(() => bookings.create('u1', { items, pickupDate: '2026-10-04' })).toThrow(/past/);
    expect(() => bookings.create('u1', { items, pickupDate: '2026-10-25' })).toThrow(/14 days/);
  });

  test('enforces one booking per student per pickup day', () => {
    const { bookings, pasta } = setup();
    const req = { items: [{ itemId: pasta.id, quantity: 1 }], pickupDate: '2026-10-06' };
    bookings.create('u1', req);
    expect(() => bookings.create('u1', req)).toThrow(/already have a booking/);
    expect(() => bookings.create('u2', req)).not.toThrow();
  });

  test('cancelling returns stock; only owner or admin may cancel', () => {
    const { bookings, inventory, pasta } = setup();
    const b = bookings.create('u1', { items: [{ itemId: pasta.id, quantity: 2 }], pickupDate: '2026-10-06' });
    expect(() => bookings.cancel(b.id, { sub: 'u2', role: 'student' })).toThrow(expect.objectContaining({ status: 403 }));
    expect(bookings.cancel(b.id, { sub: 'u1', role: 'student' }).status).toBe('cancelled');
    expect(inventory.get(pasta.id).quantity).toBe(4);
    expect(() => bookings.cancel(b.id, { sub: 'admin', role: 'admin' })).toThrow(/already cancelled/);
  });

  test('marks a booking collected exactly once', () => {
    const { bookings, pasta } = setup();
    const b = bookings.create('u1', { items: [{ itemId: pasta.id, quantity: 1 }], pickupDate: '2026-10-05' });
    expect(bookings.markCollected(b.id).status).toBe('collected');
    expect(() => bookings.markCollected(b.id)).toThrow(/already collected/);
    expect(() => bookings.markCollected('missing')).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => bookings.cancel('missing', { sub: 'u1' })).toThrow(expect.objectContaining({ status: 404 }));
  });

  test('lists bookings per user and by status', () => {
    const { bookings, pasta } = setup();
    bookings.create('u1', { items: [{ itemId: pasta.id, quantity: 1 }], pickupDate: '2026-10-07' });
    bookings.create('u1', { items: [{ itemId: pasta.id, quantity: 1 }], pickupDate: '2026-10-06' });
    expect(bookings.listForUser('u1').map((b) => b.pickupDate)).toEqual(['2026-10-06', '2026-10-07']);
    expect(bookings.listAll({ status: 'confirmed' })).toHaveLength(2);
  });
});
