'use strict';

const { badRequest } = require('./errors');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES = ['canned', 'dry', 'fresh', 'frozen', 'hygiene', 'baby', 'other'];

function isNonEmptyString(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

// Linear-time email check (avoids regex backtracking / ReDoS on hostile input).
function isValidEmail(email) {
  if (email.length > 254 || /\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2 || !parts[0]) return false;
  const labels = parts[1].split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

function isValidDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function validateCredentials(body = {}) {
  const errors = [];
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) errors.push('email must be a valid email address');
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
    errors.push('password must be 8-128 characters');
  }
  if (errors.length) throw badRequest('Invalid credentials payload', errors);
  return { email, password: body.password };
}

function validateRegistration(body = {}) {
  const creds = validateCredentials(body);
  if (!isNonEmptyString(body.name, 100)) throw badRequest('Invalid registration payload', ['name is required (max 100 chars)']);
  return { ...creds, name: body.name.trim() };
}

// Each rule: [field, isValid(value), errorMessage, normalize(value)]
const ITEM_RULES = [
  ['name', (v) => isNonEmptyString(v, 100), 'name is required (max 100 chars)', (v) => v.trim()],
  ['category', (v) => CATEGORIES.includes(v), `category must be one of: ${CATEGORIES.join(', ')}`, (v) => v],
  ['quantity', (v) => Number.isInteger(v) && v >= 0 && v <= 100000, 'quantity must be an integer 0-100000', (v) => v],
];
const OPTIONAL_ITEM_RULES = [
  ['unit', (v) => isNonEmptyString(v, 20), 'unit must be a short string', (v) => v.trim()],
  ['expiresOn', isValidDate, 'expiresOn must be a date in YYYY-MM-DD format', (v) => v],
];

function validateItem(body = {}, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const apply = ([field, isValid, message, normalize], required) => {
    if (body[field] === undefined && !required) return;
    if (isValid(body[field])) out[field] = normalize(body[field]);
    else errors.push(message);
  };

  ITEM_RULES.forEach((rule) => apply(rule, !partial));
  OPTIONAL_ITEM_RULES.forEach((rule) => apply(rule, false));

  if (partial && Object.keys(out).length === 0 && errors.length === 0) errors.push('at least one field must be provided');
  if (errors.length) throw badRequest('Invalid item payload', errors);
  return out;
}

function validateBookingLines(items, maxItems) {
  if (!Array.isArray(items) || items.length === 0) return ['items must be a non-empty array'];
  const errors = [];
  items.forEach((line, i) => {
    if (!isNonEmptyString(line?.itemId, 64)) errors.push(`items[${i}].itemId is required`);
    if (!Number.isInteger(line?.quantity) || line.quantity < 1) errors.push(`items[${i}].quantity must be a positive integer`);
  });
  const total = items.reduce((sum, l) => sum + (Number.isInteger(l?.quantity) ? l.quantity : 0), 0);
  if (total > maxItems) errors.push(`a booking may contain at most ${maxItems} items in total`);
  const ids = items.map((l) => l?.itemId);
  if (new Set(ids).size !== ids.length) errors.push('each itemId may appear only once per booking');
  return errors;
}

function validateBooking(body = {}, maxItems = 10) {
  const errors = validateBookingLines(body.items, maxItems);
  if (!isValidDate(body.pickupDate)) errors.push('pickupDate must be a date in YYYY-MM-DD format');
  if (errors.length) throw badRequest('Invalid booking payload', errors);
  return { items: body.items.map((l) => ({ itemId: l.itemId, quantity: l.quantity })), pickupDate: body.pickupDate };
}

module.exports = { validateCredentials, validateRegistration, validateItem, validateBooking, isValidDate, CATEGORIES };
