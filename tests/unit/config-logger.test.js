'use strict';

const { loadConfig } = require('../../src/config');
const { createLogger } = require('../../src/utils/logger');
const { createMemoryStore } = require('../../src/store/memoryStore');

describe('config', () => {
  test('uses safe development defaults', () => {
    const c = loadConfig({});
    expect(c.appEnv).toBe('development');
    expect(c.port).toBe(3000);
    expect(c.jwtSecret).toBeTruthy();
  });

  test('reads environment overrides', () => {
    const c = loadConfig({ PORT: '8081', LOW_STOCK_THRESHOLD: 'x', CHAOS_ENABLED: 'true' });
    expect(c.port).toBe(8081);
    expect(c.lowStockThreshold).toBe(10); // invalid number falls back
    expect(c.chaosEnabled).toBe(true);
  });

  test('fails fast in production without strong secrets', () => {
    expect(() => loadConfig({ APP_ENV: 'production' })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ APP_ENV: 'production', JWT_SECRET: 'x'.repeat(32) })).toThrow(/ADMIN_PASSWORD/);
    expect(loadConfig({ APP_ENV: 'staging', JWT_SECRET: 'x'.repeat(32), ADMIN_PASSWORD: 'pw' }).appEnv).toBe('staging');
  });
});

describe('logger', () => {
  test('writes JSON lines at or above the configured level', () => {
    const lines = [];
    const log = createLogger({ level: 'warn', base: { svc: 't' }, stream: { write: (l) => lines.push(JSON.parse(l)) } });
    log.info('hidden');
    log.debug('hidden');
    log.warn('shown', { a: 1 });
    log.error('also');
    expect(lines.map((l) => l.msg)).toEqual(['shown', 'also']);
    expect(lines[0]).toMatchObject({ level: 'warn', svc: 't', a: 1 });
  });
});

describe('memoryStore', () => {
  test('returns copies so callers cannot mutate stored state', () => {
    const s = createMemoryStore();
    const doc = s.insert('items', { id: '1', name: 'a' });
    doc.name = 'mutated';
    expect(s.get('items', '1').name).toBe('a');
    expect(s.update('items', 'missing', {})).toBeNull();
    expect(() => s.list('nope')).toThrow(/Unknown collection/);
  });
});
