'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');

const ADMIN = { email: 'admin@wam.local', password: 'admin-test-password' };

async function buildTestApp(extra = {}) {
  const ctx = createApp({
    config: { logLevel: 'silent', adminPassword: ADMIN.password, jwtSecret: 'test-secret-that-is-long-enough-123456', ...extra.config },
    clock: extra.clock || (() => new Date('2026-10-05T09:00:00Z')),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    ...extra,
  });
  await ctx.services.userService.ensureAdmin();
  return ctx;
}

async function login(app, creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.token;
}

async function registerAndLogin(app, email = 'student@deakin.edu.au') {
  const creds = { name: 'Test Student', email, password: 'student-pass-123' };
  await request(app).post('/api/auth/register').send(creds);
  return login(app, { email, password: creds.password });
}

module.exports = { buildTestApp, login, registerAndLogin, ADMIN };
