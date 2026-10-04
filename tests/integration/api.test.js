'use strict';

const request = require('supertest');
const { buildTestApp, login, registerAndLogin, ADMIN } = require('../helpers');

let ctx;
let app;
let adminToken;

beforeEach(async () => {
  ctx = await buildTestApp();
  app = ctx.app;
  adminToken = await login(app, ADMIN);
});

const firstItem = async () => (await request(app).get('/api/items')).body[0];

describe('system endpoints', () => {
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  test('GET /ready reports seeded store', async () => {
    const res = await request(app).get('/ready');
    expect(res.body).toEqual({ ready: true, items: 6 });
  });

  test('GET /ready returns 503 when store is empty', async () => {
    const empty = await buildTestApp({ seed: false });
    expect((await request(empty.app).get('/ready')).status).toBe(503);
  });

  test('GET /metrics exposes Prometheus metrics including business metrics', async () => {
    await request(app).get('/api/items');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('pantry_items_low_stock');
    expect(res.text).toContain('route="/api/items/"');
  });

  test('GET /api/version returns build info', async () => {
    expect((await request(app).get('/api/version')).body).toHaveProperty('version');
  });

  test('sets security headers and hides x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('unknown routes return JSON 404', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('malformed JSON returns 400, not 500', async () => {
    const res = await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
  });

  test('chaos endpoints are absent unless enabled', async () => {
    expect((await request(app).get('/api/chaos/error')).status).toBe(404);
    const chaos = await buildTestApp({ config: { chaosEnabled: true } });
    const res = await request(chaos.app).get('/api/chaos/error');
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error'); // no stack trace leaked
    expect((await request(chaos.app).get('/api/chaos/slow?ms=10')).body).toEqual({ delayedMs: 10 });
  });
});

describe('auth', () => {
  test('register → login → token works', async () => {
    const reg = await request(app).post('/api/auth/register').send({ name: 'Ana', email: 'ana@deakin.edu.au', password: 'password123' });
    expect(reg.status).toBe(201);
    expect(reg.body).not.toHaveProperty('passwordHash');
    const res = await request(app).post('/api/auth/login').send({ email: 'ana@deakin.edu.au', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  test('duplicate registration is a 409', async () => {
    const body = { name: 'Ana', email: 'dup@deakin.edu.au', password: 'password123' };
    await request(app).post('/api/auth/register').send(body);
    expect((await request(app).post('/api/auth/register').send(body)).status).toBe(409);
  });

  test('wrong password and unknown email give the same 401', async () => {
    const a = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-password' });
    const b = await request(app).post('/api/auth/login').send({ email: 'ghost@x.io', password: 'wrong-password' });
    expect(a.status).toBe(401);
    expect(b.body).toEqual(a.body);
  });

  test('missing, malformed and forged tokens are rejected', async () => {
    expect((await request(app).post('/api/bookings')).status).toBe(401);
    expect((await request(app).get('/api/bookings/mine').set('authorization', 'Token abc')).status).toBe(401);
    expect((await request(app).get('/api/bookings/mine').set('authorization', 'Bearer forged.jwt.value')).status).toBe(401);
  });
});

describe('items (inventory CRUD)', () => {
  test('anyone can browse and filter items', async () => {
    const res = await request(app).get('/api/items?category=canned&inStock=true');
    expect(res.status).toBe(200);
    expect(res.body.every((i) => i.category === 'canned')).toBe(true);
    expect((await request(app).get('/api/items?category=bogus')).status).toBe(400);
  });

  test('students cannot modify inventory', async () => {
    const token = await registerAndLogin(app);
    const res = await request(app).post('/api/items').set('authorization', `Bearer ${token}`).send({ name: 'X', category: 'dry', quantity: 1 });
    expect(res.status).toBe(403);
  });

  test('admin full CRUD lifecycle', async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const created = await request(app).post('/api/items').set(auth).send({ name: 'Lentils', category: 'dry', quantity: 30, unit: 'bag' });
    expect(created.status).toBe(201);
    const { id } = created.body;
    expect((await request(app).get(`/api/items/${id}`)).body.name).toBe('Lentils');
    expect((await request(app).patch(`/api/items/${id}`).set(auth).send({ quantity: 2 })).body.quantity).toBe(2);
    expect((await request(app).patch(`/api/items/${id}`).set(auth).send({ quantity: -5 })).status).toBe(400);
    expect((await request(app).delete(`/api/items/${id}`).set(auth)).status).toBe(204);
    expect((await request(app).get(`/api/items/${id}`)).status).toBe(404);
  });

  test('admin reports: low stock and expiring', async () => {
    const auth = { authorization: `Bearer ${adminToken}` };
    const low = await request(app).get('/api/items/low-stock').set(auth);
    expect(low.body.map((i) => i.name).sort()).toEqual(['Canned tomatoes', 'Toothpaste']);
    const exp = await request(app).get('/api/items/expiring?days=365').set(auth);
    expect(exp.body.map((i) => i.name)).toContain('Fresh apples');
    expect((await request(app).get('/api/items/expiring?days=-1').set(auth)).status).toBe(400);
  });
});

describe('bookings (end-to-end flow)', () => {
  test('student books, sees booking, cancels; stock is reserved then returned', async () => {
    const token = await registerAndLogin(app);
    const auth = { authorization: `Bearer ${token}` };
    const item = await firstItem();

    const booked = await request(app).post('/api/bookings').set(auth)
      .send({ items: [{ itemId: item.id, quantity: 2 }], pickupDate: '2026-10-06' });
    expect(booked.status).toBe(201);
    expect((await request(app).get(`/api/items/${item.id}`)).body.quantity).toBe(item.quantity - 2);

    const mine = await request(app).get('/api/bookings/mine').set(auth);
    expect(mine.body).toHaveLength(1);

    const cancelled = await request(app).delete(`/api/bookings/${booked.body.id}`).set(auth);
    expect(cancelled.body.status).toBe('cancelled');
    expect((await request(app).get(`/api/items/${item.id}`)).body.quantity).toBe(item.quantity);
  });

  test('overbooking scarce stock is a 409 and stock is untouched', async () => {
    const token = await registerAndLogin(app);
    const items = (await request(app).get('/api/items')).body;
    const toothpaste = items.find((i) => i.name === 'Toothpaste'); // quantity 5
    const res = await request(app).post('/api/bookings').set('authorization', `Bearer ${token}`)
      .send({ items: [{ itemId: toothpaste.id, quantity: 6 }], pickupDate: '2026-10-06' });
    expect(res.status).toBe(409);
    expect((await request(app).get(`/api/items/${toothpaste.id}`)).body.quantity).toBe(5);
  });

  test('admin lists bookings, marks collected and sees stats', async () => {
    const token = await registerAndLogin(app);
    const item = await firstItem();
    const b = await request(app).post('/api/bookings').set('authorization', `Bearer ${token}`)
      .send({ items: [{ itemId: item.id, quantity: 1 }], pickupDate: '2026-10-05' });
    const auth = { authorization: `Bearer ${adminToken}` };

    expect((await request(app).get('/api/bookings?status=confirmed').set(auth)).body).toHaveLength(1);
    expect((await request(app).post(`/api/bookings/${b.body.id}/collect`).set(auth)).body.status).toBe('collected');
    const stats = await request(app).get('/api/admin/stats').set(auth);
    expect(stats.body).toMatchObject({ users: 2, items: 6, confirmedBookings: 0 });
    expect((await request(app).get('/api/bookings').set('authorization', `Bearer ${token}`)).status).toBe(403);
  });

  test('invalid booking payload returns field-level errors', async () => {
    const token = await registerAndLogin(app);
    const res = await request(app).post('/api/bookings').set('authorization', `Bearer ${token}`).send({ items: [], pickupDate: 'soon' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(2);
  });
});

describe('rate limiting', () => {
  test('returns 429 once the per-minute limit is exceeded', async () => {
    const limited = await buildTestApp({ config: { rateLimitPerMinute: 3 } });
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await request(limited.app).get('/api/items')).status);
    expect(codes.slice(-1)[0]).toBe(429);
  });
});
