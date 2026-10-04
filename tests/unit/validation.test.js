'use strict';

const v = require('../../src/utils/validation');

describe('validateCredentials', () => {
  test('normalizes email to lower case', () => {
    expect(v.validateCredentials({ email: ' Krish@Deakin.EDU.au ', password: 'password1' }).email).toBe('krish@deakin.edu.au');
  });

  test.each([
    [{ email: 'not-an-email', password: 'password1' }],
    [{ email: 'a@b.co', password: 'short' }],
    [{}],
  ])('rejects invalid payload %#', (body) => {
    expect(() => v.validateCredentials(body)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('validateRegistration', () => {
  test('requires a name', () => {
    expect(() => v.validateRegistration({ email: 'a@b.co', password: 'password1' })).toThrow('Invalid registration payload');
  });
  test('trims the name', () => {
    expect(v.validateRegistration({ name: '  Sam ', email: 'a@b.co', password: 'password1' }).name).toBe('Sam');
  });
});

describe('validateItem', () => {
  const valid = { name: 'Oats', category: 'dry', quantity: 5 };

  test('accepts a valid full item', () => {
    expect(v.validateItem({ ...valid, unit: 'box', expiresOn: '2027-01-01' })).toEqual({ ...valid, unit: 'box', expiresOn: '2027-01-01' });
  });

  test('reports every invalid field at once', () => {
    try {
      v.validateItem({ name: '', category: 'weapons', quantity: -1 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.details).toHaveLength(3);
    }
  });

  test('partial update only validates provided fields', () => {
    expect(v.validateItem({ quantity: 12 }, { partial: true })).toEqual({ quantity: 12 });
  });

  test('partial update with no fields is rejected', () => {
    expect(() => v.validateItem({}, { partial: true })).toThrow();
  });

  test('rejects bad optional fields', () => {
    expect(() => v.validateItem({ ...valid, expiresOn: '31/12/2026' })).toThrow();
    expect(() => v.validateItem({ ...valid, unit: '' })).toThrow();
  });
});

describe('validateBooking', () => {
  const ok = { items: [{ itemId: 'a', quantity: 2 }], pickupDate: '2026-10-06' };

  test('accepts a valid booking and strips unknown fields', () => {
    expect(v.validateBooking({ ...ok, extra: true, items: [{ itemId: 'a', quantity: 2, hack: 1 }] })).toEqual(ok);
  });

  test('enforces the per-booking item cap', () => {
    expect(() => v.validateBooking({ ...ok, items: [{ itemId: 'a', quantity: 11 }] }, 10)).toThrow();
  });

  test('rejects duplicate items, empty items and bad dates', () => {
    expect(() => v.validateBooking({ ...ok, items: [{ itemId: 'a', quantity: 1 }, { itemId: 'a', quantity: 1 }] })).toThrow();
    expect(() => v.validateBooking({ ...ok, items: [] })).toThrow();
    expect(() => v.validateBooking({ ...ok, pickupDate: 'tomorrow' })).toThrow();
    expect(() => v.validateBooking({ ...ok, items: [{ quantity: 0 }] })).toThrow();
  });
});

describe('email edge cases', () => {
  test.each(['a@b', '@b.co', 'a@@b.co', 'a b@c.co', 'a@b..co', `${'a'.repeat(250)}@b.co`])('rejects %s', (email) => {
    expect(() => v.validateCredentials({ email, password: 'password1' })).toThrow();
  });
});
