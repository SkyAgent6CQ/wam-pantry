'use strict';

const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function createBookingService({ store, inventory, metrics, clock = () => new Date() }) {
  function create(userId, { items, pickupDate }) {
    const today = startOfDay(clock());
    const pickup = new Date(`${pickupDate}T00:00:00Z`);
    const maxAhead = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    if (pickup < today) throw badRequest('pickupDate cannot be in the past');
    if (pickup > maxAhead) throw badRequest('pickupDate must be within the next 14 days');

    // Fair-share rule: one active booking per student per pickup day.
    const existing = store.list(
      'bookings',
      (b) => b.userId === userId && b.pickupDate === pickupDate && b.status === 'confirmed',
    );
    if (existing.length) throw conflict('You already have a booking for this pickup date');

    inventory.adjustStock(items, -1); // throws 409 if any line is short; no partial reservation
    const booking = store.insert('bookings', {
      id: store.newId(), userId, items, pickupDate, status: 'confirmed',
    });
    if (metrics) metrics.bookingsTotal.inc({ outcome: 'confirmed' });
    return booking;
  }

  function listForUser(userId) {
    return store.list('bookings', (b) => b.userId === userId).sort((a, b) => a.pickupDate.localeCompare(b.pickupDate));
  }

  function listAll({ status } = {}) {
    return store.list('bookings', (b) => !status || b.status === status);
  }

  function cancel(bookingId, user) {
    const booking = store.get('bookings', bookingId);
    if (!booking) throw notFound(`Booking ${bookingId} not found`);
    if (booking.userId !== user.sub && user.role !== 'admin') throw forbidden('You can only cancel your own bookings');
    if (booking.status !== 'confirmed') throw conflict(`Booking is already ${booking.status}`);
    inventory.adjustStock(booking.items, +1); // return reserved stock to the shelf
    if (metrics) metrics.bookingsTotal.inc({ outcome: 'cancelled' });
    return store.update('bookings', bookingId, { status: 'cancelled' });
  }

  function markCollected(bookingId) {
    const booking = store.get('bookings', bookingId);
    if (!booking) throw notFound(`Booking ${bookingId} not found`);
    if (booking.status !== 'confirmed') throw conflict(`Booking is already ${booking.status}`);
    if (metrics) metrics.bookingsTotal.inc({ outcome: 'collected' });
    return store.update('bookings', bookingId, { status: 'collected' });
  }

  return { create, listForUser, listAll, cancel, markCollected };
}

module.exports = { createBookingService };
