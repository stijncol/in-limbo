const { YOUTUBE_API_KEY, SITE_URL } = require('../config');

const SITE_DESCRIPTION = 'in limbo — video archive of KU Leuven Architecture, Positioneren II 2025–2026.';

function renderPublic(rows) {
  const allVideos = rows.filter(v => v.status === 'approved' || !v.status);
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

  function renderCard(v, isFeatured, extraClass = '') {
    const tt = (v.tags_theme || v.tags || '').split(',').filter(Boolean).map(t => t.trim());
    const tm = (v.tags_medium || '').split(',').filter(Boolean).map(t => t.trim());
    const allTags = [...tt, ...tm];
    const themeSpans = tt.map(t => `<span data-tag="${t}">${t}</span>`).join('\n            ');
    const mediumSpans = tm.map(t => `<span data-tag="${t}" class="tag-medium">${t}</span>`).join('\n            ');
    const videoId = v.video_id || v.vimeo_id;
    const videoType = v.video_type || 'vimeo';
    const thumbHtml = v.has_thumb
      ? `<div class="thumb" data-baked="true"><img src="/thumb/${v.id}" class="baked-blur" alt="${esc(v.title)}"><img data-sharp="/thumb/${v.id}/sharp" class="baked-sharp" alt=""></div>`
      : `<div class="thumb"><img alt=""></div>`;
    return `
    <div class="card${extraClass}" data-featured="${isFeatured}" data-tags="${allTags.join(',')}" data-video-id="${videoId}" data-video-type="${videoType}" data-title="${esc(v.title)}" data-authors="${esc(v.students)}" data-year="${v.year}" data-desc="${esc(v.description)}">
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
  // The first archive video stays visible as a real teaser in the preview row
  const archiveCards = archive.map((v, i) => renderCard(v, 'false', i === 0 ? ' archive-preview' : '')).join('\n');

  const themeTagCounts = {};
  const mediumTagCounts = {};
  allVideos.forEach(v => {
    (v.tags_theme || v.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => { themeTagCounts[t] = (themeTagCounts[t] || 0) + 1; });
    (v.tags_medium || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => { mediumTagCounts[t] = (mediumTagCounts[t] || 0) + 1; });
  });

  const themeButtons = [...themeTags].sort().map(t => `<button data-filter="${t}">${t}<span class="tag-count">${themeTagCounts[t] || 0}</span></button>`).join('\n    ');
  const mediumButtons = [...mediumTags].sort().map(t => `<button data-filter="${t}">${t}<span class="tag-count">${mediumTagCounts[t] || 0}</span></button>`).join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo</title>
<meta name="description" content="${SITE_DESCRIPTION}">
<meta property="og:title" content="in limbo">
<meta property="og:description" content="${SITE_DESCRIPTION}">
<meta property="og:type" content="website">
${SITE_URL ? `<link rel="canonical" href="${SITE_URL}/">
<meta property="og:url" content="${SITE_URL}/">
<meta property="og:image" content="${SITE_URL}/public/og-image.png">
<meta name="twitter:card" content="summary_large_image">` : ''}
<link rel="icon" type="image/png" href="/public/favicon.png">
<link rel="apple-touch-icon" href="/public/apple-touch-icon.png">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@100;200;300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/css/public.css">
</head>
<body>
<div class="page">
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
      <div class="filters-extra" id="filters-extra"></div>
      <div class="filters-row filters-medium">
        <span class="filters-label">medium</span>
        <div class="medium-tags">${mediumButtons}</div>
      </div>
      <button class="tag-collapse" id="tag-collapse" title="collapse tags">–</button>
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
        <p>This video archive brings together a series of films produced by architecture students at <a href="https://arch.kuleuven.be/">KU Leuven</a> within the <span class="labo-hover"><a href="https://www.lab-o.club/">lab-O</a><img class="labo-logo-hover" src="/public/logo-labo.png" alt="lab-O"></span> trajectory for the third-year bachelor studio Positioneren 2: Stelling–Strategie. The archive includes works produced from 2021 to the present.</p>
        <p>Each academic year is structured around a different thematic framework, including <a href="#" class="year-filter" data-year="2022">Frame</a>, <a href="#" class="year-filter" data-year="2023">The Gaze</a>, <a href="#" class="year-filter" data-year="2024">Werk</a>, <a href="#" class="year-filter" data-year="2025">Il n'y a pas de hors-archi&shy;tecture</a>, and most recently (2026), <a href="#" class="year-filter" data-year="2026">In Limbo</a>.</p>
        <p>The archive can be browsed by theme using the tags above, or by year by clicking any of the studio titles. Search by title, student name, or keyword: <span class="inline-search-wrap"><svg class="inline-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg><input type="text" id="search-input" class="inline-search-input" placeholder=""></span></p>
      </div>
    </div>
${featuredCards}
${archiveCards}
    <div class="archive-toggle" id="archive-toggle" ${archive.length === 0 ? 'style="display:none"' : ''}>
      <button class="ghost-card ghost-plus" id="archive-btn" aria-label="load the complete archive">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span class="ghost-label">show all</span>
      </button>
      <div class="ghost-card ghost-r1 ghost-b" aria-hidden="true"></div>
      <div class="ghost-card ghost-r2" aria-hidden="true"></div>
      <div class="ghost-card ghost-r2 ghost-e" aria-hidden="true"></div>
      <div class="ghost-card ghost-r2 ghost-f" aria-hidden="true"></div>
    </div>
    <button class="ghost-card ghost-plus ghost-minus" id="archive-close-btn" aria-label="show only the highlights">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span class="ghost-label">show less</span>
    </button>
  </div>
  </div>
</div>

<button class="margin-about active" id="about-btn">[about]</button>
<div id="about-panel">
  <button class="about-close" aria-label="close about"><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg></button>
</div>
<div class="margin-scale" id="scale-ctrl">
  <button class="scale-icon-btn" id="scale-down" title="Bigger thumbnails" disabled>
    <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="0.5" stroke-linecap="round"><circle cx="8" cy="8" r="7"/><line x1="4.5" y1="8" x2="11.5" y2="8"/></svg>
  </button>
  <div class="scale-grid-icons">
    <button class="scale-grid-icon active" data-scale="0" title="3 columns">
      <svg width="24" height="16" viewBox="0 0 15 10" fill="none" stroke="currentColor" stroke-width="0.5" overflow="visible"><rect x="0.25" y="0.25" width="3" height="3"/><rect x="6" y="0.25" width="3" height="3"/><rect x="11.75" y="0.25" width="3" height="3"/><rect x="0.25" y="6.75" width="3" height="3"/><rect x="6" y="6.75" width="3" height="3"/><rect x="11.75" y="6.75" width="3" height="3"/></svg>
    </button>
    <button class="scale-grid-icon" data-scale="1" title="5 columns">
      <svg width="24" height="16" viewBox="0 0 15 10" fill="none" stroke="currentColor" stroke-width="0.4" overflow="visible"><rect x="0.2" y="0.2" width="1.6" height="3.1"/><rect x="3.45" y="0.2" width="1.6" height="3.1"/><rect x="6.7" y="0.2" width="1.6" height="3.1"/><rect x="9.95" y="0.2" width="1.6" height="3.1"/><rect x="13.2" y="0.2" width="1.6" height="3.1"/><rect x="0.2" y="6.7" width="1.6" height="3.1"/><rect x="3.45" y="6.7" width="1.6" height="3.1"/><rect x="6.7" y="6.7" width="1.6" height="3.1"/><rect x="9.95" y="6.7" width="1.6" height="3.1"/><rect x="13.2" y="6.7" width="1.6" height="3.1"/></svg>
    </button>
    <button class="scale-grid-icon" data-scale="2" title="7 columns">
      <svg width="24" height="16" viewBox="0 0 15 10" fill="none" stroke="currentColor" stroke-width="0.35" overflow="visible"><rect x="0.18" y="0.18" width="0.9" height="3.14"/><rect x="2.48" y="0.18" width="0.9" height="3.14"/><rect x="4.78" y="0.18" width="0.9" height="3.14"/><rect x="7.08" y="0.18" width="0.9" height="3.14"/><rect x="9.38" y="0.18" width="0.9" height="3.14"/><rect x="11.68" y="0.18" width="0.9" height="3.14"/><rect x="13.98" y="0.18" width="0.9" height="3.14"/><rect x="0.18" y="6.68" width="0.9" height="3.14"/><rect x="2.48" y="6.68" width="0.9" height="3.14"/><rect x="4.78" y="6.68" width="0.9" height="3.14"/><rect x="7.08" y="6.68" width="0.9" height="3.14"/><rect x="9.38" y="6.68" width="0.9" height="3.14"/><rect x="11.68" y="6.68" width="0.9" height="3.14"/><rect x="13.98" y="6.68" width="0.9" height="3.14"/></svg>
    </button>
  </div>
  <button class="scale-icon-btn" id="scale-up" title="Smaller thumbnails">
    <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="0.5" stroke-linecap="round"><circle cx="8" cy="8" r="7"/><line x1="8" y1="4.5" x2="8" y2="11.5"/><line x1="4.5" y1="8" x2="11.5" y2="8"/></svg>
  </button>

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

<script>window.__CONFIG__ = { ytKey: '${YOUTUBE_API_KEY}' };</script>
<script src="/public/js/public.js"></script>

</body>
</html>`;
}

module.exports = { renderPublic };
