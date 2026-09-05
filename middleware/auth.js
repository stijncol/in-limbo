const crypto = require('crypto');
const { ADMIN_USER, ADMIN_PASS, STUDENT_USER, STUDENT_PASS } = require('../config');

// Compare without leaking the answer through timing. `===` on strings bails at
// the first differing character, so the time it takes hints at how much of a
// guess was right. Over the internet that is mostly theoretical, but this
// costs nothing.
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── brute-force brake ─────────────────────────────────────────────────────
// Basic Auth has no lockout of its own: without this an attacker may guess as
// fast as the network allows, and a nine-character password does not survive
// that for long. Ten wrong tries from one address buys a fifteen-minute pause;
// a correct one clears the count, so getting your own password wrong a few
// times costs you nothing.
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const fails = new Map(); // ip -> { count, first }

function tooManyFailures(ip) {
  const rec = fails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { fails.delete(ip); return false; }
  return rec.count >= MAX_FAILS;
}

function noteFailure(ip) {
  const rec = fails.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) fails.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
  // The map only grows while attacks are in progress; drop expired entries so
  // a long run of attempts from many addresses cannot swell it indefinitely.
  if (fails.size > 5000) {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [k, v] of fails) if (v.first < cutoff) fails.delete(k);
  }
}

function noteSuccess(ip) { fails.delete(ip); }

// Shared shape for both guards: parse the header, check one or more identities,
// apply the brake. `realm` is what the browser shows in its prompt.
function basicAuth(realm, accepts) {
  return function (req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    if (tooManyFailures(ip)) {
      res.set('Retry-After', String(Math.ceil(WINDOW_MS / 1000)));
      return res.status(429).send('Too many failed attempts. Try again later.');
    }
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.set('WWW-Authenticate', 'Basic realm="' + realm + '"');
      return res.status(401).send('Authentication required');
    }
    const decoded = Buffer.from(auth.split(' ')[1] || '', 'base64').toString();
    // Split once: a password may legitimately contain a colon, and splitting on
    // every colon would silently truncate it and reject a correct password.
    const sep = decoded.indexOf(':');
    const user = sep === -1 ? decoded : decoded.slice(0, sep);
    const pass = sep === -1 ? '' : decoded.slice(sep + 1);
    // Every identity is checked, never short-circuited, so the time taken does
    // not reveal which one matched.
    let ok = false;
    for (const [u, p] of accepts) if (safeEqual(user, u) && safeEqual(pass, p)) ok = true;
    if (ok) { noteSuccess(ip); return next(); }
    noteFailure(ip);
    res.set('WWW-Authenticate', 'Basic realm="' + realm + '"');
    return res.status(401).send('Invalid credentials');
  };
}

// Admin-only access
const requireAuth = basicAuth('in limbo admin', [[ADMIN_USER, ADMIN_PASS]]);

// "Is this request already carrying admin credentials?" — for routes that are
// public but should show more to an admin. It answers a question, it does not
// guard anything, so it never touches the brute-force counter.
function isAdmin(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) return false;
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  return safeEqual(decoded.slice(0, sep), ADMIN_USER) && safeEqual(decoded.slice(sep + 1), ADMIN_PASS);
}

// Student or admin access (submit flow)
const requireStudent = basicAuth('in limbo submit', [[STUDENT_USER, STUDENT_PASS], [ADMIN_USER, ADMIN_PASS]]);

module.exports = { requireAuth, requireStudent, isAdmin };
