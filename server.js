const express = require('express');
const path = require('path');

const { PORT, SITE_URL } = require('./config');
const { initDB } = require('./db/pool');
const { getThumbStats } = require('./db/videos');

const app = express();

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
  try {
    const r = await getThumbStats();
    console.log('Thumbnails: ' + r.baked + '/' + r.total + ' baked');
  } catch(e) {}
});
