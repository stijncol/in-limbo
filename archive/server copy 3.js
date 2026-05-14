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
    flex-direction: column;
    gap: 10px;
    margin-bottom: 48px;
  }
  .filters-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .filters-extra {
    display: none;
    flex-wrap: wrap;
    gap: 10px;
  }
  .filters.show-all .filters-extra { display: flex; }
  .filters button {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 15px;
    letter-spacing: 0.02em;
    padding: 8px 18px;
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
    font-family: Helvetica, Arial, sans-serif;
    font-size: 18px;
    width: 38px;
    height: 38px;
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
  .filters.show-all .tag-expand { transform: rotate(45deg); }
  .search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .search-toggle {
    width: 46px;
    height: 46px;
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
  .search-toggle:hover { border-color: #111; color: #111; }
  .search-input {
    font-family: Helvetica, Arial, sans-serif;
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
    transition: transform 0.4s ease, opacity 0.4s ease;
  }
  .card .thumb canvas {
    position: absolute;
    inset: 0;
    width: 100%; height: 100%;
    transition: opacity 0.4s ease;
  }
  .card .thumb:hover canvas {
    opacity: 0;
  }
  .card .thumb:hover img {
    transform: scale(1.03);
  }
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
    font-family: Helvetica, Arial, sans-serif;
    font-size: 22px;
    line-height: 1.55;
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
    margin-top: 48px;
  }
  .archive-toggle button {
    font-family: Helvetica, Arial, sans-serif;
    font-size: 13px;
    letter-spacing: 0.03em;
    padding: 12px 28px;
    border: 1px solid #ccc;
    border-radius: 0;
    background: transparent;
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
    .intro-block { grid-column: 1 / -1; grid-row: auto; }
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
  <div class="filters" id="filters">
    <div class="filters-row" id="filters-row">
      <button class="active" data-filter="all">all</button>
      ${tagButtons}
      <button class="tag-expand" id="tag-expand" title="show all tags">+</button>
      <div class="search-wrap" id="search-wrap">
        <button class="search-toggle" id="search-toggle" title="search"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="7"/><line x1="16" y1="16" x2="21" y2="21"/></svg></button>
        <input type="text" id="search-input" class="search-input" placeholder="search title, students...">
      </div>
    </div>
    <div class="filters-extra" id="filters-extra"></div>
  </div>
  <div class="grid">
    <div class="intro-block" id="intro-block">
      <div class="intro-text">
        <p>This video archive brings together a series of films produced by architecture students at <a href="https://arch.kuleuven.be/"><strong>KU Leuven</strong></a> within the <span class="labo-hover"><a href="https://www.lab-o.club/"><strong>lab-O</strong></a><img class="labo-logo-hover" src="/public/logo-labo.png" alt="lab-O"></span> trajectory and the studio Positioneren 2: Stelling-Strategie. The archive includes works produced from 2021 to the present.</p>
        <p>Each academic year is structured around a different thematic framework, including Frame, Il n'y a pas de hors-architecture, The Gaze, and most recently (2026), In Limbo.</p>
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

    // Map hue to palette (pastel RGBCMY):
    const palette = [
      { color: [235, 150, 150], hue: 0 },     // pastel red
      { color: [150, 215, 150], hue: 120 },    // pastel green
      { color: [150, 170, 235], hue: 225 },    // pastel blue
      { color: [150, 225, 225], hue: 180 },    // pastel cyan
      { color: [215, 150, 215], hue: 300 },    // pastel magenta
      { color: [235, 225, 150], hue: 50 },     // pastel yellow
    ];

    let best = palette[0].color, bestDist = Infinity;
    for (const p of palette) {
      let dist = Math.abs(domHue - p.hue);
      if (dist > 180) dist = 360 - dist; // wrap around
      if (dist < bestDist) { bestDist = dist; best = p.color; }
    }
    return best;
  }

  function ditherImage(img, thumb) {
    const canvas = document.createElement('canvas');
    const w = 280;
    const h = Math.round(w * (9/16));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // Get dominant color before converting
    const [cr, cg, cb] = getDominantColor(ctx, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    // Convert to grayscale
    for (let i = 0; i < d.length; i += 4) {
      const gray = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
      d[i] = gray; d[i+1] = gray; d[i+2] = gray;
    }

    // Floyd-Steinberg dither
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const old = d[i];
        const nw = old > 120 ? 255 : 0;
        d[i] = nw; d[i+1] = nw; d[i+2] = nw;
        const err = old - nw;
        if (x + 1 < w) d[(y*w+x+1)*4] += err * 7/16;
        if (y + 1 < h && x > 0) d[((y+1)*w+x-1)*4] += err * 3/16;
        if (y + 1 < h) d[((y+1)*w+x)*4] += err * 5/16;
        if (y + 1 < h && x + 1 < w) d[((y+1)*w+x+1)*4] += err * 1/16;
      }
    }

    // Apply dominant color: black stays black, white becomes the tint color
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] / 255; // 0 = black, 1 = white
      d[i]   = Math.round(v * cr);         // R
      d[i+1] = Math.round(v * cg);         // G
      d[i+2] = Math.round(v * cb);         // B
    }

    ctx.putImageData(imageData, 0, 0);
    canvas.style.imageRendering = 'pixelated';
    thumb.appendChild(canvas);
  }

  document.querySelectorAll('.card[data-vimeo]').forEach(card => {
    const id = card.dataset.vimeo;
    const img = card.querySelector('img');
    img.crossOrigin = 'anonymous';

    img.addEventListener('load', () => {
      try { ditherImage(img, card.querySelector('.thumb')); } catch(e) {}
    });

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
  const introBlock = document.getElementById('intro-block');
  const logosCard = null;
  let activeFilter = 'all';
  let activeType = 'tag';

  // Limit visible tags to 8, move rest to extra row
  const MAX_VISIBLE_TAGS = 8;
  const filtersRow = document.getElementById('filters-row');
  const filtersExtra = document.getElementById('filters-extra');
  const tagBtns = filtersRow.querySelectorAll('button[data-filter]');
  let count = 0;
  tagBtns.forEach(btn => {
    if (btn.dataset.filter === 'all') return;
    count++;
    if (count > MAX_VISIBLE_TAGS) {
      filtersExtra.appendChild(btn);
    }
  });
  // Hide + button if no extra tags
  if (count <= MAX_VISIBLE_TAGS) document.getElementById('tag-expand').style.display = 'none';

  // Tag expand toggle — just show/hide extra row, don't filter
  document.getElementById('tag-expand').addEventListener('click', () => {
    // Close search if open
    if (searchInput.classList.contains('open')) {
      searchInput.classList.remove('open');
      searchInput.value = '';
      if (activeType === 'search') applyFilter('all', 'tag');
    }
    filtersBar.classList.toggle('show-all');
  });

  // Search toggle
  const searchToggle = document.getElementById('search-toggle');
  const searchInput = document.getElementById('search-input');
  searchToggle.addEventListener('click', () => {
    const opening = !searchInput.classList.contains('open');
    searchInput.classList.toggle('open');
    if (opening) {
      searchInput.focus();
      // Collapse expanded tags
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

    const archiveOpen = grid.classList.contains('show-archive');
    document.querySelectorAll('.card').forEach(card => {
      if (!card.dataset.vimeo) return;
      const isArchive = card.dataset.featured === 'false';
      const title = (card.dataset.title || '').toLowerCase();
      const authors = (card.dataset.authors || '').toLowerCase();
      const tags = (card.dataset.tags || '').toLowerCase();
      const match = title.includes(q) || authors.includes(q) || tags.includes(q);
      card.classList.toggle('hidden', !match || (isArchive && !archiveOpen));
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

    const archiveOpen = grid.classList.contains('show-archive');
    document.querySelectorAll('.card').forEach(card => {
      if (card.classList.contains('card-logos')) return;
      if (!card.dataset.vimeo && !card.classList.contains('intro-block')) return;
      if (!card.dataset.vimeo) return;
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
