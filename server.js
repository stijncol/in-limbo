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

// What UptimeRobot should watch instead of the homepage. It answers from the
// in-memory archive, so a ping every few minutes costs no database query and
// does not keep a serverless instance awake — but it still fails loudly if the
// app cannot produce the archive at all, which is the thing worth knowing.
app.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const rows = await require('./db/videos').getVideoRows();
    res.json({ ok: true, films: rows.length });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'archive unavailable' });
  }
});

app.use('/thumb', require('./routes/thumbs'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/pages'));

// Anything that matched no route. Kept plain: a wrong address is not an
// occasion for a designed page, and /film/<unknown> already redirects home.
app.use((req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

// Last resort. Express 5 forwards a rejected async handler here, which is why
// a database hiccup produced a stack trace in the browser rather than a crash.
// The trace goes to the log, where it is useful; the visitor gets a sentence.
app.use((err, req, res, next) => {
  console.error('unhandled error on ' + req.method + ' ' + req.originalUrl + ':', err && err.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).type('text/plain').send('Something went wrong. Please try again.');
});

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
