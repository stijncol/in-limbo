const { ADMIN_USER, ADMIN_PASS, STUDENT_USER, STUDENT_PASS } = require('../config');

// Admin-only access
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="in limbo admin"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = decoded.split(':');
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="in limbo admin"');
  return res.status(401).send('Invalid credentials');
}

// Student or admin access (submit flow)
function requireStudent(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="in limbo submit"');
    return res.status(401).send('Authentication required');
  }
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = decoded.split(':');
  if ((user === STUDENT_USER && pass === STUDENT_PASS) || (user === ADMIN_USER && pass === ADMIN_PASS)) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="in limbo submit"');
  return res.status(401).send('Invalid credentials');
}

module.exports = { requireAuth, requireStudent };
