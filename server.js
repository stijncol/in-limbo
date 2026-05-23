const express = require('express');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// ==================== CONFIGURATION ====================
const config = {
  databaseUrl: process.env.DATABASE_URL,
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPass: process.env.ADMIN_PASS,
  studentUser: process.env.STUDENT_USER || 'student',
  studentPass: process.env.STUDENT_PASS,
  port: process.env.PORT || 3000,
  isProduction: process.env.NODE_ENV === 'production',
};

// Validate required env vars
if (!config.databaseUrl) throw new Error('DATABASE_URL required');
if (!config.adminPass) throw new Error('ADMIN_PASS required');
if (!config.studentPass) throw new Error('STUDENT_PASS required');

// ==================== DATABASE ====================
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.isProduction ? { rejectUnauthorized: false } : false,
});

// Database schema
const SCHEMA = {
  videos: `
    CREATE TABLE IF NOT EXISTS videos (
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
    )
  `,
};

async function initDB() {
  await pool.query(SCHEMA.videos);
  
  // Idempotent migrations
  const columns = ['tags_theme', 'tags_medium', 'video_type', 'video_id'];
  for (const col of columns) {
    try {
      await pool.query(`ALTER TABLE videos ADD COLUMN ${col} TEXT DEFAULT ''`);
    } catch (e) { /* column exists */ }
  }
  
  // Data migrations
  await pool.query(`
    UPDATE videos SET video_id = vimeo_id WHERE video_id IS NULL AND vimeo_id IS NOT NULL
  `);
  await pool.query(`
    UPDATE videos SET tags_theme = tags WHERE tags_theme = '' AND tags != ''
  `);
}

// ==================== HELPERS ====================
function parseVideoUrl(url) {
  if (!url) return { id: null, type: 'vimeo' };
  
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return { id: vimeoMatch[1], type: 'vimeo' };
  
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return { id: ytMatch[1], type: 'youtube' };
  
  return { id: url, type: 'vimeo' };
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==================== AUTH MIDDLEWARE ====================
function createBasicAuthMiddleware(expectedUser, expectedPass, realm) {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    
    if (!auth || !auth.startsWith('Basic ')) {
      res.set('WWW-Authenticate', `Basic realm="${realm}"`);
      return res.status(401).send('Authentication required');
    }
    
    const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = decoded.split(':');
    
    if (user === expectedUser && pass === expectedPass) {
      return next();
    }
    
    res.set('WWW-Authenticate', `Basic realm="${realm}"`);
    res.status(401).send('Invalid credentials');
  };
}

const requireAdmin = createBasicAuthMiddleware(config.adminUser, config.adminPass, 'in limbo admin');
const requireStudent = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="in limbo submit"');
    return res.status(401).send('Authentication required');
  }
  
  const decoded = Buffer.from(auth.split(' ')[1], 'base64').toString();
  const [user, pass] = decoded.split(':');
  
  if ((user === config.studentUser && pass === config.studentPass) ||
      (user === config.adminUser && pass === config.adminPass)) {
    return next();
  }
  
  res.set('WWW-Authenticate', 'Basic realm="in limbo submit"');
  res.status(401).send('Invalid credentials');
};

// ==================== CRUD OPERATIONS ====================
const VideoModel = {
  async findAll() {
    const result = await pool.query('SELECT * FROM videos ORDER BY sort_order ASC, id DESC');
    return result.rows;
  },
  
  async findPublic() {
    const result = await pool.query(
      `SELECT * FROM videos 
       WHERE status = 'approved' OR status IS NULL 
       ORDER BY sort_order ASC, id DESC`
    );
    return result.rows;
  },
  
  async create(data) {
    const { id, type } = parseVideoUrl(data.video_link);
    const result = await pool.query(
      `INSERT INTO videos 
       (title, students, description, video_id, video_type, year, tags_theme, tags_medium, featured, archived, sort_order, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
       RETURNING *`,
      [
        data.title, data.students, data.description, id, type, parseInt(data.year),
        data.tags_theme || '', data.tags_medium || '',
        data.featured ? 1 : 0, data.archived ? 1 : 0,
        parseInt(data.sort_order) || 0,
        data.status || 'approved'
      ]
    );
    return result.rows[0];
  },
  
  async update(id, data) {
    const { id: videoId, type } = parseVideoUrl(data.video_link);
    const result = await pool.query(
      `UPDATE videos SET 
        title=$1, students=$2, description=$3, video_id=$4, video_type=$5, 
        year=$6, tags_theme=$7, tags_medium=$8, featured=$9, archived=$10, sort_order=$11 
       WHERE id=$12 RETURNING *`,
      [
        data.title, data.students, data.description, videoId, type, parseInt(data.year),
        data.tags_theme || '', data.tags_medium || '',
        data.featured ? 1 : 0, data.archived ? 1 : 0,
        parseInt(data.sort_order) || 0, id
      ]
    );
    return result.rows[0];
  },
  
  async delete(id) {
    await pool.query('DELETE FROM videos WHERE id=$1', [id]);
  },
  
  async approve(id, featured, archived) {
    await pool.query(
      'UPDATE videos SET status=$1, featured=$2, archived=$3 WHERE id=$4',
      ['approved', featured ? 1 : 0, archived ? 1 : 0, id]
    );
  },
  
  async reject(id) {
    await pool.query('UPDATE videos SET status=$1 WHERE id=$2', ['rejected', id]);
  },
  
  async createSubmission(data) {
    const { id, type } = parseVideoUrl(data.video_link);
    const result = await pool.query(
      `INSERT INTO videos 
       (title, students, description, video_id, video_type, year, tags_theme, tags_medium, featured, archived, sort_order, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 999, 'pending') 
       RETURNING *`,
      [
        data.title, data.students, data.description, id, type, parseInt(data.year),
        data.tags_theme || '', data.tags_medium || ''
      ]
    );
    return result.rows[0];
  },
};

// ==================== API ROUTES ====================
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await VideoModel.findPublic();
    res.json(videos);
  } catch (error) {
    console.error('GET /api/videos error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/videos', requireAdmin, async (req, res) => {
  try {
    const video = await VideoModel.create(req.body);
    res.json({ ok: true, video });
  } catch (error) {
    console.error('POST /api/videos error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/videos/:id', requireAdmin, async (req, res) => {
  try {
    const video = await VideoModel.update(req.params.id, req.body);
    res.json({ ok: true, video });
  } catch (error) {
    console.error('PUT /api/videos error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/videos/:id', requireAdmin, async (req, res) => {
  try {
    await VideoModel.delete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/videos error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/submit', requireStudent, async (req, res) => {
  try {
    await VideoModel.createSubmission(req.body);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/videos/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { featured, archived } = req.body;
    await VideoModel.approve(req.params.id, featured, archived);
    res.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/videos/approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/videos/:id/reject', requireAdmin, async (req, res) => {
  try {
    await VideoModel.reject(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error('PUT /api/videos/reject error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FRONTEND ROUTES ====================
app.get('/submit', requireStudent, (req, res) => {
  res.send(renderSubmitPage());
});

app.get('/user', requireAdmin, async (req, res) => {
  const videos = await VideoModel.findAll();
  res.send(renderAdminPage(videos));
});

app.get('/', async (req, res) => {
  const videos = await VideoModel.findPublic();
  res.send(renderPublicPage(videos, { 
    theme: 'default',
    label: '',
    ditherMode: 'b7'
  }));
});

// ==================== RENDER FUNCTIONS ====================
function renderPublicPage(videos, options = {}) {
  const { label = '', ditherMode = 'b7', paperTint = false } = options;
  
  const featured = videos.filter(v => v.featured && !v.archived);
  const archive = videos.filter(v => v.archived || !v.featured);
  
  // Collect unique tags
  const themeTags = new Set();
  const mediumTags = new Set();
  
  videos.forEach(v => {
    (v.tags_theme || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => themeTags.add(t));
    (v.tags_medium || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => mediumTags.add(t));
  });
  
  const renderCard = (video, isFeatured) => {
    const themeTagList = (video.tags_theme || '').split(',').filter(Boolean).map(t => t.trim());
    const mediumTagList = (video.tags_medium || '').split(',').filter(Boolean).map(t => t.trim());
    const allTags = [...themeTagList, ...mediumTagList];
    
    return `
    <div class="card" 
         data-featured="${isFeatured}" 
         data-tags="${allTags.join(',')}" 
         data-video-id="${video.video_id}" 
         data-video-type="${video.video_type}" 
         data-title="${escapeHtml(video.title)}" 
         data-authors="${escapeHtml(video.students)}" 
         data-year="${video.year}" 
         data-desc="${escapeHtml(video.description)}">
      <div class="thumb"><img alt="" loading="lazy"><div class="paper-tint"></div></div>
      <div class="meta">
        <div class="tags">
          ${themeTagList.map(t => `<span data-tag="${t}">${escapeHtml(t)}</span>`).join('\n')}
          ${mediumTagList.map(t => `<span data-tag="${t}" class="tag-medium">${escapeHtml(t)}</span>`).join('\n')}
        </div>
        <div class="card-right">
          <div class="card-title">${escapeHtml(video.title)}</div>
          <span class="card-year" data-year="${video.year}">${video.year}</span>
        </div>
      </div>
    </div>`;
  };
  
  const themeButtons = [...themeTags].sort().map(t => `<button data-filter="${t}">${escapeHtml(t)}</button>`).join('');
  const mediumButtons = [...mediumTags].sort().map(t => `<button data-filter="${t}">${escapeHtml(t)}</button>`).join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>in limbo — video archive</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #fff;
      font-family: 'IBM Plex Sans', Helvetica, Arial, sans-serif;
      font-weight: 300;
      color: #111;
      -webkit-font-smoothing: antialiased;
    }
    .page { max-width: 1400px; margin: 0 auto; padding: 40px 40px 120px; }
    
    /* Filters */
    .filters { display: flex; justify-content: space-between; margin-bottom: 40px; gap: 20px; }
    .filters-left { flex: 1; }
    .filters-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
    .filters-row .filters-label { 
      font-size: 11px; letter-spacing: 0.05em; color: #aaa; 
      min-width: 52px; padding-top: 7px;
    }
    .theme-tags, .medium-tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .filters button {
      font-family: inherit; font-size: 13px; padding: 6px 15px;
      border: 1px solid #ccc; border-radius: 100px;
      background: transparent; color: #555; cursor: pointer;
      transition: all 0.2s ease;
    }
    .filters button:hover { border-color: #111; color: #111; }
    .filters button.active { background: #111; border-color: #111; color: #fff; }
    .tag-expand, .tag-close, .search-toggle {
      width: 32px; height: 32px; padding: 0;
      border: 1px solid #ccc; border-radius: 100px;
      background: transparent; color: #555; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .search-wrap { display: flex; align-items: center; gap: 8px; }
    .search-input {
      font-family: inherit; font-size: 15px;
      border: 1px solid #ccc; border-radius: 100px;
      background: transparent; outline: none;
      width: 0; opacity: 0; transition: all 0.3s ease;
      padding: 8px 0;
    }
    .search-input.open { width: 220px; opacity: 1; padding: 8px 16px; }
    .search-input:focus { border-color: #111; }
    
    /* Grid & Cards */
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 25px 25px; }
    .card { opacity: 0; transform: translateY(30px); animation: fadeUp 0.6s ease forwards; }
    .card.hidden { display: none !important; }
    .card[data-featured="false"] { display: none; }
    .grid.show-archive .card[data-featured="false"] { display: block; }
    .card .thumb {
      position: relative; aspect-ratio: 16 / 9;
      background: #f0f0f0; overflow: hidden; cursor: pointer;
    }
    .card .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .card .thumb canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .card .thumb .paper-tint {
      position: absolute; inset: 0;
      background: rgb(255, 253, 244); mix-blend-mode: multiply;
      pointer-events: none; z-index: 2; display: none;
    }
    ${paperTint ? '.paper-tint-active .card .thumb .paper-tint { display: block; }' : ''}
    .card .thumb::after {
      content: ""; position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 0; height: 0; border-style: solid;
      border-width: 14px 0 14px 22px;
      border-color: transparent transparent transparent rgba(255,255,255,0.8);
      opacity: 0; transition: opacity 0.25s ease;
      pointer-events: none; z-index: 5;
    }
    .card .thumb:hover::after { opacity: 1; }
    .card .meta {
      display: flex; justify-content: space-between;
      padding: 6px 0 2px; gap: 12px;
    }
    .card .tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .card .tags span {
      font-size: 11px; letter-spacing: 0.03em; color: #777;
      cursor: pointer; transition: color 0.2s ease;
    }
    .card .tags span:hover { color: #111; }
    .card .tags span::before { content: "↳ "; opacity: 0.4; }
    .card .tags span.tag-medium { font-style: italic; }
    .card .card-right { display: flex; align-items: baseline; gap: 10px; flex-shrink: 0; }
    .card .card-title {
      font-size: 11px; letter-spacing: 0.03em; color: #111;
      font-weight: 400; text-align: right; white-space: nowrap;
    }
    .card .card-year {
      font-size: 11px; letter-spacing: 0.03em; color: #777;
      cursor: pointer; white-space: nowrap;
    }
    .card .card-year:hover { color: #111; }
    
    /* Intro Block */
    .intro-block {
      grid-column: 1; grid-row: 1 / 3;
      display: flex; flex-direction: column;
      padding: 0 20px 0 0;
    }
    .intro-block .intro-text { font-size: 22px; line-height: 1.55; }
    .intro-block .intro-text p { margin-bottom: 16px; }
    .intro-block .intro-text a { color: #111; text-decoration: underline; }
    .intro-block .intro-text a.year-filter { cursor: pointer; }
    .labo-hover { position: relative; display: inline; }
    .labo-logo-hover {
      position: absolute; bottom: calc(100% + 8px); left: 50%;
      transform: translateX(-50%); height: 80px; width: auto;
      opacity: 0; pointer-events: none; transition: opacity 0.25s ease;
      z-index: 10;
    }
    .labo-hover:hover .labo-logo-hover { opacity: 1; }
    
    /* Archive Toggle */
    .archive-toggle { display: flex; justify-content: center; margin-top: 32px; }
    .archive-toggle button {
      width: 46px; height: 46px; padding: 0;
      border: 1px solid #ccc; border-radius: 50%;
      background: transparent; cursor: pointer;
    }
    
    /* Lightbox */
    .lightbox {
      display: none; position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.92); align-items: center; justify-content: center;
    }
    .lightbox.open { display: flex; }
    .lightbox .lb-inner {
      position: relative; width: 100%; max-width: 960px;
      padding: 0 40px;
    }
    .lightbox .lb-video { width: 100%; aspect-ratio: 16/9; }
    .lightbox iframe { width: 100%; height: 100%; border: none; }
    .lightbox .lb-meta { padding: 20px 0 0; }
    .lightbox .lb-meta h2 {
      font-weight: 500; font-size: 16px; color: #fff;
      margin-bottom: 3px;
    }
    .lightbox .lb-meta .lb-authors,
    .lightbox .lb-meta .lb-year {
      font-size: 14px; color: rgba(255,255,255,0.6);
    }
    .lightbox .lb-read-more {
      font-size: 13px; color: rgba(255,255,255,0.4);
      cursor: pointer; background: none; border: none;
      margin-top: 14px;
    }
    .lightbox .lb-read-more:hover { color: rgba(255,255,255,0.8); }
    .lightbox .lb-desc-wrap {
      max-height: 0; overflow: hidden;
      transition: max-height 0.4s ease;
    }
    .lightbox .lb-desc-wrap.open { max-height: 500px; margin-top: 12px; }
    .lightbox .lb-desc-wrap p {
      font-size: 12px; line-height: 1.6;
      color: rgba(255,255,255,0.55);
      column-count: 2; column-gap: 32px;
    }
    .lightbox .lb-close {
      position: absolute; top: -40px; left: 40px;
      font-size: 14px; color: rgba(255,255,255,0.4);
      cursor: pointer;
    }
    .lightbox .lb-close:hover { color: #fff; }
    
    /* Footer */
    .site-footer {
      max-width: 1400px; margin: 0 auto;
      padding: 80px 40px 40px;
      display: flex; justify-content: space-between;
    }
    .site-footer .footer-text { font-size: 13px; line-height: 1.5; }
    .site-footer .footer-logos img { height: 90px; width: auto; }
    
    .version-label {
      position: fixed; top: 10px; right: 10px;
      font-size: 11px; color: #aaa; z-index: 999;
    }
    
    @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 900px) {
      .grid { grid-template-columns: repeat(2, 1fr); gap: 14px; }
      .intro-block { grid-column: 1 / -1; grid-row: auto; }
    }
    @media (max-width: 540px) {
      .page { padding: 24px 16px 60px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body class="${paperTint ? 'paper-tint-active' : ''}">
  ${label ? `<div class="version-label">${escapeHtml(label)}</div>` : '<div class="version-label" style="background:#111; color:#0f0; padding:4px 12px; border-radius:100px; font-family:monospace;">✅ v2.0 - Archive filtering ACTIVE</div>'}
  
  <div class="page">
    <div class="filters" id="filters">
      <div class="filters-left">
        <div class="filters-row">
          <span class="filters-label">theme</span>
          <div class="theme-tags">
            <button class="active" data-filter="all">all</button>
            ${themeButtons}
            <button class="tag-expand" id="tag-expand" title="show all tags">+</button>
          </div>
        </div>
        <div class="filters-row">
          <span class="filters-label">medium</span>
          <div class="medium-tags" id="medium-tags">
            ${mediumButtons}
          </div>
        </div>
      </div>
      <div class="search-wrap">
        <button class="search-toggle" id="search-toggle" title="search">⌕</button>
        <input type="text" id="search-input" class="search-input" placeholder="search...">
      </div>
    </div>
    
    <div class="grid" id="grid">
      <div class="intro-block" id="intro-block">
        <div class="intro-text">
          <p>This video archive brings together films produced by architecture students at 
            <a href="https://arch.kuleuven.be/">KU Leuven</a> within the 
            <span class="labo-hover">
              <a href="https://www.lab-o.club/">lab-O</a>
              <img class="labo-logo-hover" src="/public/logo-labo.png" alt="lab-O">
            </span> trajectory for the third-year bachelor studio.</p>
          <p>Each academic year is structured around a different theme: 
            <a href="#" class="year-filter" data-year="2022">Frame</a>, 
            <a href="#" class="year-filter" data-year="2023">The Gaze</a>, 
            <a href="#" class="year-filter" data-year="2024">Werk</a>, 
            <a href="#" class="year-filter" data-year="2025">Il n'y a pas de hors-architecture</a>, 
            and most recently <a href="#" class="year-filter" data-year="2026">In Limbo</a>.
          </p>
        </div>
      </div>
      ${featured.map(v => renderCard(v, true)).join('\n')}
      ${archive.map(v => renderCard(v, false)).join('\n')}
    </div>
    
    ${archive.length === 0 ? '' : `
    <div class="archive-toggle" id="archive-toggle">
      <button id="archive-btn">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>`}
  </div>
  
  <div class="site-footer">
    <div class="footer-text">
      Students were taught by Stijn Colon, Lukas Claessens, Bert Stoffels, 
      Yann Courouble, Carl Bourgeois, Lodewijk Heylen at KU Leuven. 
      Website made by Stijn Colon in 2026.
    </div>
    <div class="footer-logos">
      <img src="/public/logos-outline.png" alt="lab-O & KU Leuven">
    </div>
  </div>
  
  <div class="lightbox" id="lightbox">
    <div class="lb-inner">
      <div class="lb-close">close ✕</div>
      <div class="lb-video">
        <iframe id="lb-iframe" src="" allowfullscreen></iframe>
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
    window.__ditherMode = '${ditherMode}';
    
    const ditherConfigs = {
      default: { w: 500, threshold: 160, contrast: 1.0, colorMode: 'tinted' },
      b7: { w: 650, threshold: 140, contrast: 1.1, targetLum: 150, combo: [
        { dot: [60,60,120], bg: [248,248,255], hue: 50 },
        { dot: [40,90,70], bg: [248,255,250], hue: 180 },
        { dot: [130,65,45], bg: [255,250,248], hue: 0 }
      ]}
    };
    
    const activeConfig = ditherConfigs[window.__ditherMode] || ditherConfigs.default;
    
    function getDominantColor(ctx, w, h) {
      const d = ctx.getImageData(0, 0, w, h).data;
      const hueBuckets = new Array(360).fill(0);
      for (let i = 0; i < d.length; i += 16) {
        const r = d[i]/255, g = d[i+1]/255, b = d[i+2]/255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const delta = max - min;
        if (delta < 0.08) continue;
        const lum = (max + min) / 2;
        if (lum < 0.1 || lum > 0.9) continue;
        let hue = 0;
        if (max === r) hue = ((g - b) / delta) % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue = Math.round(hue * 60);
        if (hue < 0) hue += 360;
        hueBuckets[hue]++;
      }
      let maxCount = 0, domHue = 0;
      for (let h = 0; h < 360; h++) {
        let sum = 0;
        for (let j = -15; j <= 15; j++) sum += hueBuckets[(h + j + 360) % 360];
        if (sum > maxCount) { maxCount = sum; domHue = h; }
      }
      const palette = [
        { color: [245, 240, 220], hue: 50 },
        { color: [220, 242, 242], hue: 180 },
        { color: [245, 225, 225], hue: 0 },
      ];
      let best = palette[0].color, bestDist = Infinity;
      for (const p of palette) {
        let dist = Math.abs(domHue - p.hue);
        if (dist > 180) dist = 360 - dist;
        if (dist < bestDist) { bestDist = dist; best = p.color; }
      }
      return best;
    }
    
    function ditherImage(img, thumb) {
      const cfg = activeConfig;
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
      
      let finalDotColor = null, finalBgColor = null;
      if (cfg.combo) {
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
      
      const origData = ctx.getImageData(0, 0, w, h);
      const gray = new Float32Array(w * h);
      for (let i = 0; i < origData.data.length; i += 4) {
        let lum = origData.data[i] * 0.299 + origData.data[i+1] * 0.587 + origData.data[i+2] * 0.114;
        lum = ((lum / 255 - 0.5) * cfg.contrast + 0.5) * 255;
        gray[i/4] = Math.max(0, Math.min(255, lum));
      }
      const threshold = cfg.threshold;
      
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const old = gray[i];
          const nw = old > threshold ? 255 : 0;
          out[i] = nw;
          const err = old - nw;
          if (x + 1 < w) gray[i+1] += err * 7/16;
          if (y + 1 < h && x > 0) gray[i+w-1] += err * 3/16;
          if (y + 1 < h) gray[i+w] += err * 5/16;
          if (y + 1 < h && x + 1 < w) gray[i+w+1] += err * 1/16;
        }
      }
      
      const imageData = ctx.createImageData(w, h);
      for (let i = 0; i < out.length; i++) {
        const v = out[i] / 255;
        let r, g, b;
        if (finalDotColor && finalBgColor) {
          r = Math.round(finalDotColor[0] + v * (finalBgColor[0] - finalDotColor[0]));
          g = Math.round(finalDotColor[1] + v * (finalBgColor[1] - finalDotColor[1]));
          b = Math.round(finalDotColor[2] + v * (finalBgColor[2] - finalDotColor[2]));
        } else {
          r = Math.round(v * cr);
          g = Math.round(v * cg);
          b = Math.round(v * cb);
        }
        imageData.data[i*4] = r;
        imageData.data[i*4+1] = g;
        imageData.data[i*4+2] = b;
        imageData.data[i*4+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      canvas.style.imageRendering = 'pixelated';
      thumb.appendChild(canvas);
    }
    
    // Load thumbnails
    document.querySelectorAll('.card[data-video-id]').forEach(card => {
      const id = card.dataset.videoId;
      const type = card.dataset.videoType;
      const img = card.querySelector('img');
      img.crossOrigin = 'Anonymous';
      
      img.addEventListener('load', function() {
        try { ditherImage(img, card.querySelector('.thumb')); } catch(e) {}
      });
      
      if (type === 'youtube') {
        img.src = 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
      } else {
        fetch('https://vimeo.com/api/oembed.json?url=https://vimeo.com/' + id + '&width=640')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            let u = data.thumbnail_url;
            u = u.replace(/_\\d+x\\d+/, '_640');
            img.src = u;
          })
          .catch(function() { img.src = 'https://vumbnail.com/' + id + '.jpg'; });
      }
    });
    
    // Lightbox
    const lightbox = document.getElementById('lightbox');
    const lbIframe = document.getElementById('lb-iframe');
    const lbTitle = document.getElementById('lb-title');
    const lbAuthors = document.getElementById('lb-authors');
    const lbYear = document.getElementById('lb-year');
    const lbDesc = document.getElementById('lb-desc');
    const lbDescWrap = document.getElementById('lb-desc-wrap');
    const lbReadMore = document.getElementById('lb-read-more');
    
    document.getElementById('grid').addEventListener('click', function(e) {
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
    
    lbReadMore.addEventListener('click', function() {
      const isOpen = lbDescWrap.classList.toggle('open');
      lbReadMore.textContent = isOpen ? 'close synopsis ↑' : 'read synopsis ↓';
    });
    
    function closeLightbox() {
      lightbox.classList.remove('open');
      lbIframe.src = '';
      document.body.style.overflow = '';
    }
    lightbox.addEventListener('click', function(e) {
      if (e.target === lightbox || e.target.closest('.lb-close')) closeLightbox();
    });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeLightbox(); });
    
    // Filters - IMPROVED VERSION with archive support
    let activeFilter = 'all';
    let activeType = 'tag';
    const grid = document.getElementById('grid');
    const filters = document.getElementById('filters');
    const searchToggle = document.getElementById('search-toggle');
    const searchInput = document.getElementById('search-input');
    
    searchToggle.addEventListener('click', function() {
      searchInput.classList.toggle('open');
      if (searchInput.classList.contains('open')) {
        searchInput.focus();
      } else {
        searchInput.value = '';
        applyFilter('all', 'tag');
      }
    });
    
    searchInput.addEventListener('input', function() {
      const q = searchInput.value.toLowerCase().trim();
      if (!q) { applyFilter('all', 'tag'); return; }
      activeFilter = 'search';
      activeType = 'search';
      document.querySelectorAll('.card').forEach(function(card) {
        if (!card.dataset.videoId) return;
        const title = (card.dataset.title || '').toLowerCase();
        const authors = (card.dataset.authors || '').toLowerCase();
        const tags = (card.dataset.tags || '').toLowerCase();
        const match = title.indexOf(q) !== -1 || authors.indexOf(q) !== -1 || tags.indexOf(q) !== -1;
        card.classList.toggle('hidden', !match);
      });
    });
    
    // THE FIXED applyFilter function - archive items are now included in filters
    function applyFilter(value, type) {
      activeFilter = value;
      activeType = type;
      
      document.querySelectorAll('button[data-filter]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.filter === value);
      });
      
      const isFiltered = value !== 'all';
      const introBlock = document.getElementById('intro-block');
      if (introBlock) introBlock.style.display = isFiltered ? 'none' : '';
      
      // FIX: Automatically open archive when filtering so archive items appear
      if (isFiltered && !grid.classList.contains('show-archive')) {
        grid.classList.add('show-archive');
        const archiveBtn = document.getElementById('archive-btn');
        if (archiveBtn) {
          archiveBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        }
      }
      
      document.querySelectorAll('.card').forEach(function(card) {
        if (!card.dataset.videoId) return;
        const isArchive = card.dataset.featured === 'false';
        
        if (value === 'all') {
          card.classList.toggle('hidden', isArchive && !grid.classList.contains('show-archive'));
        } else if (type === 'year') {
          card.classList.toggle('hidden', card.dataset.year !== value);
        } else if (type === 'tag') {
          const tags = card.dataset.tags || '';
          card.classList.toggle('hidden', tags.split(',').indexOf(value) === -1);
        }
      });
    }
    
    filters.addEventListener('click', function(e) {
      if (e.target.tagName === 'BUTTON' && e.target.dataset.filter) {
        applyFilter(e.target.dataset.filter, 'tag');
      }
    });
    
    document.getElementById('grid').addEventListener('click', function(e) {
      if (e.target.matches('.tags span[data-tag]')) {
        applyFilter(e.target.dataset.tag, 'tag');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (e.target.matches('.card-year[data-year]')) {
        const year = e.target.dataset.year;
        if (activeType === 'year' && activeFilter === year) {
          applyFilter('all', 'tag');
        } else {
          applyFilter(year, 'year');
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    
    document.querySelectorAll('.year-filter').forEach(function(link) {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        applyFilter(link.dataset.year, 'year');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    
    // Archive toggle
    const archiveToggle = document.getElementById('archive-toggle');
    if (archiveToggle) {
      archiveToggle.addEventListener('click', function() {
        const isOpen = grid.classList.toggle('show-archive');
        const btn = document.getElementById('archive-btn');
        if (isOpen) {
          btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        } else {
          btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
        }
      });
    }
  </script>
</body>
</html>`;
}

function renderSubmitPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>in limbo — submit</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'IBM Plex Sans', Helvetica, sans-serif;
      background: #fff; color: #111;
      padding: 40px; -webkit-font-smoothing: antialiased;
    }
    h1 { font-weight: 300; font-size: 32px; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 40px; }
    .subtitle a { color: #111; }
    .form-section {
      background: #fff; border: 1px solid #e0e0e0;
      padding: 32px; max-width: 600px;
    }
    label {
      display: block; font-size: 12px; letter-spacing: 0.04em;
      color: #888; margin-bottom: 6px; margin-top: 16px;
    }
    label:first-of-type { margin-top: 0; }
    input, textarea, select {
      width: 100%; font-family: inherit; font-size: 14px;
      padding: 10px 12px; border: 1px solid #ddd;
      background: #fff; outline: none;
    }
    input:focus, textarea:focus { border-color: #111; }
    textarea { resize: vertical; min-height: 120px; }
    .row { display: flex; gap: 16px; }
    .row > div { flex: 1; }
    button[type="submit"] {
      font-family: inherit; font-size: 13px;
      padding: 12px 28px; border: 1px solid #111;
      background: #111; color: #fff; cursor: pointer;
      margin-top: 24px;
    }
    button[type="submit"]:hover { background: #333; }
    .success {
      padding: 16px 20px; background: #f0faf0;
      border: 1px solid #c0e0c0; color: #2a6e2a;
      font-size: 14px; margin-bottom: 24px;
      max-width: 600px; display: none;
    }
    .success.show { display: block; }
    .note { font-size: 12px; color: #999; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>in limbo</h1>
  <div class="subtitle">submit your work · <a href="/">← back to archive</a></div>

  <div class="success" id="success-msg">
    Your video has been submitted and is awaiting review.
  </div>

  <div class="form-section">
    <h2 style="font-weight:600;font-size:16px;margin-bottom:24px;">submit a video</h2>
    <form id="submit-form">
      <label>title</label>
      <input type="text" name="title" required>

      <div class="row">
        <div>
          <label>student(s)</label>
          <input type="text" name="students" required>
        </div>
        <div>
          <label>year</label>
          <input type="number" name="year" min="2020" max="2030" value="2026" required>
        </div>
      </div>

      <label>video link (Vimeo or YouTube)</label>
      <input type="text" name="video_link" placeholder="https://vimeo.com/... or https://youtu.be/..." required>

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
    const authHeader = 'Basic ' + btoa('${config.studentUser}:${config.studentPass}');
    document.getElementById('submit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(Object.fromEntries(fd))
      });
      if (res.ok) {
        document.getElementById('success-msg').classList.add('show');
        e.target.reset();
      }
    });
  </script>
</body>
</html>`;
}

function renderAdminPage(videos) {
  const pending = videos.filter(v => v.status === 'pending');
  const approved = videos.filter(v => v.status !== 'pending' && v.status !== 'rejected');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>in limbo — admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'IBM Plex Sans', Helvetica, sans-serif;
      background: #fafafa; color: #111;
      padding: 40px; -webkit-font-smoothing: antialiased;
    }
    h1 { font-weight: 300; font-size: 32px; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 40px; }
    .subtitle a { color: #111; }
    .form-section {
      background: #fff; border: 1px solid #e0e0e0;
      padding: 32px; margin-bottom: 32px; max-width: 700px;
    }
    .form-section h2 { font-weight: 600; font-size: 16px; margin-bottom: 24px; }
    label {
      display: block; font-size: 12px; letter-spacing: 0.04em;
      color: #888; margin-bottom: 6px; margin-top: 16px;
    }
    label:first-of-type { margin-top: 0; }
    input, textarea, select {
      width: 100%; font-family: inherit; font-size: 14px;
      padding: 10px 12px; border: 1px solid #ddd;
      background: #fff; outline: none;
    }
    input:focus, textarea:focus { border-color: #111; }
    textarea { resize: vertical; min-height: 100px; }
    .row { display: flex; gap: 16px; }
    .row > div { flex: 1; }
    .check-row { display: flex; gap: 24px; margin-top: 16px; }
    .check-row label {
      display: flex; align-items: center; gap: 8px;
      margin: 0; font-size: 13px; color: #111;
    }
    button, .btn {
      font-family: inherit; font-size: 13px;
      padding: 12px 28px; border: 1px solid #111;
      background: #111; color: #fff; cursor: pointer;
      margin-top: 24px;
    }
    .btn-danger {
      background: #fff; color: #c00; border-color: #c00;
      padding: 6px 14px; font-size: 12px; margin-top: 0;
    }
    .btn-edit {
      background: #fff; color: #111; border-color: #ccc;
      padding: 6px 14px; font-size: 12px; margin-top: 0;
    }
    .video-list { max-width: 900px; }
    .video-item {
      background: #fff; border: 1px solid #e0e0e0;
      padding: 20px 24px; margin-bottom: 12px;
      display: flex; justify-content: space-between; align-items: center;
      gap: 20px;
    }
    .video-item .info { flex: 1; }
    .video-item .info h3 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
    .video-item .info .meta { font-size: 12px; color: #888; }
    .badges { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    .badge {
      font-size: 10px; padding: 3px 8px; border-radius: 100px;
      background: #f0f0f0; color: #666;
    }
    .badge.featured { background: #111; color: #fff; }
    .badge.archived { background: #c00; color: #fff; }
    .video-item .actions { display: flex; gap: 8px; flex-shrink: 0; }
    #edit-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.5); z-index: 100;
      align-items: center; justify-content: center; padding: 40px;
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
  <div class="subtitle"><a href="/">← back to site</a></div>

  <div class="form-section">
    <h2>add video</h2>
    <form id="add-form">
      <label>title</label>
      <input type="text" name="title" required>

      <div class="row">
        <div>
          <label>students</label>
          <input type="text" name="students" required>
        </div>
        <div>
          <label>year</label>
          <input type="number" name="year" min="2020" max="2030" required>
        </div>
      </div>

      <label>video link (Vimeo or YouTube)</label>
      <input type="text" name="video_link" placeholder="https://vimeo.com/... or https://youtu.be/..." required>

      <label>description</label>
      <textarea name="description" maxlength="1500" required></textarea>

      <label>themes / positions (comma-separated)</label>
      <input type="text" name="tags_theme">

      <label>medium / strategy (comma-separated)</label>
      <input type="text" name="tags_medium">

      <div class="row">
        <div>
          <label>sort order (lower = earlier)</label>
          <input type="number" name="sort_order" value="0">
        </div>
      </div>

      <div class="check-row">
        <label><input type="checkbox" name="featured" checked> featured</label>
        <label><input type="checkbox" name="archived"> archive</label>
      </div>

      <button type="submit">add video</button>
    </form>
  </div>

  <div class="video-list">
    <h2 style="font-size:16px;font-weight:600;margin-bottom:16px;color:#b8860b;">
      pending (${pending.length})
    </h2>
    ${pending.map(v => `
    <div class="video-item" style="border-left:3px solid #b8860b;" data-id="${v.id}">
      <div class="info">
        <h3>${escapeHtml(v.title)}</h3>
        <div class="meta">
          <span>${escapeHtml(v.students)}</span>
          <span>${v.year}</span>
          <span>${v.video_type}/${v.video_id}</span>
        </div>
        <div style="font-size:12px;color:#666;margin-top:8px;">${escapeHtml(v.description).substring(0, 200)}...</div>
        <div class="badges">
          ${(v.tags_theme || '').split(',').filter(Boolean).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
          ${(v.tags_medium || '').split(',').filter(Boolean).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <div class="actions" style="flex-direction:column;gap:6px;">
        <div style="display:flex;gap:6px;">
          <button class="btn-edit" style="background:#2a6e2a;color:#fff;" onclick="approveVideo(${v.id}, true, false)">feature</button>
          <button class="btn-edit" style="background:#555;color:#fff;" onclick="approveVideo(${v.id}, false, true)">archive</button>
        </div>
        <button class="btn-danger" onclick="rejectVideo(${v.id})">reject</button>
      </div>
    </div>`).join('') || '<p style="color:#999;font-size:13px;">no pending submissions</p>'}
  </div>

  <div class="video-list" style="margin-top:32px;">
    <h2 style="font-size:16px;font-weight:600;margin-bottom:16px;">all videos (${approved.length})</h2>
    ${approved.map(v => `
    <div class="video-item" data-id="${v.id}" 
         data-title="${escapeHtml(v.title)}" 
         data-students="${escapeHtml(v.students)}" 
         data-year="${v.year}" 
         data-video-id="${v.video_id}" 
         data-video-type="${v.video_type}" 
         data-desc="${escapeHtml(v.description)}" 
         data-tags-theme="${escapeHtml(v.tags_theme || '')}" 
         data-tags-medium="${escapeHtml(v.tags_medium || '')}" 
         data-sort="${v.sort_order}" 
         data-featured="${v.featured}" 
         data-archived="${v.archived}">
      <div class="info">
        <h3>${escapeHtml(v.title)}</h3>
        <div class="meta">
          <span>${escapeHtml(v.students)}</span>
          <span>${v.year}</span>
          <span>${v.video_type}/${v.video_id}</span>
          <span>sort: ${v.sort_order}</span>
        </div>
        <div class="badges">
          ${v.featured ? '<span class="badge featured">featured</span>' : ''}
          ${v.archived ? '<span class="badge archived">archive</span>' : ''}
          ${(v.tags_theme || '').split(',').filter(Boolean).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <div class="actions">
        <button class="btn-edit" onclick="editVideo(${v.id})">edit</button>
        <button class="btn-danger" onclick="deleteVideo(${v.id})">delete</button>
      </div>
    </div>`).join('')}
  </div>

  <div id="edit-overlay">
    <div class="form-section" style="margin:0; width:100%; max-width:700px; max-height:90vh; overflow-y:auto;">
      <h2>edit video</h2>
      <form id="edit-form">
        <input type="hidden" name="id" id="edit-id">
        <label>title</label>
        <input type="text" name="title" id="edit-title" required>
        <div class="row">
          <div><label>students</label><input type="text" name="students" id="edit-students" required></div>
          <div><label>year</label><input type="number" name="year" id="edit-year" required></div>
        </div>
        <label>video link</label>
        <input type="text" name="video_link" id="edit-video-link" required>
        <label>description</label>
        <textarea name="description" id="edit-desc" required></textarea>
        <label>themes</label>
        <input type="text" name="tags_theme" id="edit-tags-theme">
        <label>medium</label>
        <input type="text" name="tags_medium" id="edit-tags-medium">
        <label>sort order</label>
        <input type="number" name="sort_order" id="edit-sort">
        <div class="check-row">
          <label><input type="checkbox" name="featured" id="edit-featured"> featured</label>
          <label><input type="checkbox" name="archived" id="edit-archived"> archive</label>
        </div>
        <div style="display:flex;gap:12px;">
          <button type="submit">save</button>
          <button type="button" onclick="closeEdit()" style="background:#fff;color:#555;border-color:#ccc;">cancel</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const authHeader = 'Basic ' + btoa('${config.adminUser}:${config.adminPass}');
    
    document.getElementById('add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await fetch('/api/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(Object.fromEntries(fd))
      });
      location.reload();
    });
    
    async function deleteVideo(id) {
      if (!confirm('Delete this video?')) return;
      await fetch('/api/videos/' + id, { method: 'DELETE', headers: { 'Authorization': authHeader } });
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
      if (!confirm('Reject this submission?')) return;
      await fetch('/api/videos/' + id + '/reject', { method: 'PUT', headers: { 'Authorization': authHeader } });
      location.reload();
    }
    
    function editVideo(id) {
      const item = document.querySelector('.video-item[data-id="' + id + '"]');
      document.getElementById('edit-id').value = id;
      document.getElementById('edit-title').value = item.dataset.title;
      document.getElementById('edit-students').value = item.dataset.students;
      document.getElementById('edit-year').value = item.dataset.year;
      const type = item.dataset.videoType || 'vimeo';
      const vid = item.dataset.videoId;
      document.getElementById('edit-video-link').value = type === 'youtube' ? 'https://youtu.be/' + vid : 'https://vimeo.com/' + vid;
      document.getElementById('edit-desc').value = item.dataset.desc;
      document.getElementById('edit-tags-theme').value = item.dataset.tagsTheme || '';
      document.getElementById('edit-tags-medium').value = item.dataset.tagsMedium || '';
      document.getElementById('edit-sort').value = item.dataset.sort;
      document.getElementById('edit-featured').checked = item.dataset.featured === '1';
      document.getElementById('edit-archived').checked = item.dataset.archived === '1';
      document.getElementById('edit-overlay').style.display = 'flex';
    }
    
    function closeEdit() {
      document.getElementById('edit-overlay').style.display = 'none';
    }
    
    document.getElementById('edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const id = fd.get('id');
      await fetch('/api/videos/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify(Object.fromEntries(fd))
      });
      location.reload();
    });
  </script>
</body>
</html>`;
}

// ==================== START SERVER ====================
initDB().then(() => {
  app.listen(config.port, () => {
    console.log(`
╔════════════════════════════════════════╗
║        in limbo video archive          ║
╠════════════════════════════════════════╣
║  Server: http://localhost:${config.port}        ║
║  Admin:  http://localhost:${config.port}/user   ║
║  Submit: http://localhost:${config.port}/submit ║
╚════════════════════════════════════════╝
    `);
  });
});