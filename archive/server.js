const express = require('express');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'videos.db');
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'limbo2026';

let db;

// --- Init DB ---
async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    students TEXT NOT NULL,
    description TEXT NOT NULL,
    vimeo_id TEXT NOT NULL,
    year INTEGER NOT NULL,
    tags TEXT DEFAULT '',
    featured INTEGER DEFAULT 1,
    archived INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function getVideos() {
  return db.exec(`SELECT * FROM videos ORDER BY sort_order ASC, id DESC`);
}

function getVideoRows() {
  const result = getVideos();
  if (!result.length) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
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

// --- API ---
app.get('/api/videos', (req, res) => {
  res.json(getVideoRows());
});

app.post('/api/videos', requireAuth, (req, res) => {
  const { title, students, description, vimeo_link, year, tags, featured, archived, sort_order } = req.body;
  // Extract vimeo ID from link
  const vimeoMatch = (vimeo_link || '').match(/vimeo\.com\/(\d+)/);
  const vimeo_id = vimeoMatch ? vimeoMatch[1] : vimeo_link;

  db.run(`INSERT INTO videos (title, students, description, vimeo_id, year, tags, featured, archived, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [title, students, description, vimeo_id, parseInt(year), tags || '', featured ? 1 : 0, archived ? 1 : 0, parseInt(sort_order) || 0]);
  saveDB();
  res.json({ ok: true });
});

app.put('/api/videos/:id', requireAuth, (req, res) => {
  const { title, students, description, vimeo_link, year, tags, featured, archived, sort_order } = req.body;
  const vimeoMatch = (vimeo_link || '').match(/vimeo\.com\/(\d+)/);
  const vimeo_id = vimeoMatch ? vimeoMatch[1] : vimeo_link;

  db.run(`UPDATE videos SET title=?, students=?, description=?, vimeo_id=?, year=?, tags=?, featured=?, archived=?, sort_order=? WHERE id=?`,
    [title, students, description, vimeo_id, parseInt(year), tags || '', featured ? 1 : 0, archived ? 1 : 0, parseInt(sort_order) || 0, req.params.id]);
  saveDB();
  res.json({ ok: true });
});

app.delete('/api/videos/:id', requireAuth, (req, res) => {
  db.run(`DELETE FROM videos WHERE id=?`, [req.params.id]);
  saveDB();
  res.json({ ok: true });
});

// --- Public frontend ---
app.get('/', (req, res) => {
  const videos = getVideoRows();
  const featured = videos.filter(v => v.featured && !v.archived);
  const archive = videos.filter(v => v.archived || !v.featured);

  // Collect all tags
  const allTags = new Set();
  videos.forEach(v => (v.tags || '').split(',').filter(Boolean).forEach(t => allTags.add(t.trim())));

  function renderCard(v, isFeatured) {
    const tags = (v.tags || '').split(',').filter(Boolean).map(t => t.trim());
    const tagSpans = tags.map(t => `<span data-tag="${t}">${t}</span>`).join('\n            ');
    return `
    <div class="card" data-featured="${isFeatured}" data-tags="${tags.join(',')}" data-vimeo="${v.vimeo_id}" data-title="${esc(v.title)}" data-authors="${esc(v.students)}" data-year="${v.year}" data-desc="${esc(v.description)}">
      <div class="thumb"><img alt=""></div>
      <div class="meta">
        <div class="tags">
            ${tagSpans}
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

  const tagButtons = [...allTags].sort().map(t => `<button data-filter="${t}">${t}</button>`).join('\n    ');

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
    padding: 48px 40px 120px;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 32px;
  }
  .filters button {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 12px;
    letter-spacing: 0.04em;
    padding: 6px 14px;
    border: 1px solid #ccc;
    border-radius: 100px;
    background: #fff;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .filters button:hover { border-color: #111; color: #111; }
  .filters button.active { background: #111; border-color: #111; color: #fff; }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
  }
  .card {
    opacity: 0;
    transform: translateY(30px);
    animation: fadeUp 0.6s ease forwards;
  }
  .card.hidden { display: none; }
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
    transition: transform 0.4s ease;
  }
  .card .thumb:hover img { transform: scale(1.03); }
  .card .thumb::after {
    content: "▶";
    position: absolute;
    bottom: 12px; right: 14px;
    font-size: 11px;
    color: #fff;
    opacity: 0;
    transition: opacity 0.3s ease;
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
  }
  .card .thumb:hover::after { opacity: 0.7; }
  .card .meta {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px 0 0;
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
    color: #999;
    cursor: pointer;
    transition: color 0.2s ease;
  }
  .card .tags span:hover { color: #111; }
  .card .tags span::before { content: "↳ "; opacity: 0.4; }
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
    text-align: right;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .card .card-year {
    font-size: 11px;
    letter-spacing: 0.03em;
    color: #999;
    cursor: pointer;
    transition: color 0.2s ease;
    white-space: nowrap;
  }
  .card .card-year:hover { color: #111; }
  .intro-block {
    grid-row: 1 / 3;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding: 0 4px 0 0;
  }
  .intro-block .intro-text {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    color: #111;
  }
  .intro-block .intro-text p {
    margin-bottom: 16px;
  }
  .intro-block .intro-text a {
    color: #111;
    text-decoration: underline;
    font-weight: 700;
  }
  .intro-block .intro-text strong {
    font-weight: 700;
  }
  .intro-block .intro-logos {
    display: flex;
    gap: 20px;
    align-items: center;
    margin-top: 12px;
  }
  .intro-block .intro-logos img {
    height: 60px;
    width: auto;
  }
  .archive-toggle {
    display: flex;
    justify-content: center;
    margin-top: 48px;
  }
  .archive-toggle button {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    letter-spacing: 0.03em;
    padding: 12px 28px;
    border: 1px solid #ccc;
    border-radius: 0;
    background: #fff;
    color: #555;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .archive-toggle button:hover { border-color: #111; color: #111; }
  .archive-toggle.is-open button { background: #111; border-color: #111; color: #fff; }
  .lightbox {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0,0,0,0.88);
    align-items: center;
    justify-content: center;
    padding: 40px;
  }
  .lightbox.open { display: flex; }
  .lightbox .lb-inner {
    position: relative;
    display: flex;
    width: 100%;
    max-width: 1200px;
    gap: 0;
  }
  .lightbox .lb-video { flex: 0 0 66.666%; aspect-ratio: 16/9; }
  .lightbox iframe { width: 100%; height: 100%; border: none; display: block; }
  .lightbox .lb-info {
    flex: 0 0 33.333%;
    background: #fff;
    padding: 36px 32px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .lightbox .lb-info h2 {
    font-family: Helvetica, Arial, sans-serif;
    font-weight: 700;
    font-size: 18px;
    line-height: 1.25;
    color: #111;
    margin-bottom: 6px;
  }
  .lightbox .lb-info .lb-authors {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #888;
    margin-bottom: 4px;
  }
  .lightbox .lb-info .lb-year {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    color: #888;
    margin-bottom: 18px;
  }
  .lightbox .lb-info p {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.6;
    color: #555;
  }
  .lightbox .lb-close {
    position: absolute;
    top: -36px; right: 0;
    font-size: 14px;
    color: #aaa;
    cursor: pointer;
    font-family: Helvetica, Arial, sans-serif;
    letter-spacing: 0.05em;
    transition: color 0.2s;
  }
  .lightbox .lb-close:hover { color: #fff; }
  @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 900px) {
    .page { padding: 32px 20px 80px; }
    .grid { grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .intro-block { grid-row: auto; grid-column: 1 / -1; margin-bottom: 16px; }
  }
  @media (max-width: 768px) {
    .lightbox .lb-inner { flex-direction: column; max-height: 90vh; overflow-y: auto; }
    .lightbox .lb-video { flex: none; width: 100%; }
    .lightbox .lb-info { flex: none; width: 100%; padding: 24px 20px; }
  }
  @media (max-width: 540px) {
    .page { padding: 24px 16px 60px; }
    .grid { grid-template-columns: 1fr; gap: 12px; }
    .lightbox { padding: 20px; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="filters">
    <button class="active" data-filter="all">all</button>
    ${tagButtons}
  </div>
  <div class="grid">
    <div class="intro-block">
      <div class="intro-text">
        <p>This video archive brings together a series of films produced by architecture students at <a href="https://arch.kuleuven.be/">KU Leuven</a> within the <a href="https://www.lab-o.club/">lab-O</a> trajectory and the studio <strong>Positioneren 2</strong>: Stelling–Strategie. The archive includes works produced from 2021 to the present.</p>
        <p>Each academic year is structured around a different thematic framework, including Frame, Il n'y a pas de hors-architecture, The Gaze, and most recently (2026), <strong>In Limbo</strong>.</p>
        <p>Through these themes, students explore sites, buildings, and spatial conditions caught in states of transition — suspended between past and future, use and abandonment, construction and decay. Equipped with cameras, they document these unstable conditions through video, later introducing fictional narratives into the locations themselves.</p>
      </div>
      <div class="intro-logos">
        <img src="/public/logo-labo.png" alt="lab-O">
        <img src="/public/logo-kuleuven.png" alt="KU Leuven">
      </div>
    </div>
${featuredCards}
${archiveCards}
  </div>
  <div class="archive-toggle" id="archive-toggle" ${archive.length === 0 ? 'style="display:none"' : ''}>
    <button>ontdek het volledige video-archief</button>
  </div>
</div>

<div class="lightbox" id="lightbox">
  <div class="lb-inner">
    <div class="lb-close">close ✕</div>
    <div class="lb-video">
      <iframe id="lb-iframe" src="" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>
    </div>
    <div class="lb-info">
      <h2 id="lb-title"></h2>
      <div class="lb-authors" id="lb-authors"></div>
      <div class="lb-year" id="lb-year"></div>
      <p id="lb-desc"></p>
    </div>
  </div>
</div>

<script>
  // Thumbnails
  document.querySelectorAll('.card[data-vimeo]').forEach(card => {
    const id = card.dataset.vimeo;
    const img = card.querySelector('img');
    fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/'+id+'&width=640')
      .then(r => r.json())
      .then(data => {
        let u = data.thumbnail_url;
        u = u.replace(/_\\d+x\\d+/, '_640');
        img.src = u;
        img.alt = data.title || '';
      })
      .catch(() => { img.src = 'https://vumbnail.com/'+id+'.jpg'; });
  });

  // Lightbox
  const lightbox = document.getElementById('lightbox');
  const lbIframe = document.getElementById('lb-iframe');
  const lbTitle = document.getElementById('lb-title');
  const lbAuthors = document.getElementById('lb-authors');
  const lbYear = document.getElementById('lb-year');
  const lbDesc = document.getElementById('lb-desc');

  document.querySelector('.grid').addEventListener('click', e => {
    const card = e.target.closest('.card[data-vimeo]');
    if (card && e.target.closest('.thumb')) {
      lbIframe.src = 'https://player.vimeo.com/video/'+card.dataset.vimeo+'?autoplay=1&title=0&byline=0&portrait=0';
      lbTitle.textContent = card.dataset.title || '';
      lbAuthors.textContent = card.dataset.authors || '';
      lbYear.textContent = card.dataset.year || '';
      lbDesc.textContent = card.dataset.desc || '';
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  });

  function closeLightbox() {
    lightbox.classList.remove('open');
    lbIframe.src = '';
    document.body.style.overflow = '';
  }
  lightbox.addEventListener('click', e => {
    if (e.target === lightbox || e.target.closest('.lb-close')) closeLightbox();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  // Filters
  const grid = document.querySelector('.grid');
  const filtersBar = document.querySelector('.filters');
  let activeFilter = 'all';
  let activeType = 'tag';

  function applyFilter(value, type) {
    activeFilter = value;
    activeType = type || 'tag';
    filtersBar.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === value);
    });
    document.querySelectorAll('.card-year').forEach(y => {
      y.style.color = (activeType === 'year' && y.dataset.year === value) ? '#111' : '';
    });
    const archiveOpen = grid.classList.contains('show-archive');
    document.querySelectorAll('.card').forEach(card => {
      if (card.classList.contains('card--title')) return;
      const isArchive = card.dataset.featured === 'false';
      if (value === 'all') {
        card.classList.toggle('hidden', isArchive && !archiveOpen);
      } else if (type === 'year') {
        card.classList.toggle('hidden', card.dataset.year !== value || (isArchive && !archiveOpen));
      } else {
        const tags = card.dataset.tags;
        card.classList.toggle('hidden', !tags.split(',').includes(value) || (isArchive && !archiveOpen));
      }
    });
  }

  filtersBar.addEventListener('click', e => {
    if (e.target.tagName === 'BUTTON') applyFilter(e.target.dataset.filter, 'tag');
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

  // Archive toggle
  const archiveToggle = document.getElementById('archive-toggle');
  archiveToggle.addEventListener('click', () => {
    const isOpen = grid.classList.toggle('show-archive');
    archiveToggle.classList.toggle('is-open', isOpen);
    archiveToggle.querySelector('button').textContent = isOpen ? 'toon enkel selectie' : 'ontdek het volledige video-archief';
  });
</script>
</body>
</html>`);
});

// --- Admin panel ---
app.get('/user', requireAuth, (req, res) => {
  const videos = getVideoRows();

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
    font-family: Helvetica, Arial, sans-serif;
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
    font-family: Helvetica, Arial, sans-serif;
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
    font-family: Helvetica, Arial, sans-serif;
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

      <label>vimeo link</label>
      <input type="text" name="vimeo_link" placeholder="https://vimeo.com/123456789" required>

      <label>beschrijving (150 woorden)</label>
      <textarea name="description" maxlength="1500" required></textarea>

      <label>tags (kommagescheiden)</label>
      <input type="text" name="tags" placeholder="decay, textures, ecology">

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
    <h2 style="font-size:16px;font-weight:600;margin-bottom:16px;">alle video's (${videos.length})</h2>
    ${videos.map(v => `
    <div class="video-item" data-id="${v.id}" data-title="${esc(v.title)}" data-students="${esc(v.students)}" data-year="${v.year}" data-vimeo="${v.vimeo_id}" data-desc="${esc(v.description)}" data-tags="${esc(v.tags||'')}" data-sort="${v.sort_order}" data-featured="${v.featured}" data-archived="${v.archived}">
      <div class="info">
        <h3>${esc(v.title)}</h3>
        <div class="meta">
          <span>${esc(v.students)}</span>
          <span>${v.year}</span>
          <span>vimeo/${v.vimeo_id}</span>
          <span>sort: ${v.sort_order}</span>
        </div>
        <div class="badges">
          ${v.featured ? '<span class="badge featured">highlight</span>' : ''}
          ${v.archived ? '<span class="badge archived">archief</span>' : ''}
          ${(v.tags||'').split(',').filter(Boolean).map(t => '<span class="badge">'+t.trim()+'</span>').join('')}
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

        <label>vimeo link</label>
        <input type="text" name="vimeo_link" id="edit-vimeo" required>

        <label>beschrijving (150 woorden)</label>
        <textarea name="description" id="edit-desc" maxlength="1500" required></textarea>

        <label>tags (kommagescheiden)</label>
        <input type="text" name="tags" id="edit-tags">

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
      vimeo_link: fd.get('vimeo_link'),
      description: fd.get('description'),
      tags: fd.get('tags'),
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

  function editVideo(id) {
    const item = document.querySelector('.video-item[data-id="'+id+'"]');
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-title').value = item.dataset.title;
    document.getElementById('edit-students').value = item.dataset.students;
    document.getElementById('edit-year').value = item.dataset.year;
    document.getElementById('edit-vimeo').value = 'https://vimeo.com/' + item.dataset.vimeo;
    document.getElementById('edit-desc').value = item.dataset.desc;
    document.getElementById('edit-tags').value = item.dataset.tags;
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
      vimeo_link: fd.get('vimeo_link'),
      description: fd.get('description'),
      tags: fd.get('tags'),
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
initDB().then(() => {
  app.listen(3000, () => {
    console.log('in limbo running at http://localhost:3000');
    console.log('admin panel at http://localhost:3000/user');
    console.log('credentials: admin / limbo2026');
  });
});
