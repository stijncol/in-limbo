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

  try { await pool.query("ALTER TABLE videos ADD COLUMN tags_theme TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN tags_medium TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN video_type TEXT DEFAULT 'vimeo'"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN video_id TEXT"); } catch(e) {}
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
app.get('/', async (req, res) => {
  const allVideos = (await getVideoRows()).filter(v => v.status === 'approved' || !v.status);
  const featured = allVideos.filter(v => v.featured && !v.archived);
  const archive = allVideos.filter(v => v.archived || !v.featured);

  const themeTags = new Set();
  const mediumTags = new Set();
  allVideos.forEach(v => {
    (v.tags_theme || v.tags || '').split(',').filter(Boolean).forEach(t => themeTags.add(t.trim()));
    (v.tags_medium || '').split(',').filter(Boolean).forEach(t => mediumTags.add(t.trim()));
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
      <div class="thumb"><img alt=""></div>
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
<style>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    background: #fff;
    font-family: Helvetica, Arial, sans-serif;
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
    position: relative;
  }
  .filters-left {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
    min-width: 0;
  }
  .filters-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .filters-label {
    font-family: Helvetica, Arial, sans-serif;
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
    display: flex;
  }
  .filters-medium button { border-style: dashed; }
  .filters-extra {
    display: none;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 52px;
    margin-top: 6px;
  }
  .filters.show-all .filters-extra { display: flex; }
  .tag-close {
    width: 32px; height: 32px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #555; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .filters button {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    padding: 6px 15px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .filters button.active { background: #111; border-color: #111; color: #fff; }
  .tag-expand {
    width: 32px; height: 32px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .filters.show-all .tag-expand { display: none; }
  
  .search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .search-input {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 15px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #111;
    outline: none;
    width: 0;
    opacity: 0;
    padding: 8px 0;
    transition: width 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
    pointer-events: none;
  }
  .search-input.open {
    width: 220px;
    opacity: 1;
    padding: 8px 16px;
    pointer-events: auto;
  }
  .search-toggle {
    width: 46px; height: 46px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: transparent;
    color: #555; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    column-gap: 25px;
    row-gap: 8px;
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
  .card .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card .meta { display: flex; justify-content: space-between; align-items: flex-start; padding: 6px 0 2px; gap: 12px; }
  .card .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .card .tags span { font-size: 11px; color: #999; cursor: pointer; }
  .card .tags span::before { content: "↳ "; opacity: 0.4; }
  .card .card-right { display: flex; align-items: baseline; gap: 10px; flex-shrink: 0; }
  .card .card-title { font-size: 11px; color: #111; text-align: right; white-space: nowrap; }
  .card .card-year { font-size: 11px; color: #999; cursor: pointer; }
  
  .intro-block { grid-column: 1; grid-row: 1 / 3; padding-right: 20px; }
  .intro-text { font-size: 22px; line-height: 1.55; color: #111; }
  .labo-hover { position: relative; display: inline; }
  .labo-logo-hover {
    position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
    height: 80px; opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
  }
  .labo-hover:hover .labo-logo-hover { opacity: 1; }

  .archive-toggle { display: flex; justify-content: center; margin-top: 32px; }
  .archive-toggle button {
    width: 46px; height: 46px; border: 1px solid #ccc; border-radius: 50%;
    background: transparent; color: #555; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }

  .lightbox {
    display: none; position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.92); align-items: center; justify-content: center;
  }
  .lightbox.open { display: flex; }
  .lightbox .lb-inner { position: relative; width: 100%; max-width: 960px; padding: 0 40px; }
  .lightbox .lb-video { width: 100%; aspect-ratio: 16/9; }
  .lightbox .lb-close { position: absolute; top: -40px; left: 40px; color: rgba(255,255,255,0.4); cursor: pointer; }
  
  @media (max-width: 900px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
    .intro-block { grid-column: 1 / -1; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="filters" id="filters">
    <div class="filters-left">
        <div class="filters-row" id="filters-row">
          <span class="filters-label">theme</span>
          <button class="active" data-filter="all">all</button>
          ${themeButtons}
          <button class="tag-expand" id="tag-expand">+</button>
        </div>
        <div class="filters-extra" id="filters-extra"><button class="tag-close" id="tag-close">✕</button></div>
        <div class="filters-row filters-medium">
          <span class="filters-label">medium</span>
          ${mediumButtons}
        </div>
    </div>

    <div class="search-wrap" id="search-wrap">
      <input type="text" id="search-input" class="search-input" placeholder="search...">
      <button class="search-toggle" id="search-toggle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="10.5" cy="10.5" r="7"/><line x1="16" y1="16" x2="21" y2="21"/></svg>
      </button>
    </div>
  </div>

  <div class="grid">
    <div class="intro-block" id="intro-block">
      <div class="intro-text">
        <p>This video archive brings together films by architecture students at <a href="https://arch.kuleuven.be/"><strong>KU Leuven</strong></a> within the <span class="labo-hover"><a href="https://www.lab-o.club/"><strong>lab-O</strong></a><img class="labo-logo-hover" src="/public/logo-labo.png"></span> trajectory.</p>
      </div>
    </div>
    ${featuredCards}
    ${archiveCards}
  </div>

  <div class="archive-toggle" id="archive-toggle">
    <button id="archive-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
  </div>
</div>

<div class="lightbox" id="lightbox">
  <div class="lb-inner">
    <div class="lb-close">close ✕</div>
    <div class="lb-video"><iframe id="lb-iframe" allowfullscreen></iframe></div>
  </div>
</div>

<script>
  const grid = document.querySelector('.grid');
  const filtersBar = document.getElementById('filters');
  const introBlock = document.getElementById('intro-block');
  const searchInput = document.getElementById('search-input');
  let activeFilter = 'all';
  let activeType = 'tag';

  function applyFilter(value, type) {
    activeFilter = value;
    activeType = type || 'tag';
    
    document.querySelectorAll('button[data-filter]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });

    const isFiltered = value !== 'all';
    const archiveOpen = grid.classList.contains('show-archive');

    if (introBlock) {
      introBlock.style.display = (isFiltered || (archiveOpen && value === 'all')) ? 'none' : '';
    }

    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.videoId) return;
      const isArchive = card.dataset.featured === 'false';
      const tags = card.dataset.tags || '';
      const year = card.dataset.year;

      let matchesFilter = (value === 'all') ? true : 
                          (type === 'year') ? (year === value) : 
                          tags.split(',').includes(value);

      const shouldShow = matchesFilter && (!isArchive || archiveOpen);
      card.classList.toggle('hidden', !shouldShow);
    });

    document.querySelector('.filters-medium').classList.toggle('visible', isFiltered);
  }

  // UI Event Listeners
  document.getElementById('search-toggle').addEventListener('click', () => {
    const isOpening = !searchInput.classList.contains('open');
    searchInput.classList.toggle('open');
    if (isOpening) searchInput.focus();
    else if (searchInput.value !== '') { searchInput.value = ''; applyFilter('all', 'tag'); }
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) { applyFilter('all', 'tag'); return; }
    grid.classList.add('show-archive');
    document.querySelectorAll('.card').forEach(card => {
      const match = card.innerText.toLowerCase().includes(q);
      card.classList.toggle('hidden', !match);
    });
  });

  document.getElementById('archive-toggle').addEventListener('click', () => {
    const isOpen = grid.classList.toggle('show-archive');
    document.getElementById('archive-btn').innerHTML = isOpen ? 
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>' :
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    applyFilter(activeFilter, activeType);
  });

  filtersBar.addEventListener('click', e => {
    if (e.target.dataset.filter) applyFilter(e.target.dataset.filter, 'tag');
  });

  document.getElementById('tag-expand').addEventListener('click', () => filtersBar.classList.add('show-all'));
  document.getElementById('tag-close').addEventListener('click', () => filtersBar.classList.remove('show-all'));
</script>
</body>
</html>`);
});

// Admin panel routes (niet gewijzigd)...
app.get('/user', requireAuth, async (req, res) => { /* ... */ });
app.get('/submit', requireStudent, (req, res) => { /* ... */ });

const PORT = process.env.PORT || 3000;
initDB().then(() => app.listen(PORT));