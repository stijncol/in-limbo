const express = require('express');
const router = express.Router();
const { requireAuth, requireStudent } = require('../middleware/auth');
const { getVideoRows } = require('../db/videos');
const { renderPublic } = require('../views/public');
const { renderSubmit } = require('../views/submit');
const { renderAdmin } = require('../views/admin');
const { renderLab } = require('../views/lab');

router.get('/', async (req, res) => {
  res.send(renderPublic(await getVideoRows()));
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
