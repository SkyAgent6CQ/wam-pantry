'use strict';

/**
 * Smoke tests against a deployed environment. Run with:
 *   BASE_URL=http://pantry-staging:3000 SMOKE_ADMIN_PASSWORD=... npm run test:smoke
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL || 'admin@wam.local';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;
const EXPECTED_VERSION = process.env.EXPECTED_VERSION;

async function call(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

describe(`smoke: ${BASE_URL}`, () => {
  test('health endpoint is up', async () => {
    const { status, body } = await call('/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
  });

  test('the expected version was deployed', async () => {
    const { body } = await call('/api/version');
    if (EXPECTED_VERSION) expect(body.version).toBe(EXPECTED_VERSION);
    else expect(body.version).toBeTruthy();
  });

  test('inventory is readable', async () => {
    const { status, body } = await call('/api/items');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('metrics endpoint is scrapeable by Prometheus', async () => {
    const { status, body } = await call('/metrics');
    expect(status).toBe(200);
    expect(body).toContain('http_requests_total');
  });

  test('student journey: register, login, book a pickup', async () => {
    const email = `smoke-${Date.now()}@deakin.edu.au`;
    await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Smoke', email, password: 'smoke-pass-123' }) });
    const { body: auth } = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'smoke-pass-123' }) });
    expect(auth.token).toBeTruthy();

    const { body: items } = await call('/api/items?inStock=true');
    const today = new Date().toISOString().slice(0, 10);
    const res = await call('/api/bookings', {
      method: 'POST',
      headers: { authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ items: [{ itemId: items[0].id, quantity: 1 }], pickupDate: today }),
    });
    expect(res.status).toBe(201);
    // Clean up so smoke tests don't drain real stock.
    await call(`/api/bookings/${res.body.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${auth.token}` } });
  });

  (ADMIN_PASSWORD ? test : test.skip)('admin can log in and read stats', async () => {
    const { body: auth } = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }) });
    const { status } = await call('/api/admin/stats', { headers: { authorization: `Bearer ${auth.token}` } });
    expect(status).toBe(200);
  });
});
