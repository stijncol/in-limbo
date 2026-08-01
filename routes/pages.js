const express = require('express');
const router = express.Router();
const { requireAuth, requireStudent } = require('../middleware/auth');
const { getVideoRows } = require('../db/videos');
const { renderPublic, slugify } = require('../views/public');
const { renderSubmit } = require('../views/submit');
const { renderAdmin } = require('../views/admin');
const { renderLab } = require('../views/lab');

router.get('/', async (req, res) => {
  res.send(renderPublic(await getVideoRows()));
});

// Deep link to a single film. Serves the whole archive — the film opens on top
// of it — but with that film's title, synopsis and still in the metadata, so a
// shared link previews as the film rather than as the site. An unknown slug
// (a renamed title, a typo) falls back to the archive instead of a 404.
router.get('/film/:slug', async (req, res) => {
  const rows = await getVideoRows();
  const film = rows
    .filter(v => v.status === 'approved' || !v.status)
    .find(v => slugify(v.title) === req.params.slug);
  if (!film) return res.redirect(302, '/');
  res.send(renderPublic(rows, { film }));
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /user\nDisallow: /lab\nDisallow: /submit\n');
});

router.get('/submit', requireStudent, (req, res) => {
  res.send(renderSubmit());
});

router.get('/user', requireAuth, async (req, res) => {
  res.send(renderAdmin(await getVideoRows()));
});

router.get('/lab', requireAuth, async (req, res) => {
  res.send(renderLab(await getVideoRows()));
});

module.exports = router;
