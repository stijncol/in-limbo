const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://in_limbo_db_user:R81k6JoQsAzzZNEBxU4Yetqzik6MowsV@dpg-d832nvbrjlhs73817e00-a/in_limbo_db';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'limbo2026';
const STUDENT_USER = 'student';
const STUDENT_PASS = 'inlimbo';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
});

// --- Init DB ---
async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    students TEXT NOT NULL,
    description TEXT NOT NULL,
    video_id TEXT NOT NULL,
    video_type TEXT DEFAULT 'vimeo',
    year INTEGER NOT NULL,
    tags_theme TEXT DEFAULT '',
    tags_medium TEXT DEFAULT '',
    featured INTEGER DEFAULT 1,
    archived INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    status TEXT DEFAULT 'approved',
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  // Migrate existing tables
  try { await pool.query("ALTER TABLE videos ADD COLUMN tags_theme TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN tags_medium TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN video_type TEXT DEFAULT 'vimeo'"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN video_id TEXT"); } catch(e) {}
  // Migrate old data: copy vimeo_id to video_id, tags to tags_theme
  try { await pool.query("UPDATE videos SET video_id = vimeo_id WHERE video_id IS NULL"); } catch(e) {}
  try { await pool.query("UPDATE videos SET tags_theme = tags WHERE tags_theme = '' AND tags != ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN thumb_data BYTEA"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN thumb_settings JSONB"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN thumb_sharp BYTEA"); } catch(e) {}
}

async function getVideoRows() {
  const result = await pool.query('SELECT *, thumb_data IS NOT NULL AS has_thumb FROM videos ORDER BY sort_order ASC, id DESC');
  return result.rows.map(r => { const row = Object.assign({}, r); delete row.thumb_data; return row; });
}

// --- Basic Auth middleware ---
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

// --- Baked thumbnails ---
app.get('/thumb/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT thumb_data FROM videos WHERE id=$1', [req.params.id]);
    if (!result.rows[0] || !result.rows[0].thumb_data) return res.status(404).send('Not found');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(result.rows[0].thumb_data);
  } catch(e) { res.status(500).send('Error'); }
});

app.get('/thumb/:id/sharp', async (req, res) => {
  try {
    const result = await pool.query('SELECT thumb_sharp FROM videos WHERE id=$1', [req.params.id]);
    if (!result.rows[0] || !result.rows[0].thumb_sharp) return res.status(404).send('Not found');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(result.rows[0].thumb_sharp);
  } catch(e) { res.status(500).send('Error'); }
});

app.post('/thumb/:id', requireAuth, async (req, res) => {
  try {
    const { blurData, sharpData, imageData, settings } = req.body;
    const blurBase64 = (blurData || imageData || '').replace(/^data:image\/png;base64,/, '');
    if (!blurBase64) return res.status(400).json({ error: 'blurData required' });
    const blurBuf = Buffer.from(blurBase64, 'base64');
    if (sharpData) {
      const sharpBuf = Buffer.from(sharpData.replace(/^data:image\/png;base64,/, ''), 'base64');
      await pool.query('UPDATE videos SET thumb_data=$1, thumb_sharp=$2, thumb_settings=$3 WHERE id=$4',
        [blurBuf, sharpBuf, settings ? JSON.stringify(settings) : null, req.params.id]);
    } else {
      await pool.query('UPDATE videos SET thumb_data=$1, thumb_settings=$2 WHERE id=$3',
        [blurBuf, settings ? JSON.stringify(settings) : null, req.params.id]);
    }
    res.json({ ok: true });
  } catch(e) { console.error('POST /thumb error:', e.message); res.status(500).json({ error: e.message }); }
});

// --- API ---
function parseVideoUrl(url) {
  const vimeoMatch = (url || '').match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return { id: vimeoMatch[1], type: 'vimeo' };
  const ytMatch = (url || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return { id: ytMatch[1], type: 'youtube' };
  return { id: url, type: 'vimeo' };
}

app.get('/api/videos', async (req, res) => {
  res.json(await getVideoRows());
});

app.post('/api/videos', requireAuth, async (req, res) => {
  try {
    const { title, students, description, video_link, year, tags_theme, tags_medium, featured, archived, sort_order } = req.body;
    const { id, type } = parseVideoUrl(video_link);
    await pool.query(
      `INSERT INTO videos (title, students, description, video_id, video_type, vimeo_id, year, tags_theme, tags_medium, featured, archived, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [title, students, description, id, type, id, parseInt(year), tags_theme || '', tags_medium || '', featured ? 1 : 0, archived ? 1 : 0, parseInt(sort_order) || 0]);
    res.json({ ok: true });
  } catch(e) { console.error('POST /api/videos error:', e.message); res.status(500).json({ error: e.message }); }
});

app.put('/api/videos/:id', requireAuth, async (req, res) => {
  try {
    const { title, students, description, video_link, year, tags_theme, tags_medium, featured, archived, sort_order } = req.body;
    const { id, type } = parseVideoUrl(video_link);
    await pool.query(
      `UPDATE videos SET title=$1, students=$2, description=$3, video_id=$4, video_type=$5, vimeo_id=$6, year=$7, tags_theme=$8, tags_medium=$9, featured=$10, archived=$11, sort_order=$12 WHERE id=$13`,
      [title, students, description, id, type, id, parseInt(year), tags_theme || '', tags_medium || '', featured ? 1 : 0, archived ? 1 : 0, parseInt(sort_order) || 0, req.params.id]);
    res.json({ ok: true });
  } catch(e) { console.error('PUT /api/videos error:', e.message); res.status(500).json({ error: e.message }); }
});

app.delete('/api/videos/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM videos WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Student submit — always pending
app.post('/api/submit', requireStudent, async (req, res) => {
  try {
    const { title, students, description, video_link, year, tags_theme, tags_medium } = req.body;
    const { id, type } = parseVideoUrl(video_link);
    await pool.query(
      `INSERT INTO videos (title, students, description, video_id, video_type, vimeo_id, year, tags_theme, tags_medium, featured, archived, sort_order, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,999,'pending')`,
      [title, students, description, id, type, id, parseInt(year), tags_theme || '', tags_medium || '']);
    res.json({ ok: true });
  } catch(e) { console.error('POST /api/submit error:', e.message); res.status(500).json({ error: e.message }); }
});

// Admin approve/reject
app.put('/api/videos/:id/approve', requireAuth, async (req, res) => {
  const { featured, archived } = req.body;
  await pool.query('UPDATE videos SET status=$1, featured=$2, archived=$3 WHERE id=$4',
    ['approved', featured ? 1 : 0, archived ? 1 : 0, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/videos/:id/reject', requireAuth, async (req, res) => {
  await pool.query('UPDATE videos SET status=$1 WHERE id=$2', ['rejected', req.params.id]);
  res.json({ ok: true });
});

const vimeoCache = new Map();

app.get('/api/vimeo/:id', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = process.env.VIMEO_ACCESS_TOKEN;
  if (!token) return res.json({});
  const id = req.params.id;
  if (vimeoCache.has(id)) return res.json(vimeoCache.get(id));
  const options = {
    hostname: 'api.vimeo.com',
    path: '/videos/' + id,
    headers: { 'Authorization': 'bearer ' + token, 'Accept': 'application/json' },
    agent: false
  };
  const apiReq = https.get(options, (r) => {
    let body = '';
    r.on('data', chunk => { body += chunk; });
    r.on('end', () => {
      console.log('[vimeo proxy]', id, 'status:', r.statusCode);
      if (r.statusCode !== 200) {
        console.log('[vimeo proxy] error body:', body.slice(0, 200));
        return res.json({});
      }
      try {
        const data = JSON.parse(body);
        console.log('[vimeo proxy] width:', data.width, 'duration:', data.duration);
        const result = { duration: data.duration, width: data.width, height: data.height };
        if (result.duration || result.width) vimeoCache.set(id, result);
        res.json(result);
      } catch(e) {
        console.log('[vimeo proxy] parse error:', e.message);
        res.json({});
      }
    });
  });
  apiReq.on('error', (e) => { console.log('[vimeo proxy] request error:', e.message); if (!res.headersSent) res.json({}); });
  apiReq.setTimeout(8000, () => { apiReq.destroy(); console.log('[vimeo proxy] timeout for', id); if (!res.headersSent) res.json({}); });
});

// --- Public frontend ---
async function renderPublic(req, res, config) {
  const cfg = config || { bodyWeight: 300, titleWeight: 500, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: '' };
  const allVideos = (await getVideoRows()).filter(v => v.status === 'approved' || !v.status);
  let featured = allVideos.filter(v => v.featured && !v.archived);
  let archive = allVideos.filter(v => v.archived || !v.featured);

  // Force featured to fill complete rows, accounting for the intro block occupying
  // column 1 of rows 1-2. Valid counts are 4, 7, 10, 13… → remainder = (n-1) % 3
  const remainder = featured.length > 0 ? (featured.length - 1) % 3 : 0;
  if (remainder !== 0) {
    const overflow = featured.splice(featured.length - remainder, remainder);
    archive = [...overflow, ...archive];
  }

  // Collect tags by category
  const themeTags = new Set();
  const mediumTags = new Set();
  allVideos.forEach(v => {
    (v.tags_theme || v.tags || '').split(',').map(t => t.trim()).filter(t => t.length > 0).forEach(t => themeTags.add(t));
    (v.tags_medium || '').split(',').map(t => t.trim()).filter(t => t.length > 0).forEach(t => mediumTags.add(t));
  });

  function renderCard(v, isFeatured) {
    const tt = (v.tags_theme || v.tags || '').split(',').filter(Boolean).map(t => t.trim());
    const tm = (v.tags_medium || '').split(',').filter(Boolean).map(t => t.trim());
    const allTags = [...tt, ...tm];
    const themeSpans = tt.map(t => `<span data-tag="${t}">${t}</span>`).join('\n            ');
    const mediumSpans = tm.map(t => `<span data-tag="${t}" class="tag-medium">${t}</span>`).join('\n            ');
    const videoId = v.video_id || v.vimeo_id;
    const videoType = v.video_type || 'vimeo';
    const thumbHtml = v.has_thumb
      ? `<div class="thumb" data-baked="true"><img src="/thumb/${v.id}" class="baked-blur" alt="${esc(v.title)}"><img data-sharp="/thumb/${v.id}/sharp" class="baked-sharp" alt=""><div class="paper-tint"></div></div>`
      : `<div class="thumb"><img alt=""><div class="paper-tint"></div></div>`;
    return `
    <div class="card" data-featured="${isFeatured}" data-tags="${allTags.join(',')}" data-video-id="${videoId}" data-video-type="${videoType}" data-title="${esc(v.title)}" data-authors="${esc(v.students)}" data-year="${v.year}" data-desc="${esc(v.description)}">
      <div class="card-duration"></div>
      ${thumbHtml}
      <div class="meta">
        <div class="tags">
            ${themeSpans}
            ${mediumSpans}
        </div>
        <div class="card-right"><div class="card-title">${esc(v.title)}</div><span class="card-year" data-year="${v.year}">${v.year}</span></div>
      </div>
    </div>`;
  }

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  const featuredCards = featured.map(v => renderCard(v, 'true')).join('\n');
  const archiveCards = archive.map(v => renderCard(v, 'false')).join('\n');

  const themeTagCounts = {};
  const mediumTagCounts = {};
  allVideos.forEach(v => {
    (v.tags_theme || v.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => { themeTagCounts[t] = (themeTagCounts[t] || 0) + 1; });
    (v.tags_medium || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => { mediumTagCounts[t] = (mediumTagCounts[t] || 0) + 1; });
  });

  const themeButtons = [...themeTags].sort().map(t => `<button data-filter="${t}">${t}<span class="tag-count">${themeTagCounts[t] || 0}</span></button>`).join('\n    ');
  const mediumButtons = [...mediumTags].sort().map(t => `<button data-filter="${t}">${t}<span class="tag-count">${mediumTagCounts[t] || 0}</span></button>`).join('\n    ');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo</title>
<link href="${cfg.fontImport || 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@100;200;300;400;500;600;700&display=swap'}" rel="stylesheet">
<style>
  @font-face {
    font-family: 'Univers';
    src: url('/public/fonts/Univers.woff2') format('woff2');
    font-weight: 100 900;
    font-style: normal;
    font-display: swap;
  }
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  * { text-underline-offset: 4px; }
  html { scroll-behavior: smooth; scrollbar-width: none; }
  html::-webkit-scrollbar { display: none; }
  body {
    background: #f2f3f5;
    font-family: ${cfg.font || "'IBM Plex Sans'"}, Helvetica, Arial, sans-serif;
    font-weight: ${cfg.bodyWeight};
    color: #111;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    max-width: 1400px;
    margin: 0 auto;
    padding: 40px 40px 120px;
  }
  .filters {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 20px;
    margin-bottom: 40px;
  }
  .filters-left {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
  }
  .filters-row {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 8px;
    align-items: start;
  }
  .filters-row .filters-label {
    padding-top: 7px;
  }
  .filters-row .theme-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .filters-label {
    font-family: inherit;
    font-size: 11px;
    letter-spacing: 0.05em;
    color: #aaa;
    text-transform: lowercase;
    width: 52px;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .filters-medium {
    display: none;
    margin-top: 20px;
  }
  .filters-medium.visible,
  .filters.show-all .filters-medium {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 8px;
    align-items: start;
  }
  .filters-medium .filters-label {
    padding-top: 7px;
  }
  .filters-medium .medium-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .filters-medium button {
    border-style: dashed;
  }
  .filters-extra {
    display: none;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 52px;
    margin-top: 6px;
  }
  .filters.show-all .filters-extra { display: flex; }
  .filters-extra .tag-close {
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
  }
  .filters-extra .tag-close:hover { border-color: #1e40af; color: #1e40af; }
  .filters button {
    font-family: inherit;
    font-size: 14px;
    letter-spacing: 0.02em;
    padding: 6px 15px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .filters button:hover { border-color: #1e40af; color: #1e40af; }
  .filters button.active { background: #1e40af; border-color: #1e40af; color: #fff; }
  .tag-count {
    font-size: 8px;
    vertical-align: super;
    opacity: 0.5;
    margin-left: 2px;
    line-height: 0;
    font-weight: 400;
    letter-spacing: 0;
  }
  .tag-expand {
    font-family: inherit;
    font-size: 16px;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tag-expand:hover { border-color: #1e40af; color: #1e40af; }
  .filters.show-all .tag-expand { display: none; }
  /* Prevent phantom flex items in default (row) layout */
  .filters::before, .filters::after { display: none; }
  .filters-search-wrap {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding-top: 7px;
  }
  .filters-search-icon {
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    color: #1e40af;
  }
  .filters-search-input {
    font-family: inherit;
    font-size: 13px;
    border: none;
    border-bottom: 1px solid #aac0e8;
    background: transparent;
    outline: none;
    color: #1e40af;
    width: 140px;
    padding: 0 3px 2px;
  }
  .filters-search-input::placeholder { color: transparent; }
  .filters-search-input:focus { border-bottom-color: #1e40af; }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-flow: dense;
    gap: 28px;
  }
  .card {
    position: relative;
    opacity: 0;
    transform: translateY(30px);
    animation: fadeUp 0.6s ease forwards;
  }
  .card.hidden { display: none !important; }
  .card[data-featured="false"] { display: none; }
  .grid.show-archive .card[data-featured="false"] { display: block; }
  .card-duration {
    position: absolute;
    left: -16px;
    top: 0;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: inherit;
    font-size: 11px;
    letter-spacing: 0.03em;
    color: #aaa;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .card .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #f0f0f0;
    overflow: hidden;
    cursor: pointer;
    isolation: isolate;
  }
  .card .thumb img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }
  .card .thumb::before {
    content: '';
    position: absolute;
    inset: 0;
    border: 1px solid rgba(0,0,0,0.35);
    z-index: 10;
    pointer-events: none;
    transition: border-color 0.2s ease;
  }
  .card:hover .thumb::before {
    border-color: #1e40af;
  }
  .card .thumb canvas {
    position: absolute;
    inset: 0;
    width: 100%; height: 100%;
  }
  .card .thumb .baked-blur {
    position: absolute;
    inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }
  .card .thumb .baked-sharp {
    position: absolute;
    inset: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
    opacity: 0;
    transition: opacity 0.45s ease-in-out;
  }
  .card .thumb[data-baked] canvas { display: none; }
  .card .thumb .paper-tint {
    position: absolute;
    inset: 0;
    background: rgb(255, 253, 244);
    mix-blend-mode: multiply;
    pointer-events: none;
    z-index: 2;
    display: none;
  }
  .paper-tint-active .card .thumb .paper-tint {
    display: block;
  }
  .card .thumb::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0;
    height: 0;
    border-style: solid;
    border-width: 14px 0 14px 22px;
    border-color: transparent transparent transparent rgba(255,255,255,0.8);
    opacity: 0;
    transition: opacity 0.25s ease;
    pointer-events: none;
    z-index: 5;
  }
  .card .thumb:hover::after {
    opacity: 1;
  }
  .card .meta {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    padding: 4px 0 2px;
    gap: 12px;
  }
  .card .card-right { order: -1; }
  .card .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .card:hover .tags {
    opacity: 1;
    pointer-events: auto;
  }
  .card .tags span {
    font-size: 11px;
    letter-spacing: 0.03em;
    color: ${cfg.tagColor};
    cursor: pointer;
    transition: color 0.2s ease;
  }
  .card .tags span:hover { color: #1e40af; }
  .card .tags span.active { color: #1e40af; text-decoration: underline; text-underline-offset: 2px; }
  .card .tags span::before { content: "↳ "; opacity: 0.4; }
  .card .tags span.tag-medium { font-style: italic; }
  .card .tags:has(span.active) { opacity: 1; pointer-events: auto; }
  .card .card-right {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-shrink: 0;
  }
  .card .card-title {
    font-size: 11px;
    letter-spacing: 0.03em;
    color: #111;
    font-weight: ${cfg.titleWeight};
    text-align: left;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 0.2s ease;
  }
  .card .card-year {
    font-size: 11px;
    letter-spacing: 0.03em;
    color: #777;
    cursor: pointer;
    transition: color 0.2s ease;
    white-space: nowrap;
  }
  .card .card-year:hover { color: #1e40af; }
  .card:hover .card-duration { opacity: 1; color: #1e40af; }
  .card:hover .card-title { text-decoration: underline; color: #1e40af; }
  .card:hover .card-year { color: #1e40af; }
  .card:hover .tags span { color: #555; }
  .card-logos .thumb::after { display: none; }
  .card-logos .thumb:hover img { transform: none; }
  .intro-block {
    grid-column: 1;
    grid-row: 1 / 3;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding: 0 20px 0 0;
  }
  .intro-block .intro-text {
    font-family: inherit;
    font-size: ${cfg.introSize || '22px'};
    line-height: 1.55;
    color: #111;
  }
  .intro-block .intro-text p {
    margin-bottom: 16px;
  }
  .intro-block .intro-text a {
    color: #1e40af;
    text-decoration: none;
    font-weight: 400;
  }
  .intro-block .intro-text a:hover { text-decoration: underline; }
  .intro-block .intro-text a.year-filter {
    font-weight: 400;
    text-decoration: none;
    cursor: pointer;
    color: #1e40af;
  }
  .intro-block .intro-text a.year-filter:hover { text-decoration: underline; }
  .intro-block .intro-text a.year-filter.active { text-decoration: underline; }
  .inline-search-wrap { white-space: nowrap; display: inline-flex; align-items: center; vertical-align: middle; }
  .inline-search-wrap::before { content: "["; color: #999; }
  .inline-search-wrap::after { content: "]"; color: #999; }
  .inline-search-icon { width: 13px; height: 13px; flex-shrink: 0; color: #1e40af; vertical-align: middle; margin-right: 3px; }
  .inline-search-input {
    font-family: inherit;
    font-size: inherit;
    border: none;
    border-bottom: 1px solid #aac0e8;
    background: transparent;
    outline: none;
    color: #1e40af;
    width: 180px;
    padding: 0 5px 1px;
    vertical-align: baseline;
  }
  .inline-search-input::placeholder { color: #aac0e8; }
  .inline-search-input:focus { border-bottom-color: #1e40af; }
  .intro-block .intro-text strong {
    font-weight: 500;
  }
  .labo-hover {
    position: relative;
    display: inline;
  }
  .labo-logo-hover {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    height: 80px;
    width: auto;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.25s ease;
    z-index: 10;
  }
  .labo-hover:hover .labo-logo-hover {
    opacity: 1;
  }
  .kuleuven-hover { display: none; }
  .archive-toggle {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-top: 61px;
    position: relative;
  }
  .archive-toggle button {
    width: 46px;
    height: 46px;
    padding: 0;
    border: 1px solid #ccc;
    border-radius: 50%;
    background: transparent;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .archive-toggle button:hover { border-color: #1e40af; color: #1e40af; }
  .archive-toggle button svg { stroke: currentColor; }
  .archive-toggle-label {
    position: absolute;
    left: calc(50% + 38px);
    font-size: 13px;
    color: #aaa;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .archive-toggle:not(.is-open) button:hover ~ .archive-toggle-label { opacity: 1; }
  .lightbox {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0,0,0,0.92);
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .lightbox.open { display: flex; }
  .lightbox .lb-inner {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    max-width: 960px;
    padding: 0 40px;
  }
  .lightbox .lb-video {
    width: 100%;
    aspect-ratio: 16/9;
  }
  .lightbox iframe { width: 100%; height: 100%; border: none; display: block; }
  .lightbox .lb-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 20px 0 0;
  }
  .lightbox .lb-meta h2 {
    font-family: inherit;
    font-weight: 500;
    font-size: 16px;
    line-height: 1.3;
    color: #fff;
    margin-bottom: 3px;
    text-align: left;
  }
  .lightbox .lb-meta .lb-authors {
    font-family: inherit;
    font-size: 14px;
    color: rgba(255,255,255,0.6);
    text-align: left;
    margin-bottom: 2px;
  }
  .lightbox .lb-meta .lb-year {
    font-family: inherit;
    font-size: 14px;
    color: rgba(255,255,255,0.6);
    text-align: left;
    margin-bottom: 14px;
  }
  .lightbox .lb-read-more {
    font-family: inherit;
    font-size: 13px;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    text-align: left;
    transition: color 0.2s;
    border: none;
    background: none;
    padding: 0;
    letter-spacing: 0.02em;
  }
  .lightbox .lb-read-more:hover { color: rgba(255,255,255,0.8); }
  .lightbox .lb-desc-wrap {
    width: 100%;
    text-align: left;
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.4s ease, margin 0.4s ease;
    margin-top: 0;
  }
  .lightbox .lb-desc-wrap.open {
    max-height: 500px;
    margin-top: 12px;
  }
  .lightbox .lb-desc-wrap p {
    font-family: inherit;
    font-size: 12px;
    line-height: 1.6;
    color: rgba(255,255,255,0.55);
    column-count: 2;
    column-gap: 32px;
    column-fill: auto;
    height: auto;
    max-height: 120px;
  }
  .lightbox .lb-close {
    position: absolute;
    top: -40px;
    left: 40px;
    font-size: 14px;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.05em;
    transition: color 0.2s;
  }
  .lightbox .lb-close:hover { color: #fff; }
  .site-footer {
    max-width: 1400px;
    margin: 0 auto;
    padding: 32px 40px 40px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 40px;
  }
  .site-footer .footer-text {
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
    color: #111;
  }
  .site-footer .footer-logos {
    flex-shrink: 0;
  }
  .site-footer .footer-logos img {
    height: 90px;
    width: auto;
    opacity: 1;
  }
  @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 900px) {
    .page { padding: 32px 20px 80px; }
    .grid { grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .intro-block { grid-column: 1 / -1; grid-row: auto; }
  }
  @media (max-width: 768px) {
    .lightbox .lb-inner { padding: 0 20px; }
    .lightbox .lb-close { top: -36px; left: 20px; }
  }
  @media (max-width: 540px) {
    .page { padding: 24px 16px 60px; }
    .grid { grid-template-columns: 1fr; gap: 12px; }
  }
  ${cfg.extraCSS || ''}
</style>
</head>
<body class="${cfg.paperTint ? 'paper-tint-active' : ''}">
<div class="page">
  ${cfg.label ? '<div style="position:fixed;top:10px;right:10px;font-size:11px;color:#aaa;z-index:999;">' + cfg.label + '</div>' : ''}
  <div class="filters" id="filters">
    <div class="filters-left">
      <div class="filters-row" id="filters-row" style="grid-template-columns:1fr">
        <div class="theme-tags">
          <button class="active" data-filter="all">all</button>
          ${themeButtons}
          <button class="tag-expand" id="tag-expand" title="show all tags">+</button>
        </div>
      </div>
      <div class="filters-extra" id="filters-extra"></div>
      <div class="filters-row filters-medium">
        <span class="filters-label">medium</span>
        <div class="medium-tags">${mediumButtons}</div>
      </div>
    </div>
    <div class="filters-search-wrap">
      <svg class="filters-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>
      <input type="text" class="filters-search-input" placeholder="">
    </div>
  </div>
  <div id="grid-area">
  <div class="grid">
    <div class="intro-block" id="intro-block">
      <div class="intro-text">
        <p>This video archive brings together a series of films produced by architecture students at <a href="https://arch.kuleuven.be/" style="text-decoration:none;">KU Leuven</a> within the <span class="labo-hover"><a href="https://www.lab-o.club/">lab-O</a><img class="labo-logo-hover" src="/public/logo-labo.png" alt="lab-O"></span> trajectory for the third-year bachelor studio Positioneren 2: Stelling–Strategie. The archive includes works produced from 2021 to the present.</p>
        <p>Each academic year is structured around a different thematic framework, including <a href="#" class="year-filter" data-year="2022">Frame</a>, <a href="#" class="year-filter" data-year="2023">The Gaze</a>, <a href="#" class="year-filter" data-year="2024">Werk</a>, <a href="#" class="year-filter" data-year="2025">Il n'y a pas de hors-archi&shy;tecture</a>, and most recently (2026), <a href="#" class="year-filter" data-year="2026">In Limbo</a>.</p>
        <p>The archive can be browsed by theme using the tags above, or by year by clicking any of the studio titles. Search by title, student name, or keyword: <span class="inline-search-wrap"><svg class="inline-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg><input type="text" id="search-input" class="inline-search-input" placeholder=""></span></p>
      </div>
    </div>
${featuredCards}
${archiveCards}
  </div>
  <div id="medium-axis"></div>
  </div>
  <div class="archive-toggle" id="archive-toggle" ${archive.length === 0 ? 'style="display:none"' : ''}>
    <button id="archive-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    <span class="archive-toggle-label">load the complete archive</span>
  </div>
</div>

<div class="site-footer">
  <div class="footer-text">Students were taught by Stijn Colon, Lukas Claessens, Bert Stoffels, Yann Courouble, Carl Bourgeois, Lodewijk Heylen at KU Leuven. Website made by Stijn Colon in 2026.</div>
  <div class="footer-logos"><img src="/public/logos-outline.png" alt="lab-O & KU Leuven"></div>
</div>

<div class="lightbox" id="lightbox">
  <div class="lb-inner">
    <div class="lb-close">close ✕</div>
    <div class="lb-video">
      <iframe id="lb-iframe" src="" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>
    </div>
    <div class="lb-meta">
      <h2 id="lb-title"></h2>
      <div class="lb-authors" id="lb-authors"></div>
      <div class="lb-year" id="lb-year"></div>
      <button class="lb-read-more" id="lb-read-more">read synopsis ↓</button>
      <div class="lb-desc-wrap" id="lb-desc-wrap">
        <p id="lb-desc"></p>
      </div>
    </div>
  </div>
</div>

<script>
  window.__ditherMode = '${cfg.ditherMode || 'default'}';
  // Thumbnails + dithering
  function getDominantColor(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    // Build hue histogram from saturated pixels
    const hueBuckets = new Array(360).fill(0);
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i]/255, g = d[i+1]/255, b = d[i+2]/255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const delta = max - min;
      if (delta < 0.08) continue; // skip grays
      const lum = (max + min) / 2;
      if (lum < 0.1 || lum > 0.9) continue; // skip very dark/bright
      let hue = 0;
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = Math.round(hue * 60);
      if (hue < 0) hue += 360;
      hueBuckets[hue]++;
    }
    // Find dominant hue
    let maxCount = 0, domHue = 0;
    // Smooth the histogram
    for (let h = 0; h < 360; h++) {
      let sum = 0;
      for (let j = -15; j <= 15; j++) sum += hueBuckets[(h + j + 360) % 360];
      if (sum > maxCount) { maxCount = sum; domHue = h; }
    }

    // Map hue to palette (tinted whites from pastel yellow, cyan, red):
    const palette = [
      { color: [245, 240, 220], hue: 50 },     // tinted white yellow
      { color: [220, 242, 242], hue: 180 },     // tinted white cyan
      { color: [245, 225, 225], hue: 0 },       // tinted white red
    ];

    let best = palette[0].color, bestDist = Infinity;
    for (const p of palette) {
      let dist = Math.abs(domHue - p.hue);
      if (dist > 180) dist = 360 - dist; // wrap around
      if (dist < bestDist) { bestDist = dist; best = p.color; }
    }
    return best;
  }

  // Dither configurations for test routes
  const ditherConfigs = {
    default: { w: 500, threshold: 160, contrast: 1.0, colorMode: 'tinted' },
    t1:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'bw' },
    t2:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'mono_yellow' },
    t3:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'mono_cyan' },
    t4:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'mono_red' },
    t5:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'inverted' },
    t6:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'inverted_tint' },
    t7:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'sepia' },
    t8:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'cool' },
    t9:  { w: 500, threshold: 160, contrast: 1.0, colorMode: 'green' },
    t10: { w: 500, threshold: 160, contrast: 1.0, colorMode: 'newspaper' },
    t11: { w: 200, threshold: 160, contrast: 1.0, colorMode: 'tinted' },
    t12: { w: 700, threshold: 160, contrast: 1.0, colorMode: 'tinted' },
    t13: { w: 500, threshold: 80,  contrast: 1.0, colorMode: 'tinted' },
    t14: { w: 500, threshold: 200, contrast: 1.0, colorMode: 'tinted' },
    t15: { w: 500, threshold: 160, contrast: 1.8, colorMode: 'tinted' },
    t16: { w: 500, threshold: 160, contrast: 0.6, colorMode: 'tinted' },
    t17: { w: 300, threshold: 100, contrast: 1.3, colorMode: 'bw' },
    t18: { w: 700, threshold: 180, contrast: 0.8, colorMode: 'tinted' },
    t19: { w: 400, threshold: 140, contrast: 1.2, colorMode: 'inverted' },
    t20: { w: 500, threshold: 150, contrast: 1.1, colorMode: 'mono_yellow' },
    d1:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [180,50,50],   bgColor: [255,255,255] },  // red dots on white
    d2:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [50,50,180],   bgColor: [255,255,255] },  // blue dots on white
    d3:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [50,130,80],   bgColor: [255,255,255] },  // green dots on white
    d4:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [180,120,50],  bgColor: [255,255,255] },  // orange dots on white
    d5:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [100,100,100], bgColor: [245,242,235] },  // grey dots on cream
    d6:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [60,60,120],   bgColor: [240,240,250] },  // navy dots on lavender
    d7:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [120,40,40],   bgColor: [250,240,235] },  // burgundy dots on blush
    d8:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [40,90,70],    bgColor: [240,250,245] },  // forest dots on mint
    d9:  { w: 500, threshold: 160, contrast: 1.0, dotColor: [80,80,80],    bgColor: [255,255,255] },  // dark grey dots on white
    d10: { w: 500, threshold: 160, contrast: 1.0, dotColor: [0,0,0],       bgColor: [245,240,220] },  // black dots on warm cream
    d11: { w: 300, threshold: 140, contrast: 1.2, dotColor: [180,50,50],   bgColor: [255,255,255] },  // chunky red dots
    d12: { w: 700, threshold: 170, contrast: 0.9, dotColor: [50,50,180],   bgColor: [250,250,255] },  // hires soft blue
    d13: { w: 500, threshold: 120, contrast: 1.0, dotColor: [50,130,80],   bgColor: [255,255,255] },  // dark green, more dots
    d14: { w: 500, threshold: 190, contrast: 0.8, dotColor: [100,100,100], bgColor: [255,255,255] },  // very light grey, airy
    d15: { w: 500, threshold: 160, contrast: 1.4, dotColor: [0,0,0],       bgColor: [255,255,255] },  // high contrast pure b&w
    d16: { w: 400, threshold: 150, contrast: 1.0, dotColor: [140,80,30],   bgColor: [255,250,240] },  // brown/terracotta on warm white
    d17: { w: 500, threshold: 160, contrast: 1.0, dotColor: [100,60,120],  bgColor: [250,245,255] },  // purple dots on lilac
    d18: { w: 500, threshold: 160, contrast: 1.0, dotColor: [0,0,0],       bgColor: [220,242,242] },  // black on cyan bg
    d19: { w: 500, threshold: 160, contrast: 1.0, dotColor: [0,0,0],       bgColor: [245,225,225] },  // black on blush bg
    d20: { w: 500, threshold: 160, contrast: 1.0, dotColor: [0,0,0],       bgColor: [245,240,220] },
    c1:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [140,75,45],  bg: [255,250,245], hue: 0 }
    ]},
    c2:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [120,45,55],  bg: [255,248,248], hue: 0 }
    ]},
    c3:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [150,90,95],  bg: [255,248,248], hue: 0 }
    ]},
    c4:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [160,120,40], bg: [255,252,242], hue: 0 }
    ]},
    c5:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [90,60,110],  bg: [252,248,255], hue: 0 }
    ]},
    c6:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [80,80,80],   bg: [255,255,255], hue: 0 }
    ]},
    c7:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [110,80,50],  bg: [255,252,248], hue: 0 }
    ]},
    c8:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [150,60,40],  bg: [255,248,245], hue: 0 }
    ]},
    c9:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [100,50,80],  bg: [255,248,252], hue: 0 }
    ]},
    c10: { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [140,75,45],  bg: [255,250,245], hue: 0 }
    ]},
    r1:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [180,100,100],bg: [255,248,248], hue: 0 }
    ]},
    r2:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [150,55,45],  bg: [255,248,245], hue: 0 }
    ]},
    r3:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [180,120,105],bg: [255,250,248], hue: 0 }
    ]},
    r4:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [140,85,90],  bg: [252,248,248], hue: 0 }
    ]},
    r5:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [160,80,50],  bg: [255,250,245], hue: 0 }
    ]},
    r6:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [170,110,70], bg: [255,252,248], hue: 0 }
    ]},
    r7:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    r8:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [160,100,80], bg: [255,252,250], hue: 0 }
    ]},
    r9:  { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,80,100], bg: [252,248,252], hue: 0 }
    ]},
    r10: { w: 500, threshold: 160, contrast: 1.0, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [170,130,50], bg: [255,253,245], hue: 0 }
    ]},
    b1:  { w: 500, threshold: 140, contrast: 1.0, targetLum: 130, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b2:  { w: 500, threshold: 180, contrast: 1.0, targetLum: 170, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b3:  { w: 500, threshold: 160, contrast: 1.2, targetLum: 150, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b4:  { w: 500, threshold: 160, contrast: 0.8, targetLum: 150, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b5:  { w: 500, threshold: 170, contrast: 1.0, targetLum: 160, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b6:  { w: 500, threshold: 150, contrast: 1.0, targetLum: 140, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    blue_only: { w: 650, threshold: 140, contrast: 1.1, targetLum: 150, dotColor: [60, 60, 120], bgColor: [248, 248, 255] },
    b7:  { w: 650, threshold: 155, contrast: 1.0, targetLum: 185, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b7lo:{ w: 400, threshold: 155, contrast: 1.0, targetLum: 185, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b8:  { w: 500, threshold: 180, contrast: 0.9, targetLum: 160, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b9:  { w: 500, threshold: 165, contrast: 1.05, targetLum: 155, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    b10: { w: 500, threshold: 155, contrast: 0.95, targetLum: 145, combo: [
      { dot: [60,60,120],  bg: [248,248,255], hue: 50 },
      { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
      { dot: [130,65,45],  bg: [255,250,248], hue: 0 }
    ]},
    // g-series: risograph effect — grey base + hue-matched accent in saturated regions
    // g1-g3: option A (blur saturation map, soft blend zone, relative threshold)
    // g4-g5: option B (two-pass Floyd-Steinberg on saturation layer)
    g1: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, greyAccent: {
      mode: 'blur', blurRadius: 8,  thresholdBias: 0.5, blendZone: 0.2,
      greyDot: [100,100,100], greyBg: [245,245,245],
      accents: [ { dot: [60,60,120],  tintBg: [234,234,250], hue: 50  },
                 { dot: [40,90,70],   tintBg: [234,250,241], hue: 180 },
                 { dot: [130,65,45],  tintBg: [250,240,234], hue: 0   } ] } },
    g2: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, greyAccent: {
      mode: 'blur', blurRadius: 15, thresholdBias: 0.5, blendZone: 0.2,
      greyDot: [100,100,100], greyBg: [245,245,245],
      accents: [ { dot: [60,60,120],  tintBg: [234,234,250], hue: 50  },
                 { dot: [40,90,70],   tintBg: [234,250,241], hue: 180 },
                 { dot: [130,65,45],  tintBg: [250,240,234], hue: 0   } ] } },
    g3: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, greyAccent: {
      mode: 'blur', blurRadius: 20, thresholdBias: 1.0, blendZone: 0.2,
      greyDot: [100,100,100], greyBg: [245,245,245],
      accents: [ { dot: [60,60,120],  tintBg: [234,234,250], hue: 50  },
                 { dot: [40,90,70],   tintBg: [234,250,241], hue: 180 },
                 { dot: [130,65,45],  tintBg: [250,240,234], hue: 0   } ] } },
    g4: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, greyAccent: {
      mode: 'twopass', thresholdBias: 0.5,
      greyDot: [100,100,100], greyBg: [245,245,245],
      accents: [ { dot: [60,60,120],  tintBg: [234,234,250], hue: 50  },
                 { dot: [40,90,70],   tintBg: [234,250,241], hue: 180 },
                 { dot: [130,65,45],  tintBg: [250,240,234], hue: 0   } ] } },
    g5: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, greyAccent: {
      mode: 'twopass', thresholdBias: 1.0,
      greyDot: [100,100,100], greyBg: [245,245,245],
      accents: [ { dot: [60,60,120],  tintBg: [234,234,250], hue: 50  },
                 { dot: [40,90,70],   tintBg: [234,250,241], hue: 180 },
                 { dot: [130,65,45],  tintBg: [250,240,234], hue: 0   } ] } },
    // g1a-g1c: strict 3-colour dither (single FS pass → 3 levels → 3 palette entries)
    g1a: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, threeColor: {
      mode: 'fixed', threshold2: 205,
      dark:  [60,60,120], mid: [130,65,45], light: [255,252,245]
    }},
    g1b: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, threeColor: {
      mode: 'monofamily', threshold2: 205,
      accents: [ { dark: [60,60,120],  mid: [154,154,188], light: [248,248,255], hue: 50  },
                 { dark: [40,90,70],   mid: [144,173,160], light: [248,255,250], hue: 180 },
                 { dark: [130,65,45],  mid: [193,158,147], light: [255,250,248], hue: 0   } ]
    }},
    g1c: { w: 500, threshold: 155, contrast: 1.0, targetLum: 185, threeColor: {
      mode: 'twofamily', threshold2: 205,
      accents: [ { dot: [60,60,120],  bg: [248,248,255], hue: 50  },
                 { dot: [40,90,70],   bg: [248,255,250], hue: 180 },
                 { dot: [130,65,45],  bg: [255,250,248], hue: 0   } ]
    }},
    m1: { w: 800, mono: true }
  };
  const activeDitherConfig = ditherConfigs[window.__ditherMode || 'default'] || ditherConfigs.default;

  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;
    if (h < 60)       { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else              { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function rgbToLab(r, g, b) {
    function toLinear(v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
    const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
    const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
    function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
    const fx = f(x / 0.95047), fy = f(y), fz = f(z / 1.08883);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function labDist(lab1, lab2) {
    const dL = lab1[0] - lab2[0], da = lab1[1] - lab2[1], db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function buildMonoPalette() {
    const H = 210, S = 0.333;
    const shades = [];
    for (let i = 0; i < 8; i++) {
      let l = 85 - i * (65 / 7);
      const s = S * (1 - 0.55 * 0.7);
      l = Math.min(95, l + (85 - l) * 0.55 * 0.6);
      l = Math.min(95, l + 12);
      shades.push(hslToRgb(H, s, l / 100));
    }
    const all = [...shades, [248, 245, 238], [120, 120, 120]];
    all.sort((a, b) => (b[0] * 0.299 + b[1] * 0.587 + b[2] * 0.114) - (a[0] * 0.299 + a[1] * 0.587 + a[2] * 0.114));
    return all;
  }

  const M1_PALETTE = buildMonoPalette();
  const M1_PALETTE_LAB = M1_PALETTE.map(c => rgbToLab(c[0], c[1], c[2]));

  function ditherImage(img, thumb, variation) {
    const cfg = activeDitherConfig;
    const canvas = document.createElement('canvas');
    const w = cfg.w;
    const h = Math.round(w * (9/16));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = w / h;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (imgRatio > canvasRatio) {
      sw = img.naturalHeight * canvasRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / canvasRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

    if (cfg.mono) {
      const mw = w;
      const mh = h;

      const raw = ctx.getImageData(0, 0, mw, mh);
      const pd = raw.data;
      for (let i = 0; i < pd.length; i += 4) {
        let pr = pd[i], pg = pd[i+1], pb = pd[i+2];
        // 1. Shadows lift +60
        pr = 60 + pr * 195 / 255; pg = 60 + pg * 195 / 255; pb = 60 + pb * 195 / 255;
        pr = Math.max(0, Math.min(255, pr)); pg = Math.max(0, Math.min(255, pg)); pb = Math.max(0, Math.min(255, pb));
        // 2. Brightness +40
        pr += 40; pg += 40; pb += 40;
        pr = Math.max(0, Math.min(255, pr)); pg = Math.max(0, Math.min(255, pg)); pb = Math.max(0, Math.min(255, pb));
        // 3. Gamma 1.4
        pr = 255 * Math.pow(pr / 255, 1 / 1.4); pg = 255 * Math.pow(pg / 255, 1 / 1.4); pb = 255 * Math.pow(pb / 255, 1 / 1.4);
        pr = Math.max(0, Math.min(255, pr)); pg = Math.max(0, Math.min(255, pg)); pb = Math.max(0, Math.min(255, pb));
        // 4. Contrast 0.8
        pr = ((pr / 255 - 0.5) * 0.8 + 0.5) * 255;
        pg = ((pg / 255 - 0.5) * 0.8 + 0.5) * 255;
        pb = ((pb / 255 - 0.5) * 0.8 + 0.5) * 255;
        pd[i]   = Math.max(0, Math.min(255, pr));
        pd[i+1] = Math.max(0, Math.min(255, pg));
        pd[i+2] = Math.max(0, Math.min(255, pb));
      }

      const preProc = new Float32Array(mw * mh * 3);
      for (let i = 0; i < mw * mh; i++) {
        preProc[i*3]   = pd[i*4];
        preProc[i*3+1] = pd[i*4+1];
        preProc[i*3+2] = pd[i*4+2];
      }

      function ditherM1(noiseX, noiseY, noiseRadius) {
        const rd = new Float32Array(preProc);
        if (noiseRadius === -1) {
          for (let i = 0; i < mw * mh; i++) {
            const n = (Math.random() - 0.5) * 20;
            rd[i*3] += n; rd[i*3+1] += n; rd[i*3+2] += n;
          }
        } else if (noiseRadius > 0) {
          for (let y = 0; y < mh; y++) {
            for (let x = 0; x < mw; x++) {
              const dist = Math.sqrt((x - noiseX) ** 2 + (y - noiseY) ** 2);
              if (dist < noiseRadius) {
                const n = (Math.random() - 0.5) * (1 - dist / noiseRadius) * 40;
                const i = y * mw + x;
                rd[i*3] += n; rd[i*3+1] += n; rd[i*3+2] += n;
              }
            }
          }
        }
        const outImg = ctx.createImageData(mw, mh);
        for (let y = 0; y < mh; y++) {
          for (let x = 0; x < mw; x++) {
            const idx = y * mw + x;
            const qr = Math.max(0, Math.min(255, rd[idx*3]));
            const qg = Math.max(0, Math.min(255, rd[idx*3+1]));
            const qb = Math.max(0, Math.min(255, rd[idx*3+2]));
            const pxLab = rgbToLab(qr, qg, qb);
            let bestIdx = 0, bestDist = Infinity;
            for (let p = 0; p < M1_PALETTE_LAB.length; p++) {
              const d = labDist(pxLab, M1_PALETTE_LAB[p]);
              if (d < bestDist) { bestDist = d; bestIdx = p; }
            }
            const [nr, ng, nb] = M1_PALETTE[bestIdx];
            const er = qr - nr, eg = qg - ng, eb = qb - nb;
            if (x + 1 < mw) {
              rd[(idx+1)*3] += er*7/16; rd[(idx+1)*3+1] += eg*7/16; rd[(idx+1)*3+2] += eb*7/16;
            }
            if (y + 1 < mh && x > 0) {
              rd[(idx+mw-1)*3] += er*3/16; rd[(idx+mw-1)*3+1] += eg*3/16; rd[(idx+mw-1)*3+2] += eb*3/16;
            }
            if (y + 1 < mh) {
              rd[(idx+mw)*3] += er*5/16; rd[(idx+mw)*3+1] += eg*5/16; rd[(idx+mw)*3+2] += eb*5/16;
            }
            if (y + 1 < mh && x + 1 < mw) {
              rd[(idx+mw+1)*3] += er*1/16; rd[(idx+mw+1)*3+1] += eg*1/16; rd[(idx+mw+1)*3+2] += eb*1/16;
            }
            outImg.data[idx*4]   = nr;
            outImg.data[idx*4+1] = ng;
            outImg.data[idx*4+2] = nb;
            outImg.data[idx*4+3] = 255;
          }
        }
        ctx.putImageData(outImg, 0, 0);
      }

      ditherM1(0, 0, 0);
      canvas.style.imageRendering = 'pixelated';
      thumb.appendChild(canvas);

      let shimmerActive = false;
      let shimmerFrame = null;
      function shimmerLoopM1() {
        if (!shimmerActive) return;
        ditherM1(0, 0, -1);
        setTimeout(() => { shimmerFrame = requestAnimationFrame(shimmerLoopM1); }, 120);
      }
      thumb.addEventListener('mouseenter', () => { shimmerActive = true; shimmerLoopM1(); });
      thumb.addEventListener('mouseleave', () => {
        shimmerActive = false;
        if (shimmerFrame) cancelAnimationFrame(shimmerFrame);
        ditherM1(0, 0, 0);
      });
      return;
    }

    const [cr, cg, cb] = getDominantColor(ctx, w, h);

    // If combo palette, pick dot+bg colors using same hue detection as main page
    let finalDotColor = cfg.dotColor || null;
    let finalBgColor = cfg.bgColor || null;
    if (cfg.combo) {
      // getDominantColor already computes domHue internally - let's just replicate its palette matching
      // but with combo colors instead of tinted whites
      const d = ctx.getImageData(0, 0, w, h).data;
      const hueBuckets = new Array(360).fill(0);
      for (let i = 0; i < d.length; i += 16) {
        const rv = d[i]/255, gv = d[i+1]/255, bv = d[i+2]/255;
        const mx = Math.max(rv, gv, bv), mn = Math.min(rv, gv, bv);
        const delta = mx - mn;
        if (delta < 0.08) continue;
        const lum = (mx + mn) / 2;
        if (lum < 0.1 || lum > 0.9) continue;
        let hue = 0;
        if (mx === rv) hue = ((gv - bv) / delta) % 6;
        else if (mx === gv) hue = (bv - rv) / delta + 2;
        else hue = (rv - gv) / delta + 4;
        hue = Math.round(hue * 60);
        if (hue < 0) hue += 360;
        hueBuckets[hue]++;
      }
      let maxCount = 0, domHue = 0;
      for (let hh = 0; hh < 360; hh++) {
        let sum = 0;
        for (let j = -15; j <= 15; j++) sum += hueBuckets[(hh + j + 360) % 360];
        if (sum > maxCount) { maxCount = sum; domHue = hh; }
      }
      let bestCombo = cfg.combo[0], bestDist = Infinity;
      for (const c of cfg.combo) {
        let dist = Math.abs(domHue - c.hue);
        if (dist > 180) dist = 360 - dist;
        if (dist < bestDist) { bestDist = dist; bestCombo = c; }
      }
      finalDotColor = bestCombo.dot;
      finalBgColor = bestCombo.bg;
    }
    const applyCfg = { ...cfg, dotColor: finalDotColor, bgColor: finalBgColor };

    const origData = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    
    // First pass: compute average luminance
    let totalLum = 0;
    for (let i = 0; i < origData.data.length; i += 4) {
      totalLum += origData.data[i] * 0.299 + origData.data[i+1] * 0.587 + origData.data[i+2] * 0.114;
    }
    const avgLum = totalLum / (w * h);
    
    // Auto-normalize: target configurable (default 150)
    const targetLum = cfg.targetLum || 150;
    let brightnessBoost = 0;
    if (avgLum < targetLum) {
      brightnessBoost = (targetLum - avgLum) * 0.20;
    }
    
    // Second pass: apply normalization + contrast
    for (let i = 0; i < origData.data.length; i += 4) {
      let lum = origData.data[i] * 0.299 + origData.data[i+1] * 0.587 + origData.data[i+2] * 0.114;
      lum = lum + brightnessBoost;
      lum = ((lum / 255 - 0.5) * cfg.contrast + 0.5) * 255;
      lum = Math.max(0, Math.min(255, lum));
      gray[i/4] = lum;
    }
    const threshold = cfg.threshold;

    // Pre-compute greyAccent data: saturation map, accent colors, blur/twopass state
    let satBlurred = null;     // option A: blurred saturation map
    let satThreshLo = 0;       // option A: blend zone lower bound
    let satThreshHi = 1;       // option A: blend zone upper bound
    let outSat = null;         // option B: pre-computed FS on saturation layer
    let accentDotColor = null;
    let accentBgColor = null;

    if (cfg.greyAccent) {
      const ga = cfg.greyAccent;

      // Raw HSV saturation per pixel
      const rawSat = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const rv = origData.data[i*4]/255, gv = origData.data[i*4+1]/255, bv = origData.data[i*4+2]/255;
        const mx = Math.max(rv, gv, bv);
        rawSat[i] = mx > 0 ? (mx - Math.min(rv, gv, bv)) / mx : 0;
      }

      // Dominant hue detection (same as combo block) → pick accent colors
      const hb = new Array(360).fill(0);
      for (let i = 0; i < origData.data.length; i += 16) {
        const rv = origData.data[i]/255, gv = origData.data[i+1]/255, bv = origData.data[i+2]/255;
        const mx = Math.max(rv, gv, bv), mn = Math.min(rv, gv, bv);
        const delta = mx - mn;
        if (delta < 0.08) continue;
        const lum = (mx + mn) / 2;
        if (lum < 0.1 || lum > 0.9) continue;
        let hue = 0;
        if (mx === rv) hue = ((gv - bv) / delta) % 6;
        else if (mx === gv) hue = (bv - rv) / delta + 2;
        else hue = (rv - gv) / delta + 4;
        hue = Math.round(hue * 60);
        if (hue < 0) hue += 360;
        hb[hue]++;
      }
      let mc = 0, dh = 0;
      for (let hh = 0; hh < 360; hh++) {
        let sum = 0;
        for (let j = -15; j <= 15; j++) sum += hb[(hh + j + 360) % 360];
        if (sum > mc) { mc = sum; dh = hh; }
      }
      let bestAcc = ga.accents[0], bestDist = Infinity;
      for (const a of ga.accents) {
        let dist = Math.abs(dh - a.hue);
        if (dist > 180) dist = 360 - dist;
        if (dist < bestDist) { bestDist = dist; bestAcc = a; }
      }
      accentDotColor = bestAcc.dot;
      accentBgColor = bestAcc.tintBg;

      if (ga.mode === 'blur') {
        // Separable box blur on saturation map
        const r = ga.blurRadius || 12;
        const tmp = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let sum = 0, cnt = 0;
            for (let dx = -r; dx <= r; dx++) {
              const nx = x + dx;
              if (nx >= 0 && nx < w) { sum += rawSat[y*w+nx]; cnt++; }
            }
            tmp[y*w+x] = sum/cnt;
          }
        }
        satBlurred = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let sum = 0, cnt = 0;
            for (let dy = -r; dy <= r; dy++) {
              const ny = y + dy;
              if (ny >= 0 && ny < h) { sum += tmp[ny*w+x]; cnt++; }
            }
            satBlurred[y*w+x] = sum/cnt;
          }
        }
        // Relative threshold: mean + bias * stddev of blurred saturation
        let mean = 0;
        for (let i = 0; i < w*h; i++) mean += satBlurred[i];
        mean /= w*h;
        let variance = 0;
        for (let i = 0; i < w*h; i++) variance += (satBlurred[i]-mean)**2;
        const stddev = Math.sqrt(variance / (w*h));
        const thresh = mean + (ga.thresholdBias || 0.5) * stddev;
        const bz = ga.blendZone || 0.2;
        satThreshLo = thresh * (1 - bz);
        satThreshHi = thresh * (1 + bz);

      } else if (ga.mode === 'twopass') {
        // Relative threshold from raw saturation distribution
        let mean = 0;
        for (let i = 0; i < w*h; i++) mean += rawSat[i];
        mean /= w*h;
        let variance = 0;
        for (let i = 0; i < w*h; i++) variance += (rawSat[i]-mean)**2;
        const stddev = Math.sqrt(variance / (w*h));
        const satThreshNorm = Math.min(0.98, mean + (ga.thresholdBias || 0.5) * stddev);
        // FS on inverted saturation: high sat → low value → dot (0)
        const satFSThresh = (1 - satThreshNorm) * 255;
        const sd = new Float32Array(w * h);
        for (let i = 0; i < w*h; i++) sd[i] = (1 - rawSat[i]) * 255;
        outSat = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = y*w+x;
            const old = sd[idx];
            const nw = old > satFSThresh ? 255 : 0;
            outSat[idx] = nw;
            const err = old - nw;
            if (x+1 < w) sd[idx+1] += err*7/16;
            if (y+1 < h && x > 0) sd[idx+w-1] += err*3/16;
            if (y+1 < h) sd[idx+w] += err*5/16;
            if (y+1 < h && x+1 < w) sd[idx+w+1] += err*1/16;
          }
        }
      }
    }

    // Pre-compute three-colour palette for threeColor mode
    let tcDark = null, tcMid = null, tcLight = null;
    if (cfg.threeColor) {
      const tc = cfg.threeColor;
      if (tc.mode === 'fixed') {
        tcDark = tc.dark; tcMid = tc.mid; tcLight = tc.light;
      } else {
        // Compute smoothed hue histogram (same logic as combo/greyAccent blocks)
        const hb2 = new Array(360).fill(0);
        for (let i = 0; i < origData.data.length; i += 16) {
          const rv = origData.data[i]/255, gv = origData.data[i+1]/255, bv = origData.data[i+2]/255;
          const mx = Math.max(rv, gv, bv), mn = Math.min(rv, gv, bv);
          const delta = mx - mn;
          if (delta < 0.08) continue;
          const lum = (mx + mn) / 2;
          if (lum < 0.1 || lum > 0.9) continue;
          let hue = 0;
          if (mx === rv) hue = ((gv - bv) / delta) % 6;
          else if (mx === gv) hue = (bv - rv) / delta + 2;
          else hue = (rv - gv) / delta + 4;
          hue = Math.round(hue * 60);
          if (hue < 0) hue += 360;
          hb2[hue]++;
        }
        let mc2 = 0, dh2 = 0;
        for (let hh = 0; hh < 360; hh++) {
          let sum = 0;
          for (let j = -15; j <= 15; j++) sum += hb2[(hh + j + 360) % 360];
          if (sum > mc2) { mc2 = sum; dh2 = hh; }
        }
        // Sort accents by distance to dominant hue (closest first)
        const hueDist = (a) => { let d = Math.abs(dh2 - a.hue); return d > 180 ? 360 - d : d; };
        const sorted = tc.accents.slice().sort((a, b) => hueDist(a) - hueDist(b));
        if (tc.mode === 'monofamily') {
          const best = sorted[0];
          tcDark = best.dark; tcMid = best.mid; tcLight = best.light;
        } else if (tc.mode === 'twofamily') {
          tcDark = sorted[0].dot; tcMid = sorted[1].dot; tcLight = sorted[0].bg;
        }
      }
    }

    function applyColor(out, imageData) {
      const dc = applyCfg.dotColor || null;
      const bc = applyCfg.bgColor || null;
      
      for (let i = 0; i < out.length; i++) {
        const v = out[i] / 255;
        let r, g, b;

        if (applyCfg.threeColor && tcDark) {
          if (out[i] === 0)        { [r, g, b] = tcDark; }
          else if (out[i] === 128) { [r, g, b] = tcMid; }
          else                     { [r, g, b] = tcLight; }
        } else if (applyCfg.greyAccent) {
          const ga = applyCfg.greyAccent;
          const isDot = out[i] === 0;
          if (ga.mode === 'blur' && satBlurred) {
            const sv = satBlurred[i];
            if (sv <= satThreshLo) {
              [r, g, b] = isDot ? ga.greyDot : ga.greyBg;
            } else if (sv >= satThreshHi) {
              [r, g, b] = isDot ? accentDotColor : accentBgColor;
            } else {
              const t = (sv - satThreshLo) / (satThreshHi - satThreshLo);
              const from = isDot ? ga.greyDot : ga.greyBg;
              const to   = isDot ? accentDotColor : accentBgColor;
              r = Math.round(from[0] + t * (to[0] - from[0]));
              g = Math.round(from[1] + t * (to[1] - from[1]));
              b = Math.round(from[2] + t * (to[2] - from[2]));
            }
          } else if (ga.mode === 'twopass' && outSat) {
            const isAccent = outSat[i] === 0;
            if (isDot && isAccent)       { [r, g, b] = accentDotColor; }
            else if (isDot)              { [r, g, b] = ga.greyDot; }
            else if (isAccent)           { [r, g, b] = accentBgColor; }
            else                         { [r, g, b] = ga.greyBg; }
          } else {
            [r, g, b] = isDot ? ga.greyDot : ga.greyBg;
          }
        } else if (dc && bc) {
          // Custom dot + background colors
          r = Math.round(dc[0] + v * (bc[0] - dc[0]));
          g = Math.round(dc[1] + v * (bc[1] - dc[1]));
          b = Math.round(dc[2] + v * (bc[2] - dc[2]));
        } else {
          switch(applyCfg.colorMode) {
            case 'bw':
              r = g = b = out[i]; break;
            case 'mono_yellow':
              r = Math.round(v * 245); g = Math.round(v * 240); b = Math.round(v * 220); break;
            case 'mono_cyan':
              r = Math.round(v * 220); g = Math.round(v * 242); b = Math.round(v * 242); break;
            case 'mono_red':
              r = Math.round(v * 245); g = Math.round(v * 225); b = Math.round(v * 225); break;
            case 'inverted':
              r = g = b = 255 - out[i]; break;
            case 'inverted_tint':
              const iv = (255 - out[i]) / 255;
              r = Math.round(iv * cr); g = Math.round(iv * cg); b = Math.round(iv * cb); break;
            case 'sepia':
              r = Math.round(v * 240); g = Math.round(v * 220); b = Math.round(v * 190); break;
            case 'cool':
              r = Math.round(v * 210); g = Math.round(v * 220); b = Math.round(v * 235); break;
            case 'green':
              r = Math.round(v * 200); g = Math.round(v * 230); b = Math.round(v * 200); break;
            case 'newspaper':
              r = Math.round(v * 230); g = Math.round(v * 228); b = Math.round(v * 225); break;
            case 'tinted': default:
              r = Math.round(v * cr); g = Math.round(v * cg); b = Math.round(v * cb); break;
          }
        }
        imageData.data[i*4] = r;
        imageData.data[i*4+1] = g;
        imageData.data[i*4+2] = b;
        imageData.data[i*4+3] = 255;
      }
    }

    function dither(noiseX, noiseY, noiseRadius) {
      const d = new Float32Array(gray);
      // Add noise
      if (noiseRadius === -1) {
        // Full thumbnail shimmer
        for (let i = 0; i < d.length; i++) {
          d[i] += (Math.random() - 0.5) * 20;
        }
      } else if (noiseRadius > 0) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dist = Math.sqrt((x - noiseX)**2 + (y - noiseY)**2);
            if (dist < noiseRadius) {
              const strength = (1 - dist / noiseRadius) * 40;
              d[y * w + x] += (Math.random() - 0.5) * strength;
            }
          }
        }
      }

      // Floyd-Steinberg
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const old = d[i];
          const t2 = applyCfg.threeColor ? (applyCfg.threeColor.threshold2 || 205) : null;
          const nw = t2 !== null ? (old > t2 ? 255 : old > threshold ? 128 : 0)
                                 : (old > threshold ? 255 : 0);
          out[i] = nw;
          const err = old - nw;
          if (x + 1 < w) d[i+1] += err * 7/16;
          if (y + 1 < h && x > 0) d[i+w-1] += err * 3/16;
          if (y + 1 < h) d[i+w] += err * 5/16;
          if (y + 1 < h && x + 1 < w) d[i+w+1] += err * 1/16;
        }
      }

      // Apply to canvas
      const imageData = ctx.createImageData(w, h);
      applyColor(out, imageData);
      ctx.putImageData(imageData, 0, 0);
    }

    // Initial render
    dither(0, 0, 0);
    canvas.style.imageRendering = 'pixelated';
    canvas.style.opacity = '0';
    canvas.style.transition = 'opacity 0.5s ease';
    thumb.appendChild(canvas);
    requestAnimationFrame(() => requestAnimationFrame(() => { canvas.style.opacity = '1'; }));

    // Shimmer on hover — whole thumbnail
    let shimmerActive = false;
    let shimmerFrame = null;

    function shimmerLoop() {
      if (!shimmerActive) return;
      dither(0, 0, -1);
      setTimeout(() => {
        shimmerFrame = requestAnimationFrame(shimmerLoop);
      }, 120);
    }

    thumb.addEventListener('mouseenter', () => {
      shimmerActive = true;
      shimmerLoop();
    });

    thumb.addEventListener('mouseleave', () => {
      shimmerActive = false;
      if (shimmerFrame) cancelAnimationFrame(shimmerFrame);
      dither(0, 0, 0); // reset to clean
    });
  }

  // Hover handler for baked thumbnails: shows sharp + pixel-noise shimmer
  function setupBakedHover(thumb) {
    const sharp = thumb.querySelector('.baked-sharp');
    if (!sharp) return;
    let canvas = null, ctx = null, origData = null, shimmerRaf = null, shimmerActive = false;

    function initShimmer() {
      if (canvas || !sharp.naturalWidth) return false;
      canvas = document.createElement('canvas');
      canvas.width = sharp.naturalWidth;
      canvas.height = sharp.naturalHeight;
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;opacity:0;transition:opacity 0.55s ease-in-out;image-rendering:pixelated';
      thumb.appendChild(canvas);
      ctx = canvas.getContext('2d');
      try {
        ctx.drawImage(sharp, 0, 0, canvas.width, canvas.height);
        origData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return true;
      } catch(e) { return false; }
    }

    function shimmerTick() {
      if (!shimmerActive || !origData) return;
      const id = new ImageData(new Uint8ClampedArray(origData.data), origData.width, origData.height);
      const d = id.data, n = origData.width * origData.height;
      const swaps = Math.floor(n * 0.015);
      for (let k = 0; k < swaps; k++) {
        const i = Math.floor(Math.random() * n) * 4;
        const j = Math.floor(Math.random() * n) * 4;
        const r = d[i], g = d[i+1], b = d[i+2];
        d[i] = d[j]; d[i+1] = d[j+1]; d[i+2] = d[j+2];
        d[j] = r; d[j+1] = g; d[j+2] = b;
      }
      ctx.putImageData(id, 0, 0);
      setTimeout(() => { if (shimmerActive) shimmerRaf = requestAnimationFrame(shimmerTick); }, 120);
    }

    thumb.addEventListener('mouseenter', () => {
      sharp.style.opacity = '1';
      if (!canvas) initShimmer();
      if (canvas && origData) {
        shimmerActive = true;
        canvas.style.display = 'block';
        shimmerTick();
        requestAnimationFrame(() => requestAnimationFrame(() => { canvas.style.opacity = '1'; }));
      }
    });
    thumb.addEventListener('mouseleave', () => {
      shimmerActive = false;
      if (shimmerRaf) cancelAnimationFrame(shimmerRaf);
      if (canvas) {
        canvas.style.opacity = '0';
        setTimeout(() => { if (!shimmerActive && canvas) canvas.style.display = 'none'; }, 550);
      }
      sharp.style.opacity = '0';
    });
  }

  // After page load, preload all sharp images in background
  function preloadSharpImages() {
    document.querySelectorAll('.baked-sharp[data-sharp]').forEach(img => {
      if (!img.src) img.src = img.dataset.sharp;
    });
  }
  if (document.readyState === 'complete') { preloadSharpImages(); }
  else { window.addEventListener('load', preloadSharpImages); }

  let videoIndex = 0;
  document.querySelectorAll('.card[data-video-id]').forEach(card => {
    const id = card.dataset.videoId;
    const type = card.dataset.videoType;
    const thumb = card.querySelector('.thumb');
    const isBaked = !!(thumb && thumb.dataset.baked === 'true');
    const img = card.querySelector('.baked-blur') || card.querySelector('img');
    img.crossOrigin = 'anonymous';
    const myIndex = videoIndex++;

    if (isBaked) {
      // Baked: fade in blur on load, set up sharp hover
      img.style.opacity = '0';
      img.style.transition = 'opacity 0.5s ease';
      const revealBaked = () => requestAnimationFrame(() => requestAnimationFrame(() => {
        img.style.opacity = '1';
        setupBakedHover(thumb);
      }));
      if (img.complete && img.naturalWidth) {
        revealBaked();
      } else {
        img.addEventListener('load', revealBaked);
      }
    } else {
      img.addEventListener('load', () => {
        try { ditherImage(img, thumb, myIndex); } catch(e) {}
      });
    }

    if (type === 'youtube') {
      let ytId = id;
      try {
        if (id.includes('youtube.com') || id.includes('youtu.be')) {
          const u = new URL(id);
          ytId = u.searchParams.get('v') || u.pathname.slice(1);
        }
      } catch(e) {}
      if (!isBaked) img.src = 'https://img.youtube.com/vi/' + ytId + '/hqdefault.jpg';
      const ytKey = '${process.env.YOUTUBE_API_KEY || ""}';
      if (ytKey) {
        fetch('https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=' + ytId + '&key=' + ytKey)
          .then(r => r.json())
          .then(data => {
            const item = data.items && data.items[0];
            if (!item) return;
            const iso = item.contentDetails.duration;
            const dur = card.querySelector('.card-duration');
            if (dur) {
              const parts = [];
              if (iso) {
                const m = iso.match(/PT(?:([0-9]+)H)?(?:([0-9]+)M)?(?:([0-9]+)S)?/);
                if (m) {
                  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), sec = parseInt(m[3] || 0);
                  const totalSec = h * 3600 + min * 60 + sec;
                  if (totalSec > 0) parts.push((h * 60 + min) + ':' + String(sec).padStart(2, '0'));
                }
              }
              if (item.contentDetails.definition) parts.push(item.contentDetails.definition.toUpperCase());
              if (parts.length) dur.textContent = parts.join(' · ');
            }
          })
          .catch(() => {});
      }
    } else {
      // oEmbed: thumbnail + duration fallback (always works, no auth)
      fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/'+id)
        .then(r => r.json())
        .then(data => {
          if (!isBaked) {
            let u = data.thumbnail_url || '';
            img.src = u.replace(/_[0-9]+x[0-9]+/, '_640') || ('https://vumbnail.com/'+id+'.jpg');
            if (data.title) img.alt = data.title;
          }
          const dur = card.querySelector('.card-duration');
          if (dur && !dur.textContent && data.duration) {
            const m = Math.floor(data.duration / 60);
            const s = data.duration % 60;
            dur.textContent = m + ':' + String(s).padStart(2, '0');
          }
        })
        .catch(() => { if (!isBaked) img.src = 'https://vumbnail.com/'+id+'.jpg'; });
      // Proxy: overwrites with accurate duration + real resolution when available
      fetch('/api/vimeo/' + id)
        .then(r => r.json())
        .then(data => {
          if (!data.duration && !data.width) return;
          const dur = card.querySelector('.card-duration');
          if (dur) {
            const parts = [];
            if (data.duration) {
              const m = Math.floor(data.duration / 60);
              const s = data.duration % 60;
              parts.push(m + ':' + String(s).padStart(2, '0'));
            }
            if (data.width) {
              const w = data.width;
              parts.push(w >= 3840 ? '4K' : w >= 1920 ? '1080p' : w >= 1280 ? '720p' : w >= 854 ? '480p' : 'SD');
            }
            if (parts.length) dur.textContent = parts.join(' · ');
          }
        })
        .catch(() => {});
    }
  });

  // Lightbox

  // Trim tags to single line
  function trimTags() {
    document.querySelectorAll('.card .tags').forEach(container => {
      const tags = Array.from(container.querySelectorAll('span'));
      if (tags.length < 2) return;
      // Reset: show all, remove old +N
      tags.forEach(tag => { if (!tag.dataset.tag && !tag.classList.contains('tag-medium')) return; tag.style.display = ''; });
      container.querySelectorAll('span:not([data-tag]):not(.tag-medium)').forEach(el => el.remove());
      
      // Skip if container is hidden
      if (container.offsetParent === null) return;
      
      const firstTop = tags[0].offsetTop;
      let hiddenCount = 0;
      tags.forEach(tag => {
        if (tag.offsetTop > firstTop) {
          tag.style.display = 'none';
          hiddenCount++;
        }
      });
      
      if (hiddenCount > 0) {
        const more = document.createElement('span');
        more.textContent = '+' + hiddenCount;
        more.style.opacity = '0.4';
        more.style.cursor = 'default';
        more.style.whiteSpace = 'nowrap';
        container.appendChild(more);
        
        while (more.offsetTop > firstTop && container.querySelectorAll('span:not([style*=\"display: none\"])').length > 2) {
          const visible = Array.from(container.querySelectorAll('span:not([style*=\"display: none\"])')); 
          const lastVisible = visible[visible.length - 2];
          if (lastVisible && lastVisible !== more) {
            lastVisible.style.display = 'none';
            hiddenCount++;
            more.textContent = '+' + hiddenCount;
          } else {
            break;
          }
        }
      }
    });
  }
  setTimeout(trimTags, 100);
  const lightbox = document.getElementById('lightbox');
  const lbIframe = document.getElementById('lb-iframe');
  const lbTitle = document.getElementById('lb-title');
  const lbAuthors = document.getElementById('lb-authors');
  const lbYear = document.getElementById('lb-year');
  const lbDesc = document.getElementById('lb-desc');
  const lbDescWrap = document.getElementById('lb-desc-wrap');
  const lbReadMore = document.getElementById('lb-read-more');

  document.querySelector('.grid').addEventListener('click', e => {
    const card = e.target.closest('.card[data-video-id]');
    if (card && e.target.closest('.thumb')) {
      const id = card.dataset.videoId;
      const type = card.dataset.videoType;
      if (type === 'youtube') {
        lbIframe.src = 'https://www.youtube.com/embed/' + id + '?autoplay=1&rel=0';
      } else {
        lbIframe.src = 'https://player.vimeo.com/video/' + id + '?autoplay=1&title=0&byline=0&portrait=0';
      }
      lbTitle.textContent = card.dataset.title || '';
      lbAuthors.textContent = card.dataset.authors || '';
      lbYear.textContent = card.dataset.year || '';
      lbDesc.textContent = card.dataset.desc || '';
      lbDescWrap.classList.remove('open');
      lbReadMore.textContent = 'read synopsis ↓';
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  });

  lbReadMore.addEventListener('click', () => {
    const isOpen = lbDescWrap.classList.toggle('open');
    lbReadMore.textContent = isOpen ? 'close synopsis ↑' : 'read synopsis ↓';
  });

  function closeLightbox() {
    lightbox.classList.remove('open');
    lbIframe.src = '';
    lbDescWrap.classList.remove('open');
    document.body.style.overflow = '';
  }
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox || e.target.closest('.lb-close')) closeLightbox();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  // Filters
  const grid = document.querySelector('.grid');
  const filtersBar = document.querySelector('.filters');
  const introBlock = document.getElementById('intro-block');
  const logosCard = null;
  let activeFilter = 'all';
  let activeType = 'tag';
  let userArchiveOpen = false;

  // Dynamically limit visible tags to what fits on the first line
  const filtersRow = document.getElementById('filters-row');
  const themeTags = filtersRow.querySelector('.theme-tags');
  const filtersExtra = document.getElementById('filters-extra');
  const tagBtns = Array.from(themeTags.querySelectorAll('button[data-filter]'));
  const expandBtn = document.getElementById('tag-expand');
  
  // Wait for layout, then check which tags overflow to second line
  setTimeout(() => {
    if (tagBtns.length < 2) return;
    const firstTop = tagBtns[0].offsetTop;
    let hasOverflow = false;
    tagBtns.forEach(btn => {
      if (btn.dataset.filter === 'all') return;
      if (btn.offsetTop > firstTop) {
        filtersExtra.insertBefore(btn, tagClose);
        hasOverflow = true;
      }
    });
    const hasMediumTags = document.querySelectorAll('.medium-tags button[data-filter]').length > 0;
    if (!hasOverflow && !hasMediumTags) {
      expandBtn.style.display = 'none';
    }
    // Check if expand button itself overflowed — move one tag to make room
    if (expandBtn.offsetTop > firstTop) {
      const visibleTags = Array.from(filtersRow.querySelectorAll('button[data-filter]')).filter(b => b.dataset.filter !== 'all');
      if (visibleTags.length > 0) {
        const last = visibleTags[visibleTags.length - 1];
        filtersExtra.insertBefore(last, filtersExtra.firstChild);
      }
    }
  }, 50);

  // Tag expand toggle
  document.getElementById('tag-expand').addEventListener('click', () => {
    if (activeType === 'search') {
      clearSearchInputs();
      applyFilter('all', 'tag');
    }
    filtersBar.classList.add('show-all');
  });

  // Support both inline intro search and filter-bar search
  const searchInput = document.getElementById('search-input');
  const filterBarSearch = document.querySelector('.filters-search-input');

  function clearSearchInputs() {
    if (searchInput) searchInput.value = '';
    if (filterBarSearch) filterBarSearch.value = '';
  }

  function runSearch(q) {
    if (!q) { applyFilter('all', 'tag'); return; }
    activeFilter = 'search';
    activeType = 'search';
    filtersBar.querySelectorAll('button[data-filter]').forEach(btn => btn.classList.remove('active'));
    grid.classList.add('show-archive');
    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.videoId) return;
      const title = (card.dataset.title || '').toLowerCase();
      const authors = (card.dataset.authors || '').toLowerCase();
      const tags = (card.dataset.tags || '').toLowerCase();
      const match = title.includes(q) || authors.includes(q) || tags.includes(q);
      card.classList.toggle('hidden', !match);
    });
  }

  if (searchInput) searchInput.addEventListener('input', () => runSearch(searchInput.value.toLowerCase().trim()));
  if (filterBarSearch) filterBarSearch.addEventListener('input', () => runSearch(filterBarSearch.value.toLowerCase().trim()));

  function applyFilter(value, type) {
    activeFilter = value;
    activeType = type || 'tag';
    document.body.classList.toggle('has-filter', value !== 'all');
    if (value === 'all') filtersBar.classList.remove('show-all');
    if (type !== 'search') clearSearchInputs();
    filtersBar.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });
    filtersExtra.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });
    document.querySelectorAll('.card-year').forEach(y => {
      y.style.color = (activeType === 'year' && y.dataset.year === value) ? '#1e40af' : '';
    });
    document.querySelectorAll('a.year-filter').forEach(a => {
      a.classList.toggle('active', type === 'year' && a.dataset.year === value);
    });
    document.querySelectorAll('.card .tags span[data-tag]').forEach(s => s.classList.remove('active'));
    if (value !== 'all' && type === 'tag') {
      document.querySelectorAll('.card .tags span[data-tag="' + value + '"]').forEach(s => s.classList.add('active'));
    }

    // Show/hide intro and logos
    const isFiltered = value !== 'all';
    if (introBlock) introBlock.style.display = isFiltered ? 'none' : '';
    if (logosCard) logosCard.classList.toggle('hidden', isFiltered);
    const archiveToggleEl = document.getElementById('archive-toggle');
    if (archiveToggleEl) archiveToggleEl.style.display = isFiltered ? 'none' : '';

    if (value === 'all') {
      grid.classList.toggle('show-archive', userArchiveOpen);
    } else {
      grid.classList.add('show-archive');
    }
    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.videoId) return;
      const isArchive = card.dataset.featured === 'false';
      if (value === 'all') {
        card.classList.toggle('hidden', isArchive && !userArchiveOpen);
      } else if (type === 'year') {
        card.classList.toggle('hidden', card.dataset.year !== value);
      } else {
        const tags = card.dataset.tags;
        card.classList.toggle('hidden', !tags.split(',').includes(value));
      }
    });
    const medAxis = document.getElementById('medium-axis');
    if (medAxis) {
      medAxis.querySelectorAll('button[data-filter]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === value);
      });
    }
  }

  filtersBar.addEventListener('click', e => {
    if (e.target.tagName === 'BUTTON' && e.target.dataset.filter) applyFilter(e.target.dataset.filter, 'tag');
  });

  document.querySelector('.grid').addEventListener('click', e => {
    if (e.target.matches('.tags span[data-tag]')) {
      applyFilter(e.target.dataset.tag, 'tag');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    if (e.target.matches('.card-year[data-year]')) {
      const year = e.target.dataset.year;
      if (activeType === 'year' && activeFilter === year) applyFilter('all', 'tag');
      else applyFilter(year, 'year');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Year filter links in intro text
  document.querySelectorAll('.year-filter').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      applyFilter(link.dataset.year, 'year');
      // Keep intro visible when filtering from text
      if (introBlock) introBlock.style.display = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Archive toggle
  const archiveToggle = document.getElementById('archive-toggle');
  archiveToggle.addEventListener('click', () => {
    const isOpen = grid.classList.toggle('show-archive');
    userArchiveOpen = isOpen;
    archiveToggle.classList.toggle('is-open', isOpen);
    document.querySelectorAll('.card[data-featured="false"]').forEach(card => {
      card.classList.toggle('hidden', !isOpen);
    });
    const btn = document.getElementById('archive-btn');
    if (isOpen) {
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      setTimeout(trimTags, 50);
    } else {
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }
  });
  ${cfg.extraJS || ''}
</script>

<style>
  .scroll-ind {
    position: fixed;
    width: 16px;
    pointer-events: none;
    z-index: 50;
  }
  .scroll-ind-line {
    position: absolute;
    left: 50%;
    top: 0; bottom: 0;
    width: 1px;
    background: repeating-linear-gradient(
      to bottom,
      #000 0px,
      #000 5px,
      transparent 5px,
      transparent 11px
    );
    transform: translateX(-50%);
  }
  .scroll-ind-vp {
    position: absolute;
    left: 50%;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #000;
    transform: translate(-50%, -50%);
    transition: top 0.1s ease-out;
  }
  @media (max-width: 768px) { .scroll-ind { display: none !important; } }
</style>

<div class="scroll-ind" id="scroll-ind">
  <div class="scroll-ind-line"></div>
  <div class="scroll-ind-vp" id="scroll-ind-vp"></div>
</div>

<script>
(function() {
  var ind = document.getElementById('scroll-ind');
  var vpEl = document.getElementById('scroll-ind-vp');
  if (!ind || !vpEl) return;

  var rafPending = false;

  function visibleCards() {
    return Array.from(document.querySelectorAll('.card[data-video-id]')).filter(function(c) {
      return !c.classList.contains('hidden') && c.style.display !== 'none' && getComputedStyle(c).display !== 'none';
    });
  }

  function recalc() {
    var docH = Math.max(document.body.scrollHeight, 1);
    var vpH = window.innerHeight;
    if (docH <= vpH) { ind.style.visibility = 'hidden'; return; }

    var cards = visibleCards();
    if (!cards.length) { ind.style.visibility = 'hidden'; return; }
    ind.style.visibility = '';

    // Align top of indicator with top of first card, plus 1/3 extra margin each side
    var firstRect = cards[0].getBoundingClientRect();
    var baseMargin = Math.round(firstRect.top + window.scrollY);
    var indTop = baseMargin * 2;
    ind.style.top = indTop + 'px';
    ind.style.height = Math.max(vpH - indTop * 2, 40) + 'px';

    // Center horizontally between grid right edge and viewport right edge
    var grid = document.querySelector('.grid');
    if (grid) {
      var gridRight = grid.getBoundingClientRect().right;
      var midRight = Math.round((window.innerWidth - gridRight) / 2 - 8);
      ind.style.right = Math.max(midRight, 8) + 'px';
    }

    var indH = ind.offsetHeight;

    updateVp(docH, indH);
  }

  function updateVp(docH, indH) {
    docH = docH || Math.max(document.body.scrollHeight, 1);
    indH = indH || ind.offsetHeight;
    var centerY = window.scrollY + window.innerHeight / 2;
    var frac = Math.min(Math.max(centerY / docH, 0), 1);
    vpEl.style.top = Math.round(frac * indH) + 'px';
  }

  function onScroll() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function() { rafPending = false; updateVp(); });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', recalc);

  // Watch card class/style changes (filter + archive toggle)
  var mo = new MutationObserver(recalc);
  document.querySelectorAll('.card[data-video-id]').forEach(function(c) {
    mo.observe(c, { attributes: true, attributeFilter: ['class', 'style'] });
  });

  // Initial build — after cards animate in
  if (document.readyState === 'complete') { setTimeout(recalc, 100); }
  else { window.addEventListener('load', function() { setTimeout(recalc, 100); }); }
})();
</script>
</body>
</html>`);
}

// Default: current style
// Old default (tinted whites)
app.get('/old', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'old — tinted whites', font: "'IBM Plex Sans'", introSize: '19px' });
});

app.get('/paper', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'paper — newspaper tint', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', paperTint: true });
});

// Default: c7 style
app.get('/', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: '', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'm1', extraJS: `
    (function() {
      function prependYear(dur) {
        const card = dur.closest('.card');
        const year = card && card.dataset.year;
        if (!year || !dur.textContent.trim() || dur.textContent.startsWith(year)) return;
        dur.textContent = year + ' · ' + dur.textContent;
      }
      document.querySelectorAll('.card-duration').forEach(dur => {
        prependYear(dur);
        new MutationObserver(() => prependYear(dur)).observe(dur, { childList: true, characterData: true, subtree: true });
      });
    })();
  `, extraCSS: `
    .filters-search-wrap { display: none !important; }
    .card .card-year { display: none !important; }
    .filters button {
      border: none;
      border-radius: 0;
      background: transparent;
      color: #888;
      padding: 6px 4px;
      position: relative;
    }
    .filters button::before { content: "["; opacity: 0.4; margin-right: 1px; }
    .filters button::after { content: "]"; opacity: 0.4; margin-left: 1px; }
    .filters button:hover { color: #1e40af; background: transparent; border: none; }
    .filters button:hover::before, .filters button:hover::after { opacity: 0.7; }
    .filters button.active {
      color: #1e40af; background: transparent; border: none;
      text-decoration: underline; text-underline-offset: 3px;
    }
    .filters button.active::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 0;
      transform: translate(-50%, -7px);
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #1e40af;
      margin: 0;
      opacity: 1;
    }
    .filters button.active::after { content: ""; margin: 0; opacity: 0; }
    .filters-medium button { border: none; background: transparent; }
    .filters-medium button::before { content: "["; opacity: 0.4; margin-right: 1px; }
    .filters-medium button::after { content: "]"; opacity: 0.4; margin-left: 1px; }
    .tag-expand { border: none; background: transparent; border-radius: 0; color: #888; }
    .tag-expand:hover { border: none; background: transparent; color: #1e40af; }
    .filters-extra .tag-close { border: none; background: transparent; border-radius: 0; color: #888; }
    .filters-extra .tag-close:hover { border: none; background: transparent; color: #1e40af; }
  ` });
});

// v1 — plain text tags (no border box, underline active state)
app.get('/v1', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v1 — plain tags', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button {
      border: none;
      border-radius: 0;
      padding: 6px 8px;
      background: transparent;
      color: #aaa;
      letter-spacing: 0.04em;
    }
    .filters button:hover { color: #1e40af; background: transparent; }
    .filters button.active { color: #1e40af; background: transparent; border-bottom: 1px solid #1e40af; }
    .filters-medium button { border-style: solid; border: none; }
    .tag-expand { border: none; border-radius: 0; background: transparent; }
    .tag-expand:hover { background: transparent; border: none; color: #1e40af; }
    .filters-extra .tag-close { border: none; border-radius: 0; background: transparent; }
    .filters-extra .tag-close:hover { border: none; color: #1e40af; background: transparent; }
  ` });
});

// v2 — filled square chips (no border, light background)
app.get('/v2', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v2 — filled chips', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button {
      border: none;
      border-radius: 3px;
      padding: 6px 14px;
      background: #efefef;
      color: #555;
    }
    .filters button:hover { background: #e2e2e2; color: #111; border: none; }
    .filters button.active { background: #111; border-color: #111; color: #fff; }
    .filters-medium button { border-style: solid; border: none; background: #efefef; }
    .filters-medium button:hover { background: #e2e2e2; border: none; }
    .tag-expand { border: none; border-radius: 3px; background: #efefef; }
    .tag-expand:hover { border: none; background: #e2e2e2; color: #111; }
    .filters-extra .tag-close { border: none; border-radius: 3px; background: #efefef; }
    .filters-extra .tag-close:hover { border: none; background: #e2e2e2; color: #111; }
  ` });
});

// v3 — square border (sharp corners, solid border)
app.get('/v3', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v3 — square border', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button { border-radius: 0; }
    .tag-expand { border-radius: 0; }
    .filters-extra .tag-close { border-radius: 0; }
  ` });
});

// v4 — uppercase small pill
app.get('/v4', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v4 — uppercase pill', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button {
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.12em;
      padding: 5px 14px;
    }
  ` });
});

// v5 — underline tab (bottom border only, no box)
app.get('/v5', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v5 — underline tabs', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button {
      border: none;
      border-bottom: 1px solid #ddd;
      border-radius: 0;
      padding: 6px 8px;
      background: transparent;
      color: #999;
    }
    .filters button:hover { color: #111; border-bottom-color: #999; background: transparent; border-top: none; border-left: none; border-right: none; }
    .filters button.active { color: #111; border-bottom: 2px solid #111; background: transparent; border-top: none; border-left: none; border-right: none; }
    .filters-medium button { border: none; border-bottom: 1px dashed #ddd; background: transparent; }
    .filters-medium button:hover { border: none; border-bottom: 1px dashed #999; }
    .tag-expand { border: none; border-bottom: 1px solid #ddd; border-radius: 0; background: transparent; }
    .tag-expand:hover { border: none; border-bottom: 1px solid #999; background: transparent; color: #111; }
    .filters-extra .tag-close { border: none; border-bottom: 1px solid #ddd; border-radius: 0; background: transparent; }
    .filters-extra .tag-close:hover { border: none; border-bottom: 1px solid #999; background: transparent; color: #111; }
  ` });
});

// v6 — dotted border pill
app.get('/v6', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v6 — dotted pill', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button { border-style: dotted; }
    .filters button:hover { border-style: dotted; }
    .filters button.active { border-style: dotted; }
    .filters-medium button { border-style: dotted; }
    .tag-expand { border-style: dotted; }
    .filters-extra .tag-close { border-style: dotted; }
  ` });
});

// v7 — bold 2px black border, square
app.get('/v7', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v7 — bold square', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button {
      border: 2px solid #111;
      border-radius: 0;
      color: #111;
      background: transparent;
    }
    .filters button:hover { background: #111; color: #fff; border-color: #111; }
    .filters button.active { background: #111; color: #fff; border-color: #111; }
    .filters-medium button { border-style: solid; border-width: 2px; border-color: #111; border-radius: 0; }
    .filters-medium button:hover { background: #111; color: #fff; }
    .tag-expand { border: 2px solid #111; border-radius: 0; color: #111; }
    .tag-expand:hover { background: #111; color: #fff; border-color: #111; }
    .filters-extra .tag-close { border: 2px solid #111; border-radius: 0; color: #111; }
    .filters-extra .tag-close:hover { background: #111; color: #fff; border-color: #111; }
  ` });
});

// v8 — bracket style [tag]
app.get('/v8', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v8 — brackets', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'b7', extraCSS: `
    .filters button {
      border: none;
      border-radius: 0;
      background: transparent;
      color: #888;
      padding: 6px 4px;
    }
    .filters button::before { content: "["; opacity: 0.4; margin-right: 1px; }
    .filters button::after { content: "]"; opacity: 0.4; margin-left: 1px; }
    .filters button:hover { color: #111; background: transparent; border: none; }
    .filters button:hover::before, .filters button:hover::after { opacity: 0.7; }
    .filters button.active { color: #111; background: transparent; border: none; }
    .filters button.active::before, .filters button.active::after { opacity: 1; }
    .filters-medium button { border: none; background: transparent; }
    .filters-medium button::before { content: "["; opacity: 0.4; margin-right: 1px; }
    .filters-medium button::after { content: "]"; opacity: 0.4; margin-left: 1px; }
    .tag-expand { border: none; background: transparent; border-radius: 0; color: #888; }
    .tag-expand:hover { border: none; background: transparent; color: #1e40af; }
    .filters-extra .tag-close { border: none; background: transparent; border-radius: 0; color: #888; }
    .filters-extra .tag-close:hover { border: none; background: transparent; color: #1e40af; }
  ` });
});

app.get('/v9', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'v9 — blue only', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'blue_only', extraCSS: `
    .filters button {
      border: none;
      border-radius: 0;
      background: transparent;
      color: #888;
      padding: 6px 4px;
    }
    .filters button::before { content: "["; opacity: 0.4; margin-right: 1px; }
    .filters button::after { content: "]"; opacity: 0.4; margin-left: 1px; }
    .filters button:hover { color: #111; background: transparent; border: none; }
    .filters button:hover::before, .filters button:hover::after { opacity: 0.7; }
    .filters button.active { color: #111; background: transparent; border: none; }
    .filters button.active::before, .filters button.active::after { opacity: 1; }
    .filters button[data-filter="all"] { text-decoration: underline; }
    .filters-medium button { border: none; background: transparent; }
    .filters-medium button::before { content: "["; opacity: 0.4; margin-right: 1px; }
    .filters-medium button::after { content: "]"; opacity: 0.4; margin-left: 1px; }
    .tag-expand { border: none; background: transparent; border-radius: 0; color: #888; }
    .tag-expand:hover { border: none; background: transparent; color: #111; }
  ` });
});

// g-series: grey base + hue-matched accent on saturated pixels
app.get('/g',  async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g1', label: 'g — blur r8 · bias 0.5' }); });
app.get('/g1', async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g1', label: 'g1 — blur r8  · bias 0.5 (more colour)' }); });
app.get('/g2', async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g2', label: 'g2 — blur r15 · bias 0.5 (medium)' }); });
app.get('/g3', async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g3', label: 'g3 — blur r20 · bias 1.0 (less colour)' }); });
app.get('/g4', async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g4', label: 'g4 — twopass · bias 0.5 (more colour)' }); });
app.get('/g5',  async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g5',  label: 'g5 — twopass · bias 1.0 (less colour)' }); });
app.get('/g1a', async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g1a', label: 'g1a — 3-colour fixed: navy · clay · cream' }); });
app.get('/g1b', async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g1b', label: 'g1b — 3-colour mono-family: dark · mid · light tint' }); });
app.get('/g1c', async (req, res) => { await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagColor: '#777', font: "'IBM Plex Sans'", introSize: '19px', ditherMode: 'g1c', label: 'g1c — 3-colour two-family: top-2 hue accents + bg' }); });




app.get('/test', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: '', font: "'IBM Plex Sans'", introSize: '18px', ditherMode: 'b7lo', extraJS: `
    (function() {
      function prependYear(dur) {
        const card = dur.closest('.card');
        const year = card && card.dataset.year;
        if (!year || !dur.textContent.trim() || dur.textContent.startsWith(year)) return;
        dur.textContent = year + ' · ' + dur.textContent;
      }
      document.querySelectorAll('.card-duration').forEach(dur => {
        prependYear(dur);
        new MutationObserver(() => prependYear(dur)).observe(dur, { childList: true, characterData: true, subtree: true });
      });
    })();
  `, extraCSS: `
    /* Two-column page: sidebar + grid */
    .page {
      display: grid;
      grid-template-columns: 190px 1fr;
      grid-template-rows: auto auto;
      gap: 0 44px;
      align-items: start;
    }
    .filters {
      grid-column: 1;
      grid-row: 1 / 3;
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
      margin-bottom: 0;
      position: sticky;
      top: 24px;
    }
    /* Title on .filters level so search can sit between title and tags */
    .filters::before {
      display: block;
      order: -2;
      content: 'inlimbo';
      font-family: inherit;
      font-size: 24px;
      font-weight: 300;
      letter-spacing: -0.01em;
      color: #111;
      margin-bottom: 0;
    }
    .filters::after {
      display: block;
      order: -1;
      content: '.database';
      font-family: inherit;
      font-size: 24px;
      font-weight: 300;
      letter-spacing: -0.01em;
      color: #111;
      margin-bottom: 20px;
    }
    /* Hide title from filters-left (now on .filters) */
    .filters-left::before { display: none !important; }
    .filters-left::after  { display: none !important; }
    /* Search sits between title (order -1) and tags (order 1) */
    .filters-search-wrap {
      order: 0;
      width: 100%;
      padding-top: 0;
      margin-bottom: 20px;
    }
    .filters-search-wrap::before {
      content: "⌕";
      font-size: 15px;
      color: #bbb;
      margin-right: 5px;
      line-height: 1;
    }
    .filters-left {
      order: 1;
      display: flex;
      flex-direction: column;
      gap: 0;
      width: 100%;
      overflow-y: auto;
      max-height: calc(100vh - 220px);
    }
    /* Theme tags vertical */
    #filters-row { grid-template-columns: 1fr; }
    .theme-tags { flex-direction: column !important; align-items: flex-start !important; gap: 1px !important; }
    /* Overflow tags shown vertically (JS will move them here) */
    .filters-extra {
      display: flex !important;
      flex-direction: column !important;
      flex-wrap: nowrap !important;
      gap: 1px !important;
      padding: 0 !important;
      align-items: flex-start !important;
    }
    .filters-extra .tag-close { display: none !important; }
    /* Medium section always visible */
    .filters-medium { display: block !important; margin-top: 16px; }
    .filters-medium .filters-label { padding-top: 0; margin-bottom: 2px; }
    .medium-tags { display: flex !important; flex-direction: column !important; gap: 1px !important; align-items: flex-start !important; }
    /* Hide expand button (all tags visible) */
    .tag-expand { display: none !important; }
    /* Hide the search paragraph — only needed on main */
    .intro-block .intro-text p:last-child { display: none; }
    /* Grid and archive in column 2 */
    .grid { grid-column: 2; grid-row: 1; }
    .archive-toggle { grid-column: 2; grid-row: 2; }
    /* Base button style — no brackets */
    .filters button { border: none; border-radius: 0; background: transparent; color: #888; padding: 2px 0; font-size: 14px; text-align: left; }
    .filters button::before { content: ""; }
    .filters button::after { content: ""; }
    .filters button:hover { color: #111; background: transparent; border: none; }
    .filters button.active { color: #111; background: transparent; border: none; }
    .filters button[data-filter="all"] { text-decoration: underline; }
    /* Branch symbols — theme tags in sidebar (both in-place and moved to filters-extra) */
    .theme-tags button[data-filter]:not([data-filter="all"])::before { content: "└ "; opacity: 0.4; }
    .filters-extra button::before { content: "└ "; opacity: 0.4; }
    /* Branch symbols — medium tags */
    .medium-tags button::before { content: "└ "; opacity: 0.4; }
    .filters-medium button { border: none; background: transparent; }
    .filters-medium button::after { content: ""; }
    /* Year is prepended into duration strip via JS — hide the separate element */
    .card .card-year { display: none !important; }
    /* 1px smaller for all card text except title */
    .card-duration { font-size: 10px !important; }
    .card .tags span { font-size: 10px !important; }
    /* Mobile fallback */
    @media (max-width: 768px) {
      .page { grid-template-columns: 1fr; }
      .filters { position: static; grid-column: 1; grid-row: auto; }
      .theme-tags { flex-direction: row !important; flex-wrap: wrap !important; }
      .filters-extra { flex-direction: row !important; flex-wrap: wrap !important; }
      .medium-tags { flex-direction: row !important; flex-wrap: wrap !important; }
      .grid { grid-column: 1; grid-row: auto; }
      .archive-toggle { grid-column: 1; }
    }
  ` });
});

// --- Student submit page ---
app.get('/submit', requireStudent, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo — submit</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: inherit;
    background: #fff;
    color: #111;
    padding: 40px;
    -webkit-font-smoothing: antialiased;
  }
  h1 { font-weight: 300; font-size: 32px; margin-bottom: 8px; }
  .subtitle { color: #888; font-size: 14px; margin-bottom: 40px; }
  .subtitle a { color: #111; }
  .form-section {
    background: #fff;
    border: 1px solid #e0e0e0;
    padding: 32px;
    max-width: 600px;
  }
  .form-section h2 {
    font-weight: 600;
    font-size: 16px;
    margin-bottom: 24px;
  }
  label {
    display: block;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: #888;
    margin-bottom: 6px;
    margin-top: 16px;
  }
  label:first-of-type { margin-top: 0; }
  input[type="text"], input[type="number"], textarea {
    width: 100%;
    font-family: inherit;
    font-size: 14px;
    padding: 10px 12px;
    border: 1px solid #ddd;
    background: #fff;
    color: #111;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus, textarea:focus { border-color: #111; }
  textarea { resize: vertical; min-height: 120px; }
  .row { display: flex; gap: 16px; }
  .row > div { flex: 1; }
  button[type="submit"] {
    font-family: inherit;
    font-size: 13px;
    letter-spacing: 0.03em;
    padding: 12px 28px;
    border: 1px solid #111;
    background: #111;
    color: #fff;
    cursor: pointer;
    margin-top: 24px;
    transition: all 0.2s;
  }
  button[type="submit"]:hover { background: #333; }
  .success {
    padding: 16px 20px;
    background: #f0faf0;
    border: 1px solid #c0e0c0;
    color: #2a6e2a;
    font-size: 14px;
    margin-bottom: 24px;
    max-width: 600px;
    display: none;
  }
  .success.show { display: block; }
  .note {
    font-size: 12px;
    color: #999;
    margin-top: 12px;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <h1>in limbo</h1>
  <div class="subtitle">submit your work &middot; <a href="/">← back to archive</a></div>

  <div class="success" id="success-msg">
    Your video has been submitted and is awaiting review. You'll see it on the archive once it's been approved.
  </div>

  <div class="form-section">
    <h2>submit a video</h2>
    <form id="submit-form">
      <label>title</label>
      <input type="text" name="title" required>

      <div class="row">
        <div>
          <label>student(s)</label>
          <input type="text" name="students" placeholder="Name & Name" required>
        </div>
        <div>
          <label>year</label>
          <input type="number" name="year" min="2020" max="2030" value="2026" required>
        </div>
      </div>

      <label>video link (Vimeo or YouTube)</label>
      <input type="text" name="video_link" placeholder="https://vimeo.com/123456789 or https://youtu.be/..." required>

      <label>description (max. 150 words)</label>
      <textarea name="description" maxlength="1500" required></textarea>

      <label>themes / positions (comma-separated)</label>
      <input type="text" name="tags_theme" placeholder="decay, ecology, labor">

      <label>medium / strategy (comma-separated)</label>
      <input type="text" name="tags_medium" placeholder="interview, photogrammetry, documentary">

      <button type="submit">submit for review</button>
      <div class="note">Your submission will be reviewed before appearing on the archive.</div>
    </form>
  </div>

<script>
  const authHeader = 'Basic ' + btoa('${STUDENT_USER}:${STUDENT_PASS}');
  document.getElementById('submit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      students: fd.get('students'),
      year: fd.get('year'),
      video_link: fd.get('video_link'),
      description: fd.get('description'),
      tags_theme: fd.get('tags_theme'),
      tags_medium: fd.get('tags_medium')
    };
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      document.getElementById('success-msg').classList.add('show');
      e.target.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
</script>
</body>
</html>`);
});

// --- Admin panel ---
app.get('/user', requireAuth, async (req, res) => {
  const videos = await getVideoRows();

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo — admin</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: inherit;
    background: #fafafa;
    color: #111;
    padding: 40px;
    -webkit-font-smoothing: antialiased;
  }
  h1 { font-weight: 300; font-size: 32px; margin-bottom: 8px; }
  .subtitle { color: #888; font-size: 14px; margin-bottom: 40px; }
  .subtitle a { color: #111; }
  .form-section {
    background: #fff;
    border: 1px solid #e0e0e0;
    padding: 32px;
    margin-bottom: 32px;
    max-width: 700px;
  }
  .form-section h2 {
    font-weight: 600;
    font-size: 16px;
    margin-bottom: 24px;
  }
  label {
    display: block;
    font-size: 12px;
    letter-spacing: 0.04em;
    color: #888;
    margin-bottom: 6px;
    margin-top: 16px;
  }
  label:first-of-type { margin-top: 0; }
  input[type="text"], input[type="number"], textarea {
    width: 100%;
    font-family: inherit;
    font-size: 14px;
    padding: 10px 12px;
    border: 1px solid #ddd;
    background: #fff;
    color: #111;
    outline: none;
    transition: border-color 0.2s;
  }
  input:focus, textarea:focus { border-color: #111; }
  textarea { resize: vertical; min-height: 100px; }
  .row { display: flex; gap: 16px; }
  .row > div { flex: 1; }
  .check-row {
    display: flex;
    gap: 24px;
    margin-top: 16px;
  }
  .check-row label {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 13px;
    color: #111;
    cursor: pointer;
  }
  .check-row input[type="checkbox"] { width: 16px; height: 16px; }
  button[type="submit"], .btn {
    font-family: inherit;
    font-size: 13px;
    letter-spacing: 0.03em;
    padding: 12px 28px;
    border: 1px solid #111;
    background: #111;
    color: #fff;
    cursor: pointer;
    margin-top: 24px;
    transition: all 0.2s;
  }
  button[type="submit"]:hover, .btn:hover { background: #333; }
  .btn-danger {
    background: #fff;
    color: #c00;
    border-color: #c00;
    padding: 6px 14px;
    font-size: 12px;
    margin-top: 0;
  }
  .btn-danger:hover { background: #c00; color: #fff; }
  .btn-edit {
    background: #fff;
    color: #111;
    border-color: #ccc;
    padding: 6px 14px;
    font-size: 12px;
    margin-top: 0;
  }
  .btn-edit:hover { background: #111; color: #fff; }
  .video-list { max-width: 900px; }
  .video-item {
    background: #fff;
    border: 1px solid #e0e0e0;
    padding: 20px 24px;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
  }
  .video-item .info { flex: 1; }
  .video-item .info h3 {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .video-item .info .meta {
    font-size: 12px;
    color: #888;
  }
  .video-item .info .meta span { margin-right: 12px; }
  .video-item .badges { display: flex; gap: 6px; margin-top: 6px; }
  .badge {
    font-size: 10px;
    letter-spacing: 0.04em;
    padding: 3px 8px;
    border-radius: 100px;
    background: #f0f0f0;
    color: #666;
  }
  .badge.featured { background: #111; color: #fff; }
  .badge.archived { background: #c00; color: #fff; }
  .video-item .actions { display: flex; gap: 8px; flex-shrink: 0; }
  .msg {
    padding: 12px 16px;
    margin-bottom: 24px;
    background: #e8f5e9;
    border: 1px solid #a5d6a7;
    color: #2e7d32;
    font-size: 13px;
    max-width: 700px;
  }
  @media (max-width: 600px) {
    body { padding: 20px; }
    .row { flex-direction: column; gap: 0; }
    .video-item { flex-direction: column; align-items: flex-start; }
  }
</style>
</head>
<body>
  <h1>in limbo</h1>
  <div class="subtitle"><a href="/">← terug naar de site</a></div>

  <div class="form-section">
    <h2>video toevoegen</h2>
    <form id="add-form">
      <label>titel</label>
      <input type="text" name="title" required>

      <div class="row">
        <div>
          <label>studenten</label>
          <input type="text" name="students" placeholder="Naam &amp; Naam" required>
        </div>
        <div>
          <label>jaar</label>
          <input type="number" name="year" min="2020" max="2030" required>
        </div>
      </div>

      <label>video link (Vimeo of YouTube)</label>
      <input type="text" name="video_link" placeholder="https://vimeo.com/123456789 of https://youtu.be/..." required>

      <label>beschrijving (150 woorden)</label>
      <textarea name="description" maxlength="1500" required></textarea>

      <label>themes / positions (kommagescheiden)</label>
      <input type="text" name="tags_theme" placeholder="decay, ecology, labor">

      <label>medium / strategy (kommagescheiden)</label>
      <input type="text" name="tags_medium" placeholder="interview, photogrammetry, documentary">

      <div class="row">
        <div>
          <label>sorteervolgorde (lager = eerder)</label>
          <input type="number" name="sort_order" value="0">
        </div>
      </div>

      <div class="check-row">
        <label><input type="checkbox" name="featured" checked> highlight</label>
        <label><input type="checkbox" name="archived"> archief</label>
      </div>

      <button type="submit">toevoegen</button>
    </form>
  </div>

  <div class="video-list">
    <h2 style="font-size:16px;font-weight:600;margin-bottom:16px;color:#b8860b;">⏳ in afwachting (${videos.filter(v => v.status === 'pending').length})</h2>
    ${videos.filter(v => v.status === 'pending').map(v => `
    <div class="video-item" style="border-left:3px solid #b8860b;" data-id="${v.id}">
      <div class="info">
        <h3>${esc(v.title)}</h3>
        <div class="meta">
          <span>${esc(v.students)}</span>
          <span>${v.year}</span>
          <span>${v.video_type || 'vimeo'}/${v.video_id || v.vimeo_id}</span>
        </div>
        <div style="font-size:12px;color:#666;margin-top:8px;line-height:1.5;max-width:500px;">${esc(v.description).substring(0, 200)}...</div>
        <div class="badges" style="margin-top:6px;">
          ${(v.tags_theme||v.tags||'').split(',').filter(Boolean).map(t => '<span class="badge">'+t.trim()+'</span>').join('')}
          ${(v.tags_medium||'').split(',').filter(Boolean).map(t => '<span class="badge" style="border-style:dashed">'+t.trim()+'</span>').join('')}
        </div>
      </div>
      <div class="actions" style="flex-direction:column;gap:6px;">
        <div style="display:flex;gap:6px;">
          <button class="btn btn-edit" style="background:#2a6e2a;color:#fff;border-color:#2a6e2a;" onclick="approveVideo(${v.id}, true, false)">highlight</button>
          <button class="btn btn-edit" style="background:#555;color:#fff;border-color:#555;" onclick="approveVideo(${v.id}, false, true)">archief</button>
        </div>
        <button class="btn btn-danger" onclick="rejectVideo(${v.id})">reject</button>
      </div>
    </div>`).join('') || '<p style="color:#999;font-size:13px;margin-bottom:24px;">geen submissions in afwachting</p>'}
  </div>

  <div class="video-list" style="margin-top:32px;">
    <h2 style="font-size:16px;font-weight:600;margin-bottom:16px;">alle video's (${videos.filter(v => v.status !== 'pending' && v.status !== 'rejected').length})</h2>
    ${videos.filter(v => v.status !== 'pending' && v.status !== 'rejected').map(v => `
    <div class="video-item" data-id="${v.id}" data-title="${esc(v.title)}" data-students="${esc(v.students)}" data-year="${v.year}" data-video-id="${v.video_id || v.vimeo_id}" data-video-type="${v.video_type || 'vimeo'}" data-desc="${esc(v.description)}" data-tags-theme="${esc(v.tags_theme||v.tags||'')}" data-tags-medium="${esc(v.tags_medium||'')}" data-sort="${v.sort_order}" data-featured="${v.featured}" data-archived="${v.archived}">
      <div class="info">
        <h3>${esc(v.title)}</h3>
        <div class="meta">
          <span>${esc(v.students)}</span>
          <span>${v.year}</span>
          <span>${v.video_type || 'vimeo'}/${v.video_id || v.vimeo_id}</span>
          <span>sort: ${v.sort_order}</span>
        </div>
        <div class="badges">
          ${v.featured ? '<span class="badge featured">highlight</span>' : ''}
          ${v.archived ? '<span class="badge archived">archief</span>' : ''}
          ${(v.tags_theme||v.tags||'').split(',').filter(Boolean).map(t => '<span class="badge">'+t.trim()+'</span>').join('')}
          ${(v.tags_medium||'').split(',').filter(Boolean).map(t => '<span class="badge" style="border-style:dashed">'+t.trim()+'</span>').join('')}
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-edit" onclick="editVideo(${v.id})">edit</button>
        <button class="btn btn-danger" onclick="deleteVideo(${v.id})">delete</button>
      </div>
    </div>`).join('')}
  </div>

  <!-- Edit overlay -->
  <div id="edit-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:100; display:none; align-items:center; justify-content:center; padding:40px;">
    <div class="form-section" style="margin:0; width:100%; max-width:700px; max-height:90vh; overflow-y:auto;">
      <h2>video bewerken</h2>
      <form id="edit-form">
        <input type="hidden" name="id" id="edit-id">

        <label>titel</label>
        <input type="text" name="title" id="edit-title" required>

        <div class="row">
          <div>
            <label>studenten</label>
            <input type="text" name="students" id="edit-students" required>
          </div>
          <div>
            <label>jaar</label>
            <input type="number" name="year" id="edit-year" min="2020" max="2030" required>
          </div>
        </div>

        <label>video link (Vimeo of YouTube)</label>
        <input type="text" name="video_link" id="edit-video-link" required>

        <label>beschrijving (150 woorden)</label>
        <textarea name="description" id="edit-desc" maxlength="1500" required></textarea>

        <label>themes / positions (kommagescheiden)</label>
        <input type="text" name="tags_theme" id="edit-tags-theme">

        <label>medium / strategy (kommagescheiden)</label>
        <input type="text" name="tags_medium" id="edit-tags-medium">

        <div class="row">
          <div>
            <label>sorteervolgorde (lager = eerder)</label>
            <input type="number" name="sort_order" id="edit-sort" value="0">
          </div>
        </div>

        <div class="check-row">
          <label><input type="checkbox" name="featured" id="edit-featured"> highlight</label>
          <label><input type="checkbox" name="archived" id="edit-archived"> archief</label>
        </div>

        <div style="display:flex;gap:12px;margin-top:24px;">
          <button type="submit">opslaan</button>
          <button type="button" class="btn" style="background:#fff;color:#555;border-color:#ccc;" onclick="closeEdit()">annuleren</button>
        </div>
      </form>
    </div>
  </div>

<script>
  const authHeader = 'Basic ' + btoa('${ADMIN_USER}:${ADMIN_PASS}');

  document.getElementById('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      students: fd.get('students'),
      year: fd.get('year'),
      video_link: fd.get('video_link'),
      description: fd.get('description'),
      tags_theme: fd.get('tags_theme'),
      tags_medium: fd.get('tags_medium'),
      sort_order: fd.get('sort_order'),
      featured: fd.get('featured') === 'on',
      archived: fd.get('archived') === 'on'
    };
    await fetch('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(body)
    });
    location.reload();
  });

  async function deleteVideo(id) {
    if (!confirm('Video verwijderen?')) return;
    await fetch('/api/videos/' + id, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader }
    });
    location.reload();
  }

  async function approveVideo(id, featured, archived) {
    await fetch('/api/videos/' + id + '/approve', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ featured, archived })
    });
    location.reload();
  }

  async function rejectVideo(id) {
    if (!confirm('Submission afwijzen?')) return;
    await fetch('/api/videos/' + id + '/reject', {
      method: 'PUT',
      headers: { 'Authorization': authHeader }
    });
    location.reload();
  }

  function editVideo(id) {
    const item = document.querySelector('.video-item[data-id="'+id+'"]');
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-title').value = item.dataset.title;
    document.getElementById('edit-students').value = item.dataset.students;
    document.getElementById('edit-year').value = item.dataset.year;
    const vtype = item.dataset.videoType || 'vimeo';
    const vid = item.dataset.videoId;
    document.getElementById('edit-video-link').value = vtype === 'youtube' ? 'https://youtu.be/' + vid : 'https://vimeo.com/' + vid;
    document.getElementById('edit-desc').value = item.dataset.desc;
    document.getElementById('edit-tags-theme').value = item.dataset.tagsTheme || '';
    document.getElementById('edit-tags-medium').value = item.dataset.tagsMedium || '';
    document.getElementById('edit-sort').value = item.dataset.sort;
    document.getElementById('edit-featured').checked = item.dataset.featured === '1';
    document.getElementById('edit-archived').checked = item.dataset.archived === '1';
    const overlay = document.getElementById('edit-overlay');
    overlay.style.display = 'flex';
  }

  function closeEdit() {
    document.getElementById('edit-overlay').style.display = 'none';
  }

  document.getElementById('edit-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('edit-overlay')) closeEdit();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEdit();
  });

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const body = {
      title: fd.get('title'),
      students: fd.get('students'),
      year: fd.get('year'),
      video_link: fd.get('video_link'),
      description: fd.get('description'),
      tags_theme: fd.get('tags_theme'),
      tags_medium: fd.get('tags_medium'),
      sort_order: fd.get('sort_order'),
      featured: fd.get('featured') === 'on',
      archived: fd.get('archived') === 'on'
    };
    await fetch('/api/videos/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(body)
    });
    location.reload();
  });
</script>
</body>
</html>`);
});

// --- Dither Lab ---
async function renderLab(req, res) {
  const allVideos = (await getVideoRows()).filter(v => v.status === 'approved' || !v.status);
  function e(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  const cards = allVideos.map(v => {
    const vid = v.video_id || v.vimeo_id;
    const vtype = v.video_type || 'vimeo';
    const hasThumb = v.has_thumb ? '1' : '0';
    return '<div class="lc" data-vid="' + e(vid) + '" data-vtype="' + e(vtype) + '" data-id="' + v.id + '" data-has-thumb="' + hasThumb + '">' +
      '<div class="lt"></div>' +
      '<div class="lm">' +
        '<div class="lmr">' +
          '<div class="ln">' + e(v.title) + '</div>' +
          '<div class="ls">' + e(v.students) + '</div>' +
          '<div class="lsw"></div>' +
        '</div>' +
        '<div class="lact">' +
          '<span class="ldot' + (v.has_thumb ? ' baked' : '') + '" title="' + (v.has_thumb ? 'baked' : 'not baked') + '"></span>' +
          '<button class="lbake-btn" data-id="' + v.id + '">bake</button>' +
        '</div>' +
      '</div>' +
      '</div>';
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>dither lab</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
body{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#111;background:#f5f5f5}
#panel{position:fixed;top:0;left:0;right:0;z-index:100;background:#fff;border-bottom:1px solid #ddd;transition:box-shadow .2s}
#panel-bar{display:flex;align-items:center;gap:12px;padding:0 16px;height:34px;cursor:pointer;user-select:none}
#panel-bar:hover{background:#fafafa}
#ptoggle{font-size:10px;color:#aaa}
#ptitle{font-size:10px;letter-spacing:.1em;color:#666}
#panel-body{display:none;padding:10px 16px 12px;border-top:1px solid #eee;overflow-x:auto}
#panel-body.open{display:flex;flex-wrap:wrap;gap:14px 28px;align-items:flex-start}
.pg{display:flex;flex-direction:column;gap:3px;min-width:150px}
.pgl{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#bbb;margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #eee}
.pg label{display:flex;align-items:center;gap:5px;white-space:nowrap;font-size:10px;color:#555;line-height:1.7}
.pg label span.val{min-width:30px;text-align:right;color:#999;font-size:10px}
.pg input[type=range]{width:80px;accent-color:#444;flex-shrink:0}
.pg select{font-family:inherit;font-size:10px;border:1px solid #e0e0e0;background:#fff;padding:2px 4px;color:#444;max-width:148px}
.pg input[type=color]{width:20px;height:16px;border:1px solid #ddd;padding:0;cursor:pointer;flex-shrink:0}
.pc{display:none;padding-left:6px;flex-direction:column;gap:3px}
.pc.vis{display:flex}
#copy-btn{font-family:inherit;font-size:10px;letter-spacing:.05em;padding:5px 12px;border:1px solid #bbb;background:#fff;cursor:pointer;margin-top:8px;align-self:flex-start}
#copy-btn:hover{background:#111;color:#fff;border-color:#111}
#render-btn{font-family:inherit;font-size:10px;letter-spacing:.05em;padding:5px 14px;border:1px solid #333;background:#333;color:#fff;cursor:pointer;margin-top:8px;align-self:flex-start}
#render-btn:hover{background:#000;border-color:#000}
.lsw{display:flex;gap:2px;margin-top:4px;flex-wrap:wrap}
.sw{display:inline-block;width:11px;height:11px;border-radius:1px}
#grid-wrap{padding:52px 32px 60px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);column-gap:25px;row-gap:8px}
.lc{}
.lt{position:relative;aspect-ratio:16/9;background:#eee;overflow:hidden;cursor:pointer}
.lt img{width:100%;height:100%;object-fit:cover;display:block}
.lt canvas{position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated}
.ln{font-size:11px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ls{font-size:10px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;align-items:center;justify-content:center}
#modal.open{display:flex}
#mbox{background:#fff;padding:20px;max-width:520px;width:90%}
#mjson{width:100%;height:260px;border:1px solid #ddd;padding:8px;font-size:10px;font-family:inherit;resize:none;outline:none}
#mapply,#mclose{font-family:inherit;font-size:10px;padding:5px 12px;border:1px solid #999;background:#fff;cursor:pointer}
#mapply{border-color:#333;background:#333;color:#fff}#mapply:hover{background:#000}
#bake-all-btn{font-family:inherit;font-size:10px;letter-spacing:.05em;padding:5px 12px;border:1px solid #5a9a5a;background:#5a9a5a;color:#fff;cursor:pointer;margin-top:8px;align-self:flex-start}
#bake-all-btn:hover{background:#3d7a3d;border-color:#3d7a3d}
#bake-all-btn:disabled{background:#aaa;border-color:#aaa;cursor:default}
.lm{display:flex;align-items:flex-start;gap:6px;padding:3px 0 0}
.lmr{flex:1;min-width:0}
.lact{display:flex;align-items:center;gap:5px;flex-shrink:0;padding-top:1px}
.ldot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ccc;flex-shrink:0}
.ldot.baked{background:#5a9a5a}
.lbake-btn{font-family:inherit;font-size:9px;padding:2px 6px;border:1px solid #bbb;background:#fff;cursor:pointer;white-space:nowrap}
.lbake-btn:hover{background:#333;color:#fff;border-color:#333}
.lbake-btn.saved{background:#5a9a5a;color:#fff;border-color:#5a9a5a}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:540px){.grid{grid-template-columns:1fr};#grid-wrap{padding:52px 16px 40px}}
</style>
</head>
<body>
<div id="panel">
  <div id="panel-bar"><span id="ptoggle">▸</span><span id="ptitle">dither lab</span></div>
  <div id="panel-body">
    <div class="pg">
      <div class="pgl">image</div>
      <label>brightness <input type="range" id="i-bright" min="-80" max="80" value="7"><span class="val" id="v-bright">7</span></label>
      <label>shadows <input type="range" id="i-shadows" min="0" max="120" value="67"><span class="val" id="v-shadows">67</span></label>
      <label>gamma <input type="range" id="i-gamma" min="50" max="300" value="135"><span class="val" id="v-gamma">1.35</span></label>
      <label>contrast <input type="range" id="i-contrast" min="50" max="200" value="127"><span class="val" id="v-contrast">1.27</span></label>
      <label>blur <input type="range" id="i-blur" min="0" max="3" step="1" value="2"><span class="val" id="v-blur">2</span></label>
    </div>
    <div class="pg">
      <div class="pgl">dither</div>
      <label>technique <select id="i-tech"><option value="fs">floyd-steinberg</option><option value="atkinson">atkinson</option><option value="ordered">ordered (bayer)</option><option value="chsep">channel sep</option></select></label>
      <label>width <input type="range" id="i-width" min="200" max="800" value="500"><span class="val" id="v-width">500</span></label>
    </div>
    <div class="pg">
      <div class="pgl">palette</div>
      <label>mode <select id="i-pmode"><option value="kmeans">kmeans (image)</option><option value="fixed">fixed (site)</option><option value="mono">mono</option><option value="duo" selected>duo</option><option value="tint">tint</option><option value="custom">custom</option></select></label>
      <label>colors <input type="range" id="i-pcolors" min="2" max="8" value="4"><span class="val" id="v-pcolors">4</span></label>
      <label>pastel <input type="range" id="i-pastel" min="0" max="100" value="60"><span class="val" id="v-pastel">60%</span></label>
      <label>lightness <input type="range" id="i-light" min="0" max="100" value="50"><span class="val" id="v-light">50%</span></label>
      <div id="pc-mono" class="pc"><label>hue <input type="color" id="i-monohue" value="#3C5A78"></label></div>
      <div id="pc-tint" class="pc"><label>hue <input type="color" id="i-tinthue" value="#3C5A78"></label></div>
      <div id="pc-fixed" class="pc"><label>extras <select id="i-fixedx"><option value="warm">warm</option><option value="cool">cool</option><option value="neutral">neutral</option></select></label></div>
      <div id="pc-duo" class="pc">
        <label>preset <select id="i-duopreset" style="max-width:148px"></select></label>
        <label>col 1 <input type="color" id="i-duo1" value="#5991a6"></label>
        <label>col 2 <input type="color" id="i-duo2" value="#bab4b0"></label>
      </div>
      <div id="pc-custom" class="pc">
        <label>col 1 <input type="color" id="i-cus1" value="#3C3C78"></label>
        <label>col 2 <input type="color" id="i-cus2" value="#82412D"></label>
        <label>col 3 <input type="color" id="i-cus3" value="#F8F5EE"></label>
      </div>
    </div>
    <div class="pg">
      <div class="pgl">options</div>
      <label><input type="checkbox" id="i-basetones" checked> + cream &amp; charcoal</label>
      <div id="pc-basetones" class="pc vis">
        <label>cream <input type="color" id="i-cream" value="#ffffff"></label>
        <label>grey <input type="color" id="i-charcoal" value="#787878"></label>
      </div>
      <label><input type="checkbox" id="i-shared"> shared palette</label>
      <div id="pc-shared" class="pc">
        <label>pool <input type="range" id="i-pool" min="3" max="12" value="6"><span class="val" id="v-pool">6</span></label>
      </div>
    </div>
    <div class="pg">
      <div class="pgl">hover</div>
      <label><input type="checkbox" id="i-shimmer" checked> shimmer</label>
      <label>fps <input type="range" id="i-fps" min="4" max="20" value="8"><span class="val" id="v-fps">8</span></label>
      <label>intensity <input type="range" id="i-inten" min="5" max="60" value="20"><span class="val" id="v-inten">20</span></label>
      <label><input type="checkbox" id="i-reveal" checked> reveal color</label>
      <label>accent <select id="i-amode"><option value="single">single</option><option value="dual">dual</option><option value="extract">extract</option></select></label>
      <label>acc 1 <input type="color" id="i-acc1" value="#825A38"></label>
      <div id="pc-acc2" class="pc"><label>acc 2 <input type="color" id="i-acc2" value="#285A46"></label></div>
      <label>reveal% <input type="range" id="i-revpct" min="5" max="50" value="15"><span class="val" id="v-revpct">15</span></label>
    </div>
    <div class="pg" style="justify-content:flex-end;gap:6px"><button id="render-btn">▶ render</button><button id="bake-all-btn">bake all</button><button id="copy-btn">copy settings ↗</button></div>
  </div>
</div>

<div id="grid-wrap"><div class="grid" id="lab-grid">${cards}</div></div>

<div id="modal"><div id="mbox">
  <div style="font-size:10px;color:#aaa;margin-bottom:8px;letter-spacing:.06em">SETTINGS — select all &amp; copy</div>
  <textarea id="mjson"></textarea>
  <div style="display:flex;gap:8px;margin-top:10px">
    <button id="mapply">apply</button>
    <button id="mclose">close</button>
    <span id="merr" style="font-size:10px;color:#c00;align-self:center"></span>
  </div>
</div></div>

<script>
// ── color utils ──────────────────────────────────────────
function hexToRgb(h){return[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)]}
function hslToRgb(h,s,l){
  var c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2,r,g,b;
  if(h<60){r=c;g=x;b=0}else if(h<120){r=x;g=c;b=0}else if(h<180){r=0;g=c;b=x}
  else if(h<240){r=0;g=x;b=c}else if(h<300){r=x;g=0;b=c}else{r=c;g=0;b=x}
  return[Math.round((r+m)*255),Math.round((g+m)*255),Math.round((b+m)*255)];
}
function rgbToHsl(r,g,b){
  r/=255;g/=255;b/=255;
  var mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,h=0,s=0,l=(mx+mn)/2;
  if(d>0){s=d/(1-Math.abs(2*l-1));
    if(mx===r)h=((g-b)/d+6)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;}
  return[h,s,l];
}
function rgbToLab(r,g,b){
  function lin(v){v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
  var lr=lin(r),lg=lin(g),lb=lin(b);
  var x=lr*0.4124564+lg*0.3575761+lb*0.1804375,y=lr*0.2126729+lg*0.7151522+lb*0.0721750,z=lr*0.0193339+lg*0.1191920+lb*0.9503041;
  function f(t){return t>0.008856?Math.cbrt(t):7.787*t+16/116}
  var fx=f(x/0.95047),fy=f(y),fz=f(z/1.08883);
  return[116*fy-16,500*(fx-fy),200*(fy-fz)];
}
function labToRgb(L,a,b){
  var fy=(L+16)/116,fx=a/500+fy,fz=fy-b/200;
  function inv(t){return t>0.206897?t*t*t:(t-16/116)/7.787}
  var x=inv(fx)*0.95047,y=inv(fy),z=inv(fz)*1.08883;
  function sg(v){return v<=0.0031308?12.92*v:1.055*Math.pow(v,1/2.4)-0.055}
  return[Math.max(0,Math.min(255,Math.round(sg(x*3.2404542-y*1.5371385-z*0.4985314)*255))),
         Math.max(0,Math.min(255,Math.round(sg(-x*0.9692660+y*1.8760108+z*0.0415560)*255))),
         Math.max(0,Math.min(255,Math.round(sg(x*0.0556434-y*0.2040259+z*1.0572252)*255)))];
}
function labDist(a,b){var d0=a[0]-b[0],d1=a[1]-b[1],d2=a[2]-b[2];return Math.sqrt(d0*d0+d1*d1+d2*d2)}

// ── palette ──────────────────────────────────────────────
function kMeans(pixels,k){
  var labs=pixels.map(function(p){return rgbToLab(p[0],p[1],p[2])});
  var n=labs.length;
  if(!n)return Array.from({length:k},function(){return[128,128,128]});
  var cens=[labs[Math.floor(Math.random()*n)]];
  while(cens.length<k){
    var ds=labs.map(function(p){return Math.min.apply(null,cens.map(function(c){return labDist(p,c)}))});
    var s=ds.reduce(function(a,b){return a+b},0),rv=Math.random()*s,ch=labs[n-1];
    for(var i=0;i<n;i++){rv-=ds[i];if(rv<=0){ch=labs[i];break}}
    cens.push(ch);
  }
  for(var iter=0;iter<20;iter++){
    var sums=Array.from({length:k},function(){return[0,0,0]}),cnts=new Array(k).fill(0);
    for(var pi=0;pi<n;pi++){
      var bd=Infinity,bi=0;
      for(var ci=0;ci<k;ci++){var d=labDist(labs[pi],cens[ci]);if(d<bd){bd=d;bi=ci}}
      sums[bi][0]+=labs[pi][0];sums[bi][1]+=labs[pi][1];sums[bi][2]+=labs[pi][2];cnts[bi]++;
    }
    var moved=false;
    for(var ci=0;ci<k;ci++){
      if(cnts[ci]>0){var nc=[sums[ci][0]/cnts[ci],sums[ci][1]/cnts[ci],sums[ci][2]/cnts[ci]];if(labDist(nc,cens[ci])>0.5)moved=true;cens[ci]=nc;}
    }
    if(!moved)break;
  }
  return cens.map(function(c){return labToRgb(c[0],c[1],c[2])});
}

function toPastel(rgb,str){
  var hsl=rgbToHsl(rgb[0],rgb[1],rgb[2]);
  var s=hsl[1]*(1-str*0.7),l=Math.min(0.95,hsl[2]+(0.85-hsl[2])*str*0.6);
  return hslToRgb(hsl[0],s,l);
}
function adjustL(rgb,tgt){
  var hsl=rgbToHsl(rgb[0],rgb[1],rgb[2]);
  var l=Math.max(0.04,Math.min(0.97,hsl[2]+(tgt/100-0.5)*0.6));
  return hslToRgb(hsl[0],hsl[1],l);
}
function genShades(base,n,pastel,light){
  var hsl=rgbToHsl(base[0],base[1],base[2]),shades=[];
  for(var i=0;i<n;i++){
    var t=n===1?0.5:i/(n-1),l=0.85-t*0.65;
    var rgb=hslToRgb(hsl[0],hsl[1],l);
    rgb=toPastel(rgb,pastel/100);rgb=adjustL(rgb,light);
    shades.push(rgb);
  }
  return shades;
}

var DUO=[
  {name:'navy + clay',c1:'#3C3C78',c2:'#82412D'},{name:'indigo + sand',c1:'#2B3A67',c2:'#C4956A'},
  {name:'forest + dusty rose',c1:'#2D5A46',c2:'#A0707A'},{name:'slate + terracotta',c1:'#4A6670',c2:'#B0704A'},
  {name:'teal + warm stone',c1:'#2A6B6B',c2:'#8A8070'},{name:'prussian + gold',c1:'#1E3A5F',c2:'#C9A84C'},
  {name:'olive + mauve',c1:'#5C6B3C',c2:'#8B6B8A'},{name:'charcoal + sage',c1:'#3C4040',c2:'#7A9A7A'},
  {name:'burgundy + linen',c1:'#6B2D3E',c2:'#B8A898'},{name:'ocean + coral',c1:'#2E5C6E',c2:'#C07860'},
  {name:'plum + honey',c1:'#5A4A78',c2:'#B89A60'},{name:'ink + amber',c1:'#3A3A3A',c2:'#C4A070'}
];

function buildPalette(cfg,samples){
  var m=cfg.palette.mode,n=cfg.palette.colors,p=cfg.palette.pastel,l=cfg.palette.lightness,cols=[];
  if(m==='kmeans'){cols=kMeans(samples.length?samples:[[128,128,128]],n);}
  else if(m==='fixed'){
    var bases={warm:[[60,60,120],[40,90,70],[130,65,45],[200,160,100],[248,245,238]],
               cool:[[40,70,120],[60,120,140],[80,80,100],[140,160,180],[240,244,248]],
               neutral:[[80,80,80],[120,100,80],[160,140,120],[200,190,178],[244,240,234]]};
    cols=(bases[cfg.palette.fixedExtras]||bases.warm).slice(0,n).map(function(c){return adjustL(toPastel(c,p/100),l)});
  }
  else if(m==='mono'){cols=genShades(hexToRgb(cfg.palette.monoHue),n,p,l);}
  else if(m==='tint'){cols=genShades(hexToRgb(cfg.palette.tintHue),Math.max(1,n-1),p,l);cols.push([255,255,255]);}
  else if(m==='duo'){
    var h1=Math.ceil(n/2),h2=Math.floor(n/2);
    cols=genShades(hexToRgb(cfg.palette.duo1),h1,p,l).concat(genShades(hexToRgb(cfg.palette.duo2),h2,p,l));
  }
  else if(m==='custom'){
    var cs=[hexToRgb(cfg.palette.cus1),hexToRgb(cfg.palette.cus2),hexToRgb(cfg.palette.cus3)];
    var each=Math.ceil(n/3);
    cols=cs[0].length?genShades(cs[0],each,p,l).concat(genShades(cs[1],each,p,l)).concat(genShades(cs[2],Math.max(0,n-each*2),p,l)).slice(0,n):[];
  }
  if(cfg.baseTones.enabled){cols=[hexToRgb(cfg.baseTones.cream)].concat(cols).concat([hexToRgb(cfg.baseTones.charcoal)]);}
  cols.sort(function(a,b){return(b[0]*.299+b[1]*.587+b[2]*.114)-(a[0]*.299+a[1]*.587+a[2]*.114)});
  return cols;
}

// ── preprocess ───────────────────────────────────────────
function preprocess(imageData,cfg){
  var d=imageData.data,w=imageData.width,h=imageData.height;
  var br=cfg.image.brightness,sh=cfg.image.shadows,ga=cfg.image.gamma,co=cfg.image.contrast,bl=cfg.image.blur||0;
  var res=new Float32Array(w*h*3);
  for(var i=0;i<d.length;i+=4){
    var r=d[i],g=d[i+1],b=d[i+2];
    if(sh>0){r=sh+r*(255-sh)/255;g=sh+g*(255-sh)/255;b=sh+b*(255-sh)/255}
    r=Math.max(0,Math.min(255,r+br));g=Math.max(0,Math.min(255,g+br));b=Math.max(0,Math.min(255,b+br));
    if(ga!==1){r=255*Math.pow(r/255,1/ga);g=255*Math.pow(g/255,1/ga);b=255*Math.pow(b/255,1/ga)}
    if(co!==1){r=((r/255-.5)*co+.5)*255;g=((g/255-.5)*co+.5)*255;b=((b/255-.5)*co+.5)*255}
    var j=i/4*3;res[j]=Math.max(0,Math.min(255,r));res[j+1]=Math.max(0,Math.min(255,g));res[j+2]=Math.max(0,Math.min(255,b));
  }
  if(bl>0){
    var tmp=new Float32Array(w*h*3);
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var sr=0,sg=0,sb=0,cnt=0;
      for(var dx=-bl;dx<=bl;dx++){var nx=x+dx<0?0:x+dx>=w?w-1:x+dx,j=(y*w+nx)*3;sr+=res[j];sg+=res[j+1];sb+=res[j+2];cnt++}
      var k=(y*w+x)*3;tmp[k]=sr/cnt;tmp[k+1]=sg/cnt;tmp[k+2]=sb/cnt;
    }
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var sr=0,sg=0,sb=0,cnt=0;
      for(var dy=-bl;dy<=bl;dy++){var ny=y+dy<0?0:y+dy>=h?h-1:y+dy,j=(ny*w+x)*3;sr+=tmp[j];sg+=tmp[j+1];sb+=tmp[j+2];cnt++}
      var k=(y*w+x)*3;res[k]=sr/cnt;res[k+1]=sg/cnt;res[k+2]=sb/cnt;
    }
  }
  return res;
}

// ── nearest color ─────────────────────────────────────────
function nearest(r,g,b,pal,plab){
  var px=rgbToLab(r,g,b),bd=Infinity,bi=0;
  for(var i=0;i<plab.length;i++){var d=labDist(px,plab[i]);if(d<bd){bd=d;bi=i}}
  return bi;
}

// ── dither algorithms ─────────────────────────────────────
var BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

function applyFS(px,w,h,pal,plab){
  var buf=new Float32Array(px),out=new Uint8ClampedArray(w*h*4);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var idx=y*w+x,i3=idx*3;
    var r=Math.max(0,Math.min(255,buf[i3])),g=Math.max(0,Math.min(255,buf[i3+1])),b=Math.max(0,Math.min(255,buf[i3+2]));
    var ci=nearest(r,g,b,pal,plab),nr=pal[ci][0],ng=pal[ci][1],nb=pal[ci][2];
    var er=r-nr,eg=g-ng,eb=b-nb;
    function add(ii,f){if(ii>=0&&ii<w*h){buf[ii*3]+=er*f;buf[ii*3+1]+=eg*f;buf[ii*3+2]+=eb*f}}
    if(x+1<w)add(idx+1,7/16);if(y+1<h&&x>0)add(idx+w-1,3/16);if(y+1<h)add(idx+w,5/16);if(y+1<h&&x+1<w)add(idx+w+1,1/16);
    out[idx*4]=nr;out[idx*4+1]=ng;out[idx*4+2]=nb;out[idx*4+3]=255;
  }
  return out;
}

function applyAtkinson(px,w,h,pal,plab){
  var buf=new Float32Array(px),out=new Uint8ClampedArray(w*h*4);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var idx=y*w+x,i3=idx*3;
    var r=Math.max(0,Math.min(255,buf[i3])),g=Math.max(0,Math.min(255,buf[i3+1])),b=Math.max(0,Math.min(255,buf[i3+2]));
    var ci=nearest(r,g,b,pal,plab),nr=pal[ci][0],ng=pal[ci][1],nb=pal[ci][2];
    var er=r-nr,eg=g-ng,eb=b-nb;
    function add2(ii,f){if(ii>=0&&ii<w*h){buf[ii*3]+=er*f;buf[ii*3+1]+=eg*f;buf[ii*3+2]+=eb*f}}
    if(x+1<w)add2(idx+1,1/8);if(x+2<w)add2(idx+2,1/8);if(y+1<h&&x>0)add2(idx+w-1,1/8);
    if(y+1<h)add2(idx+w,1/8);if(y+1<h&&x+1<w)add2(idx+w+1,1/8);if(y+2<h)add2(idx+2*w,1/8);
    out[idx*4]=nr;out[idx*4+1]=ng;out[idx*4+2]=nb;out[idx*4+3]=255;
  }
  return out;
}

function applyOrdered(px,w,h,pal,plab){
  var out=new Uint8ClampedArray(w*h*4);
  for(var y=0;y<h;y++)for(var x=0;x<w;x++){
    var idx=y*w+x,bv=(BAYER[(y%4)*4+(x%4)]/16-.5)*60;
    var r=Math.max(0,Math.min(255,px[idx*3]+bv)),g=Math.max(0,Math.min(255,px[idx*3+1]+bv)),b=Math.max(0,Math.min(255,px[idx*3+2]+bv));
    var ci=nearest(r,g,b,pal,plab);
    out[idx*4]=pal[ci][0];out[idx*4+1]=pal[ci][1];out[idx*4+2]=pal[ci][2];out[idx*4+3]=255;
  }
  return out;
}

function applyChSep(px,w,h,pal,plab){
  var n=pal.length,k=w*h,dens=[];
  for(var c=0;c<n;c++)dens.push(new Float32Array(k));
  for(var i=0;i<k;i++){
    var r=px[i*3],g=px[i*3+1],b=px[i*3+2],pl=rgbToLab(r,g,b);
    var ds=plab.map(function(c){return labDist(pl,c)});
    var mxD=Math.max.apply(null,ds),mnD=Math.min.apply(null,ds),rng=mxD-mnD||1;
    var ws=ds.map(function(d){var w=1-(d-mnD)/rng;return w*w}),sm=ws.reduce(function(a,b){return a+b},0)||1;
    for(var c=0;c<n;c++)dens[c][i]=ws[c]/sm;
  }
  var plates=[];
  for(var c=0;c<n;c++){
    var d=new Float32Array(dens[c]),pl=new Uint8Array(k);
    for(var y=0;y<h;y++)for(var x=0;x<w;x++){
      var ii=y*w+x,old=d[ii],nw=old>0.5?1:0;pl[ii]=nw;var err=old-nw;
      if(x+1<w)d[ii+1]+=err*7/16;if(y+1<h&&x>0)d[ii+w-1]+=err*3/16;if(y+1<h)d[ii+w]+=err*5/16;if(y+1<h&&x+1<w)d[ii+w+1]+=err*1/16;
    }
    plates.push(pl);
  }
  var out=new Uint8ClampedArray(k*4);
  for(var i=0;i<k;i++){
    var r=255,g=255,b=255;
    for(var c=0;c<n;c++){if(plates[c][i]){r=Math.round(r*pal[c][0]/255);g=Math.round(g*pal[c][1]/255);b=Math.round(b*pal[c][2]/255)}}
    out[i*4]=r;out[i*4+1]=g;out[i*4+2]=b;out[i*4+3]=255;
  }
  return out;
}

function runDither(px,w,h,pal,plab,tech){
  var pl=plab||pal.map(function(c){return rgbToLab(c[0],c[1],c[2])});
  if(tech==='atkinson')return applyAtkinson(px,w,h,pal,pl);
  if(tech==='ordered')return applyOrdered(px,w,h,pal,pl);
  if(tech==='chsep')return applyChSep(px,w,h,pal,pl);
  return applyFS(px,w,h,pal,pl);
}

// ── card rendering ────────────────────────────────────────
function sampleCard(card,img,w,h){
  var tc=document.createElement('canvas');tc.width=w;tc.height=h;
  var tx=tc.getContext('2d');
  var ir=img.naturalWidth/img.naturalHeight,cr=w/h;
  var sx=0,sy=0,sw=img.naturalWidth,sh=img.naturalHeight;
  if(ir>cr){sw=img.naturalHeight*cr;sx=(img.naturalWidth-sw)/2}else{sh=img.naturalWidth/cr;sy=(img.naturalHeight-sh)/2}
  tx.drawImage(img,sx,sy,sw,sh,0,0,w,h);
  var d=tx.getImageData(0,0,w,h).data,samples=[];
  for(var i=0;i<d.length;i+=4*10)samples.push([d[i],d[i+1],d[i+2]]);
  return{raw:tx.getImageData(0,0,w,h),samples:samples};
}

function renderCard(card,cfg,forcePal){
  var img=card.querySelector('img');
  if(!img||!img.complete||!img.naturalWidth)return;
  var w=cfg.dither.width,h=Math.round(w*9/16);
  var lt=card.querySelector('.lt');
  var canvas=card.querySelector('canvas');
  if(!canvas){canvas=document.createElement('canvas');canvas.style.imageRendering='pixelated';lt.appendChild(canvas)}
  canvas.width=w;canvas.height=h;
  var ctx=canvas.getContext('2d');
  var sd=sampleCard(card,img,w,h);
  var pal=forcePal||buildPalette(cfg,sd.samples);
  var plab=pal.map(function(c){return rgbToLab(c[0],c[1],c[2])});
  var px=preprocess(sd.raw,cfg);
  var out=runDither(px,w,h,pal,plab,cfg.dither.technique);
  ctx.putImageData(new ImageData(out,w,h),0,0);
  card._px=px;card._pal=pal;card._plab=plab;card._cfg=cfg;card._w=w;card._h=h;
  var sw=card.querySelector('.lsw');
  if(sw)sw.innerHTML=pal.map(function(c){return'<span class="sw" style="background:rgb('+c[0]+','+c[1]+','+c[2]+')"></span>'}).join('');
}

// ── hover / shimmer ───────────────────────────────────────
function accPalette(card,cfg){
  var m=cfg.hover.accentMode;
  if(m==='extract')return card._pal;
  var base=(card._pal||[]).slice();
  var a1=hexToRgb(cfg.hover.acc1);
  if(m==='dual'){var a2=hexToRgb(cfg.hover.acc2);return base.concat([a1,a2])}
  return base.concat([a1]);
}

function shimmerFrame(card,blend){
  if(!card._px||!card._cfg)return;
  var cfg=card._cfg,w=card._w,h=card._h,inten=cfg.hover.intensity;
  var canvas=card.querySelector('canvas');if(!canvas)return;
  var ctx=canvas.getContext('2d');
  var noisy=new Float32Array(card._px);
  for(var i=0;i<noisy.length;i++)noisy[i]+=(Math.random()-.5)*inten*2;
  var base=runDither(noisy,w,h,card._pal,card._plab,cfg.dither.technique);
  if(blend>0&&cfg.hover.reveal){
    var ap=accPalette(card,cfg);
    var al=ap.map(function(c){return rgbToLab(c[0],c[1],c[2])});
    var acc=runDither(noisy,w,h,ap,al,cfg.dither.technique);
    var t=blend*cfg.hover.revealPct/100,blended=new Uint8ClampedArray(w*h*4);
    for(var i=0;i<w*h*4;i+=4){
      blended[i]=Math.round(base[i]*(1-t)+acc[i]*t);
      blended[i+1]=Math.round(base[i+1]*(1-t)+acc[i+1]*t);
      blended[i+2]=Math.round(base[i+2]*(1-t)+acc[i+2]*t);
      blended[i+3]=255;
    }
    ctx.putImageData(new ImageData(blended,w,h),0,0);
  }else{ctx.putImageData(new ImageData(base,w,h),0,0)}
}

function attachHover(card){
  var active=false,blend=0,raf=null,to=null;
  var lt=card.querySelector('.lt');
  function fps(){return card._cfg?card._cfg.hover.fps:8}
  function tick(){
    shimmerFrame(card,blend);
    to=setTimeout(function(){raf=requestAnimationFrame(tick)},1000/fps());
  }
  lt.addEventListener('mouseenter',function(){
    if(!card._cfg||!card._cfg.hover.shimmer)return;
    active=true;clearTimeout(to);if(raf)cancelAnimationFrame(raf);
    function fi(){blend=Math.min(1,blend+0.1);shimmerFrame(card,blend);
      if(blend<1&&active)to=setTimeout(function(){raf=requestAnimationFrame(fi)},1000/fps());
      else if(active)to=setTimeout(function(){raf=requestAnimationFrame(tick)},1000/fps());
    }raf=requestAnimationFrame(fi);
  });
  lt.addEventListener('mouseleave',function(){
    active=false;clearTimeout(to);if(raf)cancelAnimationFrame(raf);
    function fo(){blend=Math.max(0,blend-0.15);shimmerFrame(card,blend);
      if(blend>0)to=setTimeout(function(){raf=requestAnimationFrame(fo)},1000/fps());
    }raf=requestAnimationFrame(fo);
  });
}

// ── re-render all ─────────────────────────────────────────
var renderTimer=null;
function readCfg(){
  function v(id){return document.getElementById(id)}
  return{
    image:{brightness:+v('i-bright').value,shadows:+v('i-shadows').value,gamma:+v('i-gamma').value/100,contrast:+v('i-contrast').value/100,blur:v('i-blur')?+v('i-blur').value:1},
    dither:{technique:v('i-tech').value,width:+v('i-width').value},
    palette:{mode:v('i-pmode').value,colors:+v('i-pcolors').value,pastel:+v('i-pastel').value,lightness:+v('i-light').value,
      monoHue:v('i-monohue').value,tintHue:v('i-tinthue').value,fixedExtras:v('i-fixedx').value,
      duo1:v('i-duo1').value,duo2:v('i-duo2').value,cus1:v('i-cus1').value,cus2:v('i-cus2').value,cus3:v('i-cus3').value},
    baseTones:{enabled:v('i-basetones').checked,cream:v('i-cream').value,charcoal:v('i-charcoal').value},
    sharedPalette:{enabled:v('i-shared').checked,pool:+v('i-pool').value},
    hover:{shimmer:v('i-shimmer').checked,fps:+v('i-fps').value,intensity:+v('i-inten').value,reveal:v('i-reveal').checked,
      accentMode:v('i-amode').value,acc1:v('i-acc1').value,acc2:v('i-acc2').value,revealPct:+v('i-revpct').value}
  };
}

function rerenderAll(){
  var cfg=readCfg();
  var cards=[...document.querySelectorAll('.lc')];
  var sharedPal=null;
  if(cfg.sharedPalette.enabled){
    var allSamples=[];
    cards.forEach(function(card){
      var img=card.querySelector('img');
      if(!img||!img.complete||!img.naturalWidth)return;
      var sd=sampleCard(card,img,cfg.dither.width,Math.round(cfg.dither.width*9/16));
      allSamples=allSamples.concat(sd.samples);
    });
    if(allSamples.length)sharedPal=buildPalette(cfg,allSamples);
  }
  cards.forEach(function(card){
    var img=card.querySelector('img');
    if(!img||!img.complete||!img.naturalWidth)return;
    renderCard(card,cfg,sharedPal);
  });
}

function scheduleRerender(){clearTimeout(renderTimer);renderTimer=setTimeout(rerenderAll,180)}

// ── thumbnail loading ─────────────────────────────────────
document.querySelectorAll('.lc').forEach(function(card){
  attachHover(card);
  var vid=card.dataset.vid,vtype=card.dataset.vtype;
  var img=document.createElement('img');
  img.crossOrigin='anonymous';
  card.querySelector('.lt').appendChild(img);
  img.addEventListener('load',function(){
    var cfg=readCfg();
    var sd=sampleCard(card,img,cfg.dither.width,Math.round(cfg.dither.width*9/16));
    var pal=buildPalette(cfg,sd.samples);
    renderCard(card,cfg,pal);
  });
  if(vtype==='youtube'){
    img.src='https://img.youtube.com/vi/'+vid+'/hqdefault.jpg';
  }else{
    fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/'+vid)
      .then(function(r){return r.json()})
      .then(function(data){
        var u=data.thumbnail_url||'';
        img.src=u.replace(/_[0-9]+x[0-9]+/,'_640')||(('https://vumbnail.com/'+vid+'.jpg'));
      })
      .catch(function(){img.src='https://vumbnail.com/'+vid+'.jpg'});
  }
});

// ── UI wiring ─────────────────────────────────────────────
// duo presets
var dp=document.getElementById('i-duopreset');
DUO.forEach(function(p,i){var o=document.createElement('option');o.value=i;o.textContent=p.name;dp.appendChild(o)});
dp.addEventListener('change',function(){var p=DUO[+dp.value];document.getElementById('i-duo1').value=p.c1;document.getElementById('i-duo2').value=p.c2});

// panel toggle
document.getElementById('panel-bar').addEventListener('click',function(){
  var pb=document.getElementById('panel-body'),icon=document.getElementById('ptoggle'),panel=document.getElementById('panel');
  pb.classList.toggle('open');icon.textContent=pb.classList.contains('open')?'▾':'▸';
  requestAnimationFrame(function(){document.getElementById('grid-wrap').style.paddingTop=(panel.offsetHeight+16)+'px'});
});

// palette mode visibility
function updPMode(){
  var m=document.getElementById('i-pmode').value;
  ['mono','tint','fixed','duo','custom'].forEach(function(n){
    var el=document.getElementById('pc-'+n);if(el)el.classList.toggle('vis',n===m);
  });
}
document.getElementById('i-pmode').addEventListener('change',updPMode);
updPMode();

// toggles
document.getElementById('i-basetones').addEventListener('change',function(){
  document.getElementById('pc-basetones').classList.toggle('vis',this.checked)});
document.getElementById('i-shared').addEventListener('change',function(){
  document.getElementById('pc-shared').classList.toggle('vis',this.checked)});
function updAMode(){document.getElementById('pc-acc2').classList.toggle('vis',document.getElementById('i-amode').value==='dual')}
document.getElementById('i-amode').addEventListener('change',updAMode);updAMode();

// slider labels
[['i-bright','v-bright',1,''],['i-shadows','v-shadows',1,''],['i-gamma','v-gamma',100,''],['i-contrast','v-contrast',100,''],['i-blur','v-blur',1,''],
 ['i-width','v-width',1,'px'],['i-pcolors','v-pcolors',1,''],['i-pastel','v-pastel',1,'%'],['i-light','v-light',1,'%'],
 ['i-pool','v-pool',1,''],['i-fps','v-fps',1,''],['i-inten','v-inten',1,''],['i-revpct','v-revpct',1,'%']
].forEach(function(row){
  var inp=document.getElementById(row[0]),sp=document.getElementById(row[1]);
  if(!inp||!sp)return;
  function upd(){sp.textContent=(row[2]>1?(parseFloat(inp.value)/row[2]).toFixed(2):inp.value)+row[3]}
  inp.addEventListener('input',upd);upd();
});

// wire all controls
document.querySelectorAll('#panel-body input,#panel-body select').forEach(function(el){
  el.addEventListener('input',scheduleRerender);el.addEventListener('change',scheduleRerender);
});

// render button (immediate, bypasses debounce)
var renderBtn=document.getElementById('render-btn');if(renderBtn)renderBtn.addEventListener('click',rerenderAll);

// ── bake ─────────────────────────────────────────────────
function getAuthHeader(){
  var u=prompt('Admin username (or cancel to abort):');if(!u)return null;
  var p=prompt('Admin password:');if(p===null)return null;
  return 'Basic '+btoa(u+':'+p);
}
var _authHeader=null;
function ensureAuth(){
  if(_authHeader)return _authHeader;
  _authHeader=getAuthHeader();
  return _authHeader;
}

function bakeCard(card,auth){
  return new Promise(function(resolve){
    var canvas=card.querySelector('canvas');
    if(!canvas){resolve({ok:false,reason:'no canvas'});return}
    var id=card.dataset.id;
    if(!id){resolve({ok:false,reason:'no id'});return}
    var img=card.querySelector('img');
    if(!img||!img.complete||!img.naturalWidth){resolve({ok:false,reason:'no image'});return}

    // Capture blur version (current render)
    var blurData=canvas.toDataURL('image/png');

    // Render sharp version (blur=0, same everything else)
    var cfg=readCfg();
    var sharpCfg=JSON.parse(JSON.stringify(cfg));
    sharpCfg.image.blur=0;
    var w=sharpCfg.dither.width,h=Math.round(w*9/16);
    var sd=sampleCard(card,img,w,h);
    var pal=buildPalette(sharpCfg,sd.samples);
    renderCard(card,sharpCfg,pal);
    var sharpData=canvas.toDataURL('image/png');

    // Restore blur render
    var origSd=sampleCard(card,img,cfg.dither.width,Math.round(cfg.dither.width*9/16));
    var origPal=buildPalette(cfg,origSd.samples);
    renderCard(card,cfg,origPal);

    fetch('/thumb/'+id,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':auth},
      body:JSON.stringify({blurData:blurData,sharpData:sharpData,settings:cfg})
    }).then(function(r){return r.json()}).then(function(data){
      if(data.ok){
        var dot=card.querySelector('.ldot');
        if(dot){dot.classList.add('baked');dot.title='baked'}
        card.dataset.hasThumb='1';
        var btn=card.querySelector('.lbake-btn');
        if(btn){btn.textContent='✓';btn.classList.add('saved');setTimeout(function(){btn.textContent='bake';btn.classList.remove('saved')},2000)}
      }
      resolve(data);
    }).catch(function(e){resolve({ok:false,reason:e.message})});
  });
}

var bakeAllBtn=document.getElementById('bake-all-btn');
if(bakeAllBtn){
  bakeAllBtn.addEventListener('click',function(){
    var auth=ensureAuth();if(!auth)return;
    var cards=[...document.querySelectorAll('.lc')].filter(function(c){return c.querySelector('canvas')});
    var total=cards.length,done=0;
    bakeAllBtn.disabled=true;
    bakeAllBtn.textContent='baking 0/'+total+'...';
    (function next(){
      if(done>=total){bakeAllBtn.textContent='✓ all baked ('+total+')';bakeAllBtn.disabled=false;return}
      var card=cards[done];
      bakeAllBtn.textContent='baking '+(done+1)+'/'+total+'...';
      bakeCard(card,auth).then(function(){done++;next()});
    })();
  });
}

document.querySelectorAll('.lbake-btn').forEach(function(btn){
  btn.addEventListener('click',function(){
    var auth=ensureAuth();if(!auth)return;
    var card=btn.closest('.lc');
    btn.textContent='...';btn.disabled=true;
    bakeCard(card,auth).then(function(){btn.disabled=false});
  });
});

// copy settings
document.getElementById('copy-btn').addEventListener('click',function(){
  var c=readCfg();
  var obj={
    image:{brightness:c.image.brightness,shadows:c.image.shadows,gamma:c.image.gamma,contrast:c.image.contrast,blur:c.image.blur},
    dither:{technique:c.dither.technique,width:c.dither.width},
    palette:Object.assign({mode:c.palette.mode,colors:c.palette.colors,pastel:c.palette.pastel,lightness:c.palette.lightness},
      c.palette.mode==='mono'?{hue:c.palette.monoHue}:{},
      c.palette.mode==='tint'?{hue:c.palette.tintHue}:{},
      c.palette.mode==='fixed'?{extras:c.palette.fixedExtras}:{},
      c.palette.mode==='duo'?{color1:c.palette.duo1,color2:c.palette.duo2}:{},
      c.palette.mode==='custom'?{color1:c.palette.cus1,color2:c.palette.cus2,color3:c.palette.cus3}:{}),
    baseTones:{enabled:c.baseTones.enabled,cream:hexToRgb(c.baseTones.cream),charcoal:hexToRgb(c.baseTones.charcoal)},
    hover:Object.assign({shimmer:c.hover.shimmer,fps:c.hover.fps,intensity:c.hover.intensity,hiddenColor:c.hover.reveal,
      accentMode:c.hover.accentMode,accent1:c.hover.acc1,revealPct:c.hover.revealPct},
      c.hover.accentMode==='dual'?{accent2:c.hover.acc2}:{})
  };
  document.getElementById('mjson').value=JSON.stringify(obj,null,2);
  document.getElementById('modal').classList.add('open');
  setTimeout(function(){document.getElementById('mjson').select()},50);
});
function rgbArrToHex(v){if(!Array.isArray(v))return v;return'#'+v.map(function(n){return Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0')}).join('')}
function setVal(id,v){var el=document.getElementById(id);if(el)el.value=v}
function setChk(id,v){var el=document.getElementById(id);if(el)el.checked=!!v}

function applySettings(json){
  var c;
  try{c=JSON.parse(json)}catch(ex){document.getElementById('merr').textContent='invalid JSON';return}
  document.getElementById('merr').textContent='';
  if(c.image){
    if(c.image.brightness!==undefined)setVal('i-bright',c.image.brightness);
    if(c.image.shadows!==undefined)setVal('i-shadows',c.image.shadows);
    if(c.image.gamma!==undefined)setVal('i-gamma',Math.round(c.image.gamma*100));
    if(c.image.contrast!==undefined)setVal('i-contrast',Math.round(c.image.contrast*100));
    if(c.image.blur!==undefined)setVal('i-blur',c.image.blur);
  }
  if(c.dither){
    if(c.dither.technique)setVal('i-tech',c.dither.technique);
    if(c.dither.width)setVal('i-width',c.dither.width);
  }
  if(c.palette){
    if(c.palette.mode)setVal('i-pmode',c.palette.mode);
    if(c.palette.colors)setVal('i-pcolors',c.palette.colors);
    if(c.palette.pastel!==undefined)setVal('i-pastel',c.palette.pastel);
    if(c.palette.lightness!==undefined)setVal('i-light',c.palette.lightness);
    if(c.palette.hue){setVal('i-monohue',c.palette.hue);setVal('i-tinthue',c.palette.hue)}
    if(c.palette.extras)setVal('i-fixedx',c.palette.extras);
    if(c.palette.color1){setVal('i-duo1',c.palette.color1);setVal('i-cus1',c.palette.color1)}
    if(c.palette.color2){setVal('i-duo2',c.palette.color2);setVal('i-cus2',c.palette.color2)}
    if(c.palette.color3)setVal('i-cus3',c.palette.color3);
  }
  if(c.baseTones){
    setChk('i-basetones',c.baseTones.enabled);
    document.getElementById('pc-basetones').classList.toggle('vis',!!c.baseTones.enabled);
    if(c.baseTones.cream)setVal('i-cream',rgbArrToHex(c.baseTones.cream));
    if(c.baseTones.charcoal)setVal('i-charcoal',rgbArrToHex(c.baseTones.charcoal));
  }
  if(c.hover){
    setChk('i-shimmer',c.hover.shimmer);
    if(c.hover.fps)setVal('i-fps',c.hover.fps);
    if(c.hover.intensity)setVal('i-inten',c.hover.intensity);
    setChk('i-reveal',c.hover.hiddenColor);
    if(c.hover.accentMode)setVal('i-amode',c.hover.accentMode);
    if(c.hover.accent1)setVal('i-acc1',c.hover.accent1);
    if(c.hover.accent2)setVal('i-acc2',c.hover.accent2);
    if(c.hover.revealPct)setVal('i-revpct',c.hover.revealPct);
  }
  // refresh all labels and conditional visibility
  document.querySelectorAll('#panel-body input[type=range]').forEach(function(el){el.dispatchEvent(new Event('input'))});
  updPMode();updAMode();
  document.getElementById('modal').classList.remove('open');
  rerenderAll();
}

document.getElementById('mapply').addEventListener('click',function(){applySettings(document.getElementById('mjson').value)});
document.getElementById('mclose').addEventListener('click',function(){document.getElementById('modal').classList.remove('open')});
document.getElementById('modal').addEventListener('click',function(e){if(e.target===this)this.classList.remove('open')});
</script>
</body>
</html>`);
}
app.get('/lab', requireAuth, async (req, res) => { await renderLab(req, res); });

// --- Start ---
const PORT = process.env.PORT || 3000;
initDB().then(async () => {
  app.listen(PORT, () => {
    console.log('in limbo running at http://localhost:' + PORT);
    console.log('admin panel at /user');
    console.log('student submit at /submit');
  });
  try {
    const r = await pool.query('SELECT COUNT(*) AS total, COUNT(thumb_data) AS baked FROM videos WHERE status=$1 OR status IS NULL', ['approved']);
    console.log('Thumbnails: ' + r.rows[0].baked + '/' + r.rows[0].total + ' baked');
  } catch(e) {}
});
