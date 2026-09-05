const express = require('express');
const path = require('path');

const { PORT, SITE_URL } = require('./config');
const { initDB } = require('./db/pool');
const { getThumbStats, warmCache } = require('./db/videos');

const app = express();

// Render terminates TLS and forwards, so without this every request looks like
// it came from the proxy: req.ip would be one shared address and the login
// brake in middleware/auth.js would lock out all visitors at once instead of
// the one address actually guessing. Trust exactly one hop.
app.set('trust proxy', 1);

// Baseline headers. Deliberately no Content-Security-Policy: the pages carry
// an inline <script> for the config, pull Google Fonts, and embed YouTube and
// Vimeo players, so a policy strict enough to be worth having needs testing
// against all of that rather than being switched on days before a launch.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');           // no MIME guessing
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');               // nobody frames the archive
  if (SITE_URL) res.set('Strict-Transport-Security', 'max-age=15552000'); // 180d, no preload
  next();
});

// When SITE_URL is set, 301-redirect every other hostname (www, .onrender.com)
// to the canonical domain.
if (SITE_URL) {
  const canonicalHost = new URL(SITE_URL).host;
  app.use((req, res, next) => {
    if (req.headers.host && req.headers.host !== canonicalHost) {
      return res.redirect(301, SITE_URL + req.originalUrl);
    }
    next();
  });
}

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use('/thumb', require('./routes/thumbs'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/pages'));

initDB().then(async () => {
  app.listen(PORT, () => {
    console.log('in limbo running at http://localhost:' + PORT);
    console.log('admin panel at /user');
    console.log('student submit at /submit');
  });
  // Read the archive into memory before the first visitor arrives, so nobody
  // waits for the first query and a later database hiccup stays invisible.
  await warmCache();
  try {
    const r = await getThumbStats();
    console.log('Thumbnails: ' + r.baked + '/' + r.total + ' baked');
  } catch(e) {}
});
