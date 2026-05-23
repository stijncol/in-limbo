const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
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
}

async function getVideoRows() {
  const result = await pool.query('SELECT * FROM videos ORDER BY sort_order ASC, id DESC');
  return result.rows;
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
    return `
    <div class="card" data-featured="${isFeatured}" data-tags="${allTags.join(',')}" data-video-id="${videoId}" data-video-type="${videoType}" data-title="${esc(v.title)}" data-authors="${esc(v.students)}" data-year="${v.year}" data-desc="${esc(v.description)}">
      <div class="thumb"><img alt=""><div class="paper-tint"></div></div>
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

  const themeButtons = [...themeTags].sort().map(t => `<button data-filter="${t}">${t}</button>`).join('\n    ');
  const mediumButtons = [...mediumTags].sort().map(t => `<button data-filter="${t}">${t}</button>`).join('\n    ');

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
  html { scroll-behavior: smooth; }
  body {
    background: #fff;
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
  .filters-medium.visible {
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
  .filters-extra .tag-close:hover { border-color: #111; color: #111; }
  .filters button {
    font-family: inherit;
    font-size: 13px;
    letter-spacing: 0.02em;
    padding: 6px 15px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .filters button:hover { border-color: #111; color: #111; }
  .filters button.active { background: #111; border-color: #111; color: #fff; }
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
  .tag-expand:hover { border-color: #111; color: #111; }
  .filters.show-all .tag-expand { display: none; }
  .search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .search-input {
    font-family: inherit;
    font-size: 15px;
    padding: 0;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #111;
    outline: none;
    width: 0;
    opacity: 0;
    transition: width 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
    overflow: hidden;
  }
  .search-input.open {
    width: 220px;
    opacity: 1;
    padding: 8px 16px;
  }
  .search-input:focus { border-color: #111; }
  .search-toggle {
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
    font-size: 18px;
    font-family: inherit;
  }
  .search-toggle:hover { border-color: #111; color: #111; }
  .search-input {
    font-family: inherit;
    font-size: 15px;
    padding: 8px 16px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #111;
    outline: none;
    width: 0;
    opacity: 0;
    transition: width 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
    padding: 8px 0;
  }
  .search-input.open {
    width: 220px;
    opacity: 1;
    padding: 8px 16px;
  }
  .search-input:focus { border-color: #111; }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-flow: dense;
    column-gap: 25px;
    row-gap: 8px;
  }
  .card {
    opacity: 0;
    transform: translateY(30px);
    animation: fadeUp 0.6s ease forwards;
  }
  .card.hidden { display: none !important; }
  .card[data-featured="false"] { display: none; }
  .grid.show-archive .card[data-featured="false"] { display: block; }
  .card .thumb {
    position: relative;
    aspect-ratio: 16 / 9;
    background: #f0f0f0;
    overflow: hidden;
    cursor: pointer;
  }
  .card .thumb img {
    width: 100%; height: 100%;
    object-fit: cover;
    display: block;
  }
  .card .thumb canvas {
    position: absolute;
    inset: 0;
    width: 100%; height: 100%;
  }
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
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 6px 0 2px;
    gap: 12px;
  }
  .card .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .card .tags span {
    font-size: 11px;
    letter-spacing: 0.03em;
    color: ${cfg.tagColor};
    cursor: pointer;
    transition: color 0.2s ease;
  }
  .card .tags span:hover { color: #111; }
  .card .tags span::before { content: "↳ "; opacity: 0.4; }
  .card .tags span.tag-medium { font-style: italic; }
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
    text-align: right;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .card .card-year {
    font-size: 11px;
    letter-spacing: 0.03em;
    color: #777;
    cursor: pointer;
    transition: color 0.2s ease;
    white-space: nowrap;
  }
  .card .card-year:hover { color: #111; }
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
    color: #111;
    text-decoration: underline;
    font-weight: 400;
  }
  .intro-block .intro-text a.year-filter {
    font-weight: 400;
    text-decoration: underline;
    cursor: pointer;
  }
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
    margin-top: 32px;
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
  .archive-toggle button:hover { border-color: #111; color: #111; }
  .archive-toggle button svg { stroke: currentColor; }
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
</style>
</head>
<body class="${cfg.paperTint ? 'paper-tint-active' : ''}">
<div class="page">
  ${cfg.label ? '<div style="position:fixed;top:10px;right:10px;font-size:11px;color:#aaa;z-index:999;">' + cfg.label + '</div>' : ''}
  <div class="filters" id="filters">
    <div class="filters-left">
      <div class="filters-row" id="filters-row">
        <span class="filters-label">theme</span>
        <div class="theme-tags">
          <button class="active" data-filter="all">all</button>
          ${themeButtons}
          <button class="tag-expand" id="tag-expand" title="show all tags">+</button>
        </div>
      </div>
      <div class="filters-extra" id="filters-extra"><button class="tag-close" id="tag-close" title="close"><span style="display:inline-block;transform:rotate(45deg)">+</span></button></div>
      <div class="filters-row filters-medium">
        <span class="filters-label">medium</span>
        <div class="medium-tags">${mediumButtons}</div>
      </div>
    </div>
    <div class="search-wrap" id="search-wrap">
      <button class="search-toggle" id="search-toggle" title="search">&#x2315;</button>
      <input type="text" id="search-input" class="search-input" placeholder="search title, students...">
    </div>
  </div>
  <div class="grid">
    <div class="intro-block" id="intro-block">
      <div class="intro-text">
        <p>This video archive brings together a series of films produced by architecture students at <a href="https://arch.kuleuven.be/">KU Leuven</a> within the <span class="labo-hover"><a href="https://www.lab-o.club/">lab-O</a><img class="labo-logo-hover" src="/public/logo-labo.png" alt="lab-O"></span> trajectory for the third-year bachelor studio Positioneren 2: Stelling–Strategie. The archive includes works produced from 2021 to the present.</p>
        <p>Each academic year is structured around a different thematic framework, including <a href="#" class="year-filter" data-year="2022">Frame</a>, <a href="#" class="year-filter" data-year="2023">The Gaze</a>, <a href="#" class="year-filter" data-year="2024">Werk</a>, <a href="#" class="year-filter" data-year="2025">Il n'y a pas de hors-architecture</a>, and most recently (2026), <a href="#" class="year-filter" data-year="2026">In Limbo</a>.</p>
      </div>
    </div>
${featuredCards}
${archiveCards}
  </div>
  <div class="archive-toggle" id="archive-toggle" ${archive.length === 0 ? 'style="display:none"' : ''}>
    <button id="archive-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
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
    b7:  { w: 650, threshold: 140, contrast: 1.1, targetLum: 150, combo: [
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
    ]}
  };
  const activeDitherConfig = ditherConfigs[window.__ditherMode || 'default'] || ditherConfigs.default;

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

    function applyColor(out, imageData) {
      const dc = applyCfg.dotColor || null;
      const bc = applyCfg.bgColor || null;
      
      for (let i = 0; i < out.length; i++) {
        const v = out[i] / 255;
        let r, g, b;
        
        if (dc && bc) {
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
          const nw = old > threshold ? 255 : 0;
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
    thumb.appendChild(canvas);

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

  let videoIndex = 0;
  document.querySelectorAll('.card[data-video-id]').forEach(card => {
    const id = card.dataset.videoId;
    const type = card.dataset.videoType;
    const img = card.querySelector('img');
    img.crossOrigin = 'anonymous';
    const myIndex = videoIndex++;

    img.addEventListener('load', () => {
      try { ditherImage(img, card.querySelector('.thumb'), myIndex); } catch(e) {}
    });

    if (type === 'youtube') {
      img.src = 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
    } else {
      fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/'+id+'&width=640')
        .then(r => r.json())
        .then(data => {
          let u = data.thumbnail_url;
          u = u.replace(/_\\d+x\\d+/, '_640');
          img.src = u;
          img.alt = data.title || '';
        })
        .catch(() => { img.src = 'https://vumbnail.com/'+id+'.jpg'; });
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
  const tagClose = document.getElementById('tag-close');
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
    if (!hasOverflow) {
      expandBtn.style.display = 'none';
      tagClose.style.display = 'none';
    }
    // Check if expand button itself overflowed
    if (expandBtn.offsetTop > firstTop) {
      // Move last visible tag to extra to make room for +
      const visibleTags = Array.from(filtersRow.querySelectorAll('button[data-filter]')).filter(b => b.dataset.filter !== 'all');
      if (visibleTags.length > 0) {
        const last = visibleTags[visibleTags.length - 1];
        filtersExtra.insertBefore(last, filtersExtra.firstChild);
      }
    }
  }, 50);

  // Tag expand toggle
  document.getElementById('tag-expand').addEventListener('click', () => {
    if (searchInput.classList.contains('open')) {
      searchInput.classList.remove('open');
      searchInput.value = '';
      if (activeType === 'search') applyFilter('all', 'tag');
    }
    filtersBar.classList.add('show-all');
  });

  // Tag close
  tagClose.addEventListener('click', () => {
    filtersBar.classList.remove('show-all');
  });

  // Search toggle
  const searchToggle = document.getElementById('search-toggle');
  const searchInput = document.getElementById('search-input');
  searchToggle.addEventListener('click', () => {
    const opening = !searchInput.classList.contains('open');
    searchInput.classList.toggle('open');
    if (opening) {
      searchInput.focus();
      filtersBar.classList.remove('show-all');
    } else {
      searchInput.value = '';
      applyFilter('all', 'tag');
    }
  });

  // Search input — only filter when actually typing
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) { applyFilter('all', 'tag'); return; }

    // Clear active tag
    activeFilter = 'search';
    activeType = 'search';
    filtersBar.querySelectorAll('button[data-filter]').forEach(btn => btn.classList.remove('active'));

    // Show archive when searching
    grid.classList.add('show-archive');

    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.videoId) return;
      const title = (card.dataset.title || '').toLowerCase();
      const authors = (card.dataset.authors || '').toLowerCase();
      const tags = (card.dataset.tags || '').toLowerCase();
      const match = title.includes(q) || authors.includes(q) || tags.includes(q);
      card.classList.toggle('hidden', !match);
    });
    if (introBlock) introBlock.style.display = 'none';
  });

  function applyFilter(value, type) {
    activeFilter = value;
    activeType = type || 'tag';
    filtersBar.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });
    filtersExtra.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });
    document.querySelectorAll('.card-year').forEach(y => {
      y.style.color = (activeType === 'year' && y.dataset.year === value) ? '#111' : '';
    });

    // Show/hide intro and logos
    const isFiltered = value !== 'all';
    if (introBlock) introBlock.style.display = isFiltered ? 'none' : '';
    if (logosCard) logosCard.classList.toggle('hidden', isFiltered);
    document.querySelector('.filters-medium').classList.toggle('visible', isFiltered);
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
      // Keep medium tags hidden
      document.querySelector('.filters-medium').classList.remove('visible');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // Archive toggle
  const archiveToggle = document.getElementById('archive-toggle');
  archiveToggle.addEventListener('click', () => {
    const isOpen = grid.classList.toggle('show-archive');
    userArchiveOpen = isOpen;
    archiveToggle.classList.toggle('is-open', isOpen);
    const btn = document.getElementById('archive-btn');
    if (isOpen) {
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
      setTimeout(trimTags, 50);
    } else {
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }
  });
</script>
</body>
</html>`);
}

// Default: current style
// Old default (tinted whites)
app.get('/old', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'old — tinted whites', font: "'IBM Plex Sans'", introSize: '22px' });
});

app.get('/paper', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: 'paper — newspaper tint', font: "'IBM Plex Sans'", introSize: '22px', ditherMode: 'b7', paperTint: true });
});

// Default: c7 style
app.get('/', async (req, res) => {
  await renderPublic(req, res, { bodyWeight: 300, titleWeight: 400, tagWeight: 300, filterWeight: 300, introWeight: 300, tagColor: '#777', label: '', font: "'IBM Plex Sans'", introSize: '22px', ditherMode: 'b7' });
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

// --- Start ---
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('in limbo running at http://localhost:' + PORT);
    console.log('admin panel at /user');
    console.log('student submit at /submit');
  });
});
