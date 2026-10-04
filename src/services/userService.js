'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { conflict, unauthorized } = require('../utils/errors');

const BCRYPT_ROUNDS = 10;
// Real hash of a random value, used to keep login timing constant for unknown emails.
const DUMMY_HASH = bcrypt.hashSync(`dummy-${Date.now()}`, BCRYPT_ROUNDS);

function publicUser(user) {
  const { passwordHash, ...rest } = user; // eslint-disable-line no-unused-vars
  return rest;
}

function createUserService({ store, config }) {
  function findByEmail(email) {
    return store.list('users', (u) => u.email === email)[0] || null;
  }

  async function register({ name, email, password }, role = 'student') {
    if (findByEmail(email)) throw conflict('An account with this email already exists');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = store.insert('users', { id: store.newId(), name, email, role, passwordHash });
    return publicUser(user);
  }

  async function login({ email, password }) {
    const user = findByEmail(email);
    // Compare against a dummy hash when the user is missing so response time
    // does not reveal whether an email is registered (user enumeration).
    const hash = user ? user.passwordHash : DUMMY_HASH;
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) throw unauthorized('Invalid email or password');
    const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, {
      expiresIn: config.jwtExpiresIn,
      issuer: 'wam-pantry',
    });
    return { token, user: publicUser(user) };
  }

  function verifyToken(token) {
    try {
      return jwt.verify(token, config.jwtSecret, { issuer: 'wam-pantry' });
    } catch {
      throw unauthorized('Invalid or expired token');
    }
  }

  async function ensureAdmin() {
    if (!config.adminPassword || findByEmail(config.adminEmail)) return null;
    return register({ name: 'WAM Admin', email: config.adminEmail, password: config.adminPassword }, 'admin');
  }

  function getById(id) {
    const user = store.get('users', id);
    return user ? publicUser(user) : null;
  }

  return { register, login, verifyToken, ensureAdmin, getById };
}

module.exports = { createUserService };
