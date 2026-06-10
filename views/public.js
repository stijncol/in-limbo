const { YOUTUBE_API_KEY } = require('../config');

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

  function renderCard(v, isFeatured) {
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@100;200;300;400;500;600;700&display=swap" rel="stylesheet">
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
    background: #ffffff;
    font-family: 'IBM Plex Sans', Helvetica, Arial, sans-serif;
    font-weight: 300;
    color: #111;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    flex: 1;
    width: 100%;
    max-width: 1700px;
    margin: 0 auto;
    padding: 40px 6vw 120px;
    box-sizing: border-box;
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
    display: block;
    position: relative;
  }
  .filters-row .filters-label {
    position: absolute;
    left: -57px;
    top: 7px;
    width: 44px;
    text-align: right;
    display: none;
  }
  .filters.show-all .filters-row .filters-label { display: block; }
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
    white-space: nowrap;
  }
  .filters-medium {
    display: none;
    margin-top: 20px;
    position: relative;
  }
  .filters.show-all .filters-medium {
    display: block;
  }
  .filters-medium .filters-label {
    position: absolute;
    left: -57px;
    top: 7px;
    width: 44px;
    text-align: right;
  }
  .filters-medium .medium-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .filters-extra {
    display: none;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 0;
    margin-top: 6px;
  }
  @keyframes filterFadeIn {
    from { opacity: 0; transform: translateY(-5px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .filters.show-all .filters-extra {
    display: flex;
    animation: filterFadeIn 0.3s ease forwards;
  }
  .filters.show-all .filters-medium {
    animation: filterFadeIn 0.3s ease 0.05s both;
  }
  .filters.show-all .filters-row .filters-label {
    animation: filterFadeIn 0.25s ease forwards;
  }
  .filters button {
    font-family: inherit;
    font-size: 14px;
    font-weight: 400;
    letter-spacing: 0.02em;
    padding: 6px 4px;
    border: none;
    border-radius: 0;
    background: transparent;
    color: #000;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
  }
  .filters button::before { content: "["; opacity: 0.4; margin-right: 1px; }
  .filters button::after { content: "]"; opacity: 0.4; margin-left: 1px; }
  .filters button:hover { color: #1e40af; }
  .filters button:hover::before, .filters button:hover::after { opacity: 0.7; }
  .filters button.active {
    color: #1e40af;
    text-decoration: underline;
    text-underline-offset: 3px;
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
    border: none;
    background: transparent;
    color: #000;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .tag-expand:hover { color: #1e40af; }
  .filters.show-all .tag-expand { display: none; }
  .tag-collapse {
    font-family: inherit;
    font-size: 16px;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    background: transparent;
    color: #000;
    cursor: pointer;
    transition: all 0.2s ease;
    display: none;
    align-items: center;
    justify-content: center;
  }
  .tag-collapse:hover { color: #1e40af; }
  .filters.show-all .tag-collapse { display: flex; }
  /* Prevent phantom flex items in default (row) layout */
  .filters::before, .filters::after { display: none; }
  /* Filter-bar search is hidden on the main view; the inline intro search is used instead */
  .filters-search-wrap {
    display: none;
    flex-shrink: 0;
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
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
    border: 1px solid rgba(0,0,0,0.65);
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
    color: #777;
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
    font-weight: 400;
    text-align: left;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 0.2s ease;
  }
  /* Year is shown inside .card-duration (prepended via JS); the standalone label is hidden */
  .card .card-year { display: none; }
  .card:hover .card-duration { opacity: 1; color: #1e40af; }
  .card:hover .card-title { text-decoration: underline; color: #1e40af; }
  .card:hover .tags span { color: #555; }
  .intro-block {
    grid-column: 1;
    grid-row: 1 / 3;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    padding: 0 20px 0 0;
    transition: opacity 0.25s ease;
  }
  .intro-block .intro-text {
    font-family: inherit;
    font-size: 18px;
    line-height: 1.55;
    color: #111;
  }
  .intro-block .intro-text p {
    margin-bottom: 16px;
  }
  .intro-block .intro-text a {
    color: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-decoration-color: #1e40af;
    text-underline-offset: 4px;
    cursor: pointer;
    transition: color 0.15s, text-decoration-style 0.15s;
  }
  .intro-block .intro-text a:hover,
  .intro-block .intro-text a:focus,
  .intro-block .intro-text a.year-filter.active {
    color: #1e40af;
    text-decoration-style: solid;
  }
  .intro-block .intro-text a.year-filter {
    cursor: pointer;
  }
  .intro-block .intro-text a.year-filter.active { color: #1e40af; text-decoration-style: solid; }
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
    max-width: 1700px;
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
  /* Margin controls — [about] left, scale right, desktop only */
  .margin-about {
    position: absolute;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: inherit;
    font-size: 14px;
    letter-spacing: 0.08em;
    color: #aaa;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    z-index: 10;
    transition: top 0.3s ease, color 0.2s;
    user-select: none;
  }
  .margin-about.active { color: #111; }
  .margin-about:hover { color: #111; }
  #about-panel {
    position: absolute;
    background: #fff;
    border: 1px solid #000;
    padding: 0 20px 20px 20px;
    z-index: 150;
    box-sizing: border-box;
    display: none;
  }
  #about-panel.active { display: block; }
  #about-panel .intro-block {
    display: block;
    padding: 20px 0 0 0;
    grid-column: auto;
    grid-row: auto;
  }
  .margin-scale {
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    z-index: 10;
  }
  .scale-icon-btn {
    background: none;
    border: none;
    padding: 2px;
    cursor: pointer;
    color: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
    user-select: none;
  }
  .scale-icon-btn:disabled { color: #ddd; cursor: default; }
  .scale-grid-icons {
    position: relative;
    width: 24px;
    height: 16px;
    margin: 3px 0;
  }
  .scale-grid-icon {
    position: absolute;
    top: 0;
    left: 0;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: #000;
    display: block;
    line-height: 0;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
    user-select: none;
  }
  .scale-grid-icon.active {
    opacity: 1;
    pointer-events: auto;
  }
  .grid.grid-cols-5 {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 20px 10px;
  }
  .grid.grid-cols-7 {
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 12px 6px;
  }
  .grid.grid-cols-5 .card-title,
  .grid.grid-cols-5 .card-year { font-size: 10px; }
  .grid.grid-cols-7 .card .meta { display: none; }
  .grid.grid-cols-5 .card-duration,
  .grid.grid-cols-7 .card-duration { display: none; }
  @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
  /* Tablet range (iPad / iPad Air landscape ~1024px): the vertical writing-mode +
     rotate(180deg) paints/positions unreliably on iPadOS Safari. Render [about]
     horizontally near the top-left of the page, and stack scale-ctrl horizontally
     near the top-right. Upper bound stays below the M1 MacBook (~1280px CSS)
     so its layout is untouched. */
  @media (min-width: 901px) and (max-width: 1180px) {
    .margin-about {
      writing-mode: horizontal-tb;
      transform: none;
    }
    .margin-scale {
      flex-direction: row;
      gap: 10px;
    }
    .scale-grid-icons { margin: 0 4px; }
  }
  @media (max-width: 900px) {
    .page { padding: 32px 20px 80px; }
    /* row-gap 36px gives absolute-positioned .meta room; column-gap 14px stays tight */
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 36px 14px; }
    .intro-block { grid-column: 1 / -1; grid-row: auto; }
    .margin-about, .margin-scale { display: none; }
    .filters-row { display: grid; grid-template-columns: 52px 1fr; gap: 8px; align-items: start; }
    .filters-row .filters-label { position: static; width: 52px; text-align: left; top: auto; left: auto; }
    .filters-medium { position: static; }
    .filters-medium .filters-label { position: static; width: 52px; text-align: left; top: auto; left: auto; }
    .filters.show-all .filters-medium { display: grid; grid-template-columns: 52px 1fr; gap: 8px; }
    .filters-extra { padding-left: 60px; }
  }
  @media (max-width: 768px) {
    /* Lightbox */
    .lightbox .lb-inner { padding: 0 20px; }
    .lightbox .lb-close { top: -36px; left: 20px; }
    .lightbox .lb-desc-wrap p { column-count: 1; max-height: 180px; }

    /* Screen frame: ::before inside overflow:hidden breaks on mobile browsers;
       use card::after instead (sits outside overflow clipping) */
    .card .thumb::before { display: none; }
    .card::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      aspect-ratio: 16 / 9;
      border: 1px solid rgba(0,0,0,0.65);
      pointer-events: none;
      z-index: 10;
      transition: border-color 0.2s ease;
    }
    .card:hover::after { border-color: #1e40af; }

    /* Card meta: pull into normal flow so it doesn't lap the next card */
    .card .meta { position: static; padding: 6px 0 0; }
    /* Tags: always visible on touch devices (no hover) */
    .card .tags { opacity: 1; pointer-events: auto; }
    /* Title: allow wrapping on narrow columns */
    .card .card-title { white-space: normal; }
    /* Duration label positioned at left:-16px would bleed off-screen; hide it */
    .card-duration { display: none; }

    /* Filters: stack search below tags */
    .filters { flex-direction: column; gap: 10px; margin-bottom: 28px; }
    .filters-search-wrap { padding-top: 0; }
    .filters-search-input { width: 160px; }

    /* Intro text: moved before filters via JS, reset grid padding */
    .intro-block { padding: 0 0 24px; }
    .intro-block .intro-text { font-size: 20px; }

    /* Footer: stack vertically */
    .site-footer { flex-direction: column; align-items: flex-start; gap: 16px; padding: 24px 20px 40px; }
  }
  @media (max-width: 540px) {
    .page { padding: 20px 14px 48px; }
    /* Single column; gap is simple row space between cards (meta is already in flow) */
    .grid { grid-template-columns: 1fr; gap: 28px; }
    /* Intro text slightly smaller on small phones */
    .intro-block .intro-text { font-size: 18px; }
    /* Lightbox: reduce horizontal padding so video fills screen */
    .lightbox .lb-inner { padding: 0 12px; }
    .lightbox .lb-close { left: 12px; top: -32px; }
    /* Footer */
    .site-footer { padding: 20px 14px 32px; }
    /* Archive toggle label: clip overflow on narrow screens */
    .archive-toggle-label { display: none; }
  }
  #dvd-logo {
    position: fixed;
    left: 0; top: 0;
    cursor: grab;
    z-index: 200;
    user-select: none;
    touch-action: none;
    border-radius: 50%;
    pointer-events: auto;
    will-change: transform;
  }
  #dvd-logo img {
    position: absolute;
    top: 0; left: 0;
    width: 100%; height: 100%;
    display: block;
    pointer-events: none;
  }
  #dvd-logo-close {
    position: absolute;
    top: 8px; right: 8px;
    transform: translate(50%, -50%);
    width: 26px; height: 26px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;
    pointer-events: auto;
    z-index: 2;
    line-height: 0;
  }
  #dvd-logo:hover #dvd-logo-close,
  #dvd-logo-close:hover { opacity: 1; }
  @media (max-width: 900px) { #dvd-logo { display: none; } }

</style>
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
  </div>
  </div>
  <div class="archive-toggle" id="archive-toggle" ${archive.length === 0 ? 'style="display:none"' : ''}>
    <button id="archive-btn"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>
    <span class="archive-toggle-label">load the complete archive</span>
  </div>
</div>

<button class="margin-about active" id="about-btn">[about]</button>
<div id="about-panel"></div>
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

<script>
  // Thumbnails + dithering (m1: mono-blue palette via Floyd-Steinberg in Lab space).
  // Unbaked thumbs only — baked thumbs skip this path and stream the pre-rendered PNG.
  const M1_WIDTH = 800;

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

  function ditherImage(img, thumb) {
    const canvas = document.createElement('canvas');
    const w = M1_WIDTH;
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

    // Preprocess: shadow lift, brightness, gamma, contrast
    const raw = ctx.getImageData(0, 0, w, h);
    const pd = raw.data;
    for (let i = 0; i < pd.length; i += 4) {
      let pr = pd[i], pg = pd[i+1], pb = pd[i+2];
      pr = 60 + pr * 195 / 255; pg = 60 + pg * 195 / 255; pb = 60 + pb * 195 / 255;
      pr += 40; pg += 40; pb += 40;
      pr = 255 * Math.pow(Math.max(0, Math.min(255, pr)) / 255, 1 / 1.4);
      pg = 255 * Math.pow(Math.max(0, Math.min(255, pg)) / 255, 1 / 1.4);
      pb = 255 * Math.pow(Math.max(0, Math.min(255, pb)) / 255, 1 / 1.4);
      pr = ((pr / 255 - 0.5) * 0.8 + 0.5) * 255;
      pg = ((pg / 255 - 0.5) * 0.8 + 0.5) * 255;
      pb = ((pb / 255 - 0.5) * 0.8 + 0.5) * 255;
      pd[i]   = Math.max(0, Math.min(255, pr));
      pd[i+1] = Math.max(0, Math.min(255, pg));
      pd[i+2] = Math.max(0, Math.min(255, pb));
    }

    const preProc = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      preProc[i*3]   = pd[i*4];
      preProc[i*3+1] = pd[i*4+1];
      preProc[i*3+2] = pd[i*4+2];
    }

    // Floyd-Steinberg in Lab space against M1_PALETTE.
    // shimmer=true adds per-pixel noise for the hover loop.
    function render(shimmer) {
      const rd = new Float32Array(preProc);
      if (shimmer) {
        for (let i = 0; i < w * h; i++) {
          const n = (Math.random() - 0.5) * 20;
          rd[i*3] += n; rd[i*3+1] += n; rd[i*3+2] += n;
        }
      }
      const outImg = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
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
          if (x + 1 < w) {
            rd[(idx+1)*3] += er*7/16; rd[(idx+1)*3+1] += eg*7/16; rd[(idx+1)*3+2] += eb*7/16;
          }
          if (y + 1 < h && x > 0) {
            rd[(idx+w-1)*3] += er*3/16; rd[(idx+w-1)*3+1] += eg*3/16; rd[(idx+w-1)*3+2] += eb*3/16;
          }
          if (y + 1 < h) {
            rd[(idx+w)*3] += er*5/16; rd[(idx+w)*3+1] += eg*5/16; rd[(idx+w)*3+2] += eb*5/16;
          }
          if (y + 1 < h && x + 1 < w) {
            rd[(idx+w+1)*3] += er*1/16; rd[(idx+w+1)*3+1] += eg*1/16; rd[(idx+w+1)*3+2] += eb*1/16;
          }
          outImg.data[idx*4]   = nr;
          outImg.data[idx*4+1] = ng;
          outImg.data[idx*4+2] = nb;
          outImg.data[idx*4+3] = 255;
        }
      }
      ctx.putImageData(outImg, 0, 0);
    }

    render(false);
    canvas.style.imageRendering = 'pixelated';
    thumb.appendChild(canvas);

    let shimmerActive = false;
    let shimmerFrame = null;
    function shimmerLoop() {
      if (!shimmerActive) return;
      render(true);
      setTimeout(() => { shimmerFrame = requestAnimationFrame(shimmerLoop); }, 120);
    }
    thumb.addEventListener('mouseenter', () => { shimmerActive = true; shimmerLoop(); });
    thumb.addEventListener('mouseleave', () => {
      shimmerActive = false;
      if (shimmerFrame) cancelAnimationFrame(shimmerFrame);
      render(false);
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

  document.querySelectorAll('.card[data-video-id]').forEach(card => {
    const id = card.dataset.videoId;
    const type = card.dataset.videoType;
    const thumb = card.querySelector('.thumb');
    const isBaked = !!(thumb && thumb.dataset.baked === 'true');
    const img = card.querySelector('.baked-blur') || card.querySelector('img');
    img.crossOrigin = 'anonymous';

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
        try { ditherImage(img, thumb); } catch(e) {}
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
      const ytKey = '${YOUTUBE_API_KEY}';
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
  let activeFilter = 'all';
  let activeType = 'tag';
  let userArchiveOpen = false;

  // Dynamically limit visible tags so + always stays on the first line
  const filtersRow = document.getElementById('filters-row');
  const themeTags = filtersRow.querySelector('.theme-tags');
  const filtersExtra = document.getElementById('filters-extra');
  const expandBtn = document.getElementById('tag-expand');

  function enforceFirstLine() {
    if (filtersBar.classList.contains('show-all')) return;
    // Reset: move all filtersExtra buttons back into themeTags before expandBtn
    Array.from(filtersExtra.querySelectorAll('button[data-filter]')).forEach(btn => {
      themeTags.insertBefore(btn, expandBtn);
    });
    // Use the "all" button as the baseline for line 1
    const allBtn = themeTags.querySelector('button[data-filter="all"]');
    const firstTop = allBtn ? allBtn.offsetTop : 0;
    // Move any tags that wrapped to filtersExtra
    let hasOverflow = false;
    Array.from(themeTags.querySelectorAll('button[data-filter]:not([data-filter="all"])')).forEach(btn => {
      if (btn.offsetTop > firstTop) { filtersExtra.appendChild(btn); hasOverflow = true; }
    });
    const hasMediumTags = !!document.querySelector('.medium-tags button[data-filter]');
    expandBtn.style.display = (!hasOverflow && !hasMediumTags) ? 'none' : '';
    // Keep pulling the last visible tag out until + fits on line 1
    let guard = 50;
    while (expandBtn.offsetTop > firstTop && guard-- > 0) {
      const visible = Array.from(themeTags.querySelectorAll('button[data-filter]:not([data-filter="all"])'));
      if (!visible.length) break;
      filtersExtra.insertBefore(visible[visible.length - 1], filtersExtra.firstChild);
    }
  }

  // Run after first paint, after fonts are ready, and on any container resize
  setTimeout(() => requestAnimationFrame(enforceFirstLine), 0);
  document.fonts.ready.then(() => requestAnimationFrame(enforceFirstLine));
  new ResizeObserver(() => { if (!filtersBar.classList.contains('show-all')) requestAnimationFrame(enforceFirstLine); }).observe(filtersRow);

  // Tag expand toggle
  document.getElementById('tag-expand').addEventListener('click', () => {
    if (activeType === 'search') {
      clearSearchInputs();
      applyFilter('all', 'tag');
    }
    filtersBar.classList.add('show-all');
    requestAnimationFrame(positionScaleCtrl);
  });

  document.getElementById('tag-collapse').addEventListener('click', () => {
    filtersBar.classList.remove('show-all');
    requestAnimationFrame(() => { enforceFirstLine(); positionScaleCtrl(); });
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
    if (value === 'all') { filtersBar.classList.remove('show-all'); requestAnimationFrame(positionScaleCtrl); }
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

    // Show/hide intro block + archive toggle when filtering
    const isFiltered = value !== 'all';
    if (introBlock) introBlock.style.display = (isFiltered || !aboutActive || scaleIndex > 0) ? 'none' : '';
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
      if (introBlock && aboutActive && scaleIndex === 0) introBlock.style.display = '';
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
  // Grid scale control (desktop only — hidden on mobile via CSS)
  const scaleDown = document.getElementById('scale-down');
  const scaleUp = document.getElementById('scale-up');
  const scaleSteps = [3, 5, 7];
  let scaleIndex = 0;
  var aboutActive = true;

  function positionScaleCtrl() {
    var ctrl = document.getElementById('scale-ctrl');
    var aboutBtn = document.getElementById('about-btn');
    var gridEl = document.querySelector('.grid');
    if (!gridEl || window.innerWidth <= 900) return;
    var gridRect = gridEl.getBoundingClientRect();
    var gridTop = Math.round(gridRect.top + 10);
    // Tablet range: place controls horizontally above the grid (CSS removes the
    // vertical writing-mode in this range — see media query for 901-1180px).
    var isTablet = window.innerWidth <= 1180;
    // Never let the controls drift more than this far from the grid's edge.
    // Without a cap, large screens centre the button in the huge empty margin.
    var MAX_GAP = 80;

    if (ctrl) {
      var rightGap = window.innerWidth - gridRect.right;
      if (isTablet) {
        // Anchor at the page's top padding line, aligned to the grid's right edge.
        ctrl.style.right = Math.max(4, Math.round(rightGap)) + 'px';
        ctrl.style.top = '12px';
      } else {
        var ctrlCentered = (rightGap - ctrl.offsetWidth) / 2;
        var ctrlMin = Math.max(4, rightGap - ctrl.offsetWidth - MAX_GAP);
        ctrl.style.right = Math.round(Math.max(ctrlMin, ctrlCentered)) + 'px';
        ctrl.style.top = gridTop + 'px';
      }
    }
    if (aboutBtn) {
      var leftGap = gridRect.left;
      if (isTablet) {
        aboutBtn.style.left = Math.max(4, Math.round(leftGap)) + 'px';
        aboutBtn.style.top = (12 + window.scrollY) + 'px';
      } else {
        var aboutCentered = (leftGap - aboutBtn.offsetWidth) / 2;
        var aboutMin = Math.max(4, leftGap - aboutBtn.offsetWidth - MAX_GAP);
        aboutBtn.style.left = Math.round(Math.max(aboutMin, aboutCentered)) + 'px';
        aboutBtn.style.top = Math.round(gridRect.top + window.scrollY + 10) + 'px';
      }
    }
  }
  window.addEventListener('resize', positionScaleCtrl);
  window.addEventListener('load', function() { requestAnimationFrame(positionScaleCtrl); });
  requestAnimationFrame(positionScaleCtrl);

  function applyScale(idx) {
    const prev = scaleIndex;
    scaleIndex = idx;

    // FLIP — First: snapshot every visible card's position and size
    const cards = Array.from(grid.querySelectorAll('.card:not(.hidden)'))
      .filter(c => getComputedStyle(c).display !== 'none');
    const firstRects = cards.map(c => c.getBoundingClientRect());

    // Intro block going away: remove from flow NOW so lastRects are correct.
    // (Deferring display:none causes a mid-animation reflow that breaks the FLIP.)
    if (introBlock && idx !== 0 && prev === 0) {
      introBlock.style.display = 'none';
      if (aboutPanel) aboutPanel.classList.remove('active');
      aboutActive = false;
      var aboutBtn = document.getElementById('about-btn');
      if (aboutBtn) aboutBtn.classList.remove('active');
    }
    // Intro block coming back: put it in the DOM before recording lastRects
    // so cards land in their correct final positions with the block present.
    if (introBlock && idx === 0 && prev !== 0) {
      if (aboutPanel) aboutPanel.classList.remove('active');
      if (aboutActive) { introBlock.style.opacity = '0'; introBlock.style.display = ''; }
    }

    // Apply grid change instantly
    grid.classList.toggle('grid-cols-5', idx === 1);
    grid.classList.toggle('grid-cols-7', idx === 2);
    document.querySelectorAll('.scale-grid-icon').forEach(function(btn, i) {
      btn.classList.toggle('active', i === idx);
    });
    if (scaleDown) scaleDown.disabled = idx === 0;
    if (scaleUp) scaleUp.disabled = idx === scaleSteps.length - 1;
    requestAnimationFrame(positionScaleCtrl);

    // FLIP — Last: read new positions (forces reflow so layout is committed)
    const lastRects = cards.map(c => c.getBoundingClientRect());

    // Fade intro in after positions are captured
    if (introBlock && idx === 0 && prev !== 0 && aboutActive) {
      requestAnimationFrame(function() { introBlock.style.opacity = '1'; });
    }

    // FLIP — Invert + Play via Web Animations API:
    // animate FROM the old position/size TO the new one (fill:none = no style pollution)
    cards.forEach(function(card) { card.style.willChange = 'transform'; });
    cards.forEach(function(card, i) {
      const f = firstRects[i], l = lastRects[i];
      if (!l.width) { card.style.willChange = ''; return; }
      const dx = f.left - l.left;
      const dy = f.top  - l.top;
      const sx = f.width  / l.width;
      const sy = f.height / l.height;
      const anim = card.animate(
        [
          { transformOrigin: '0 0', transform: 'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + sx + ',' + sy + ')' },
          { transformOrigin: '0 0', transform: 'none' }
        ],
        { duration: 600, easing: 'cubic-bezier(0.25,0.46,0.45,0.94)', fill: 'none' }
      );
      anim.finished.then(function() { card.style.willChange = ''; });
    });
  }

  if (scaleDown) scaleDown.addEventListener('click', () => applyScale(Math.max(0, scaleIndex - 1)));
  if (scaleUp) scaleUp.addEventListener('click', () => applyScale(Math.min(scaleSteps.length - 1, scaleIndex + 1)));
  document.querySelectorAll('.scale-grid-icon').forEach(function(btn) {
    btn.addEventListener('click', function() { applyScale(parseInt(btn.dataset.scale, 10)); });
  });

  // About panel (fixed overlay for compact grid modes)
  var aboutPanel = document.getElementById('about-panel');
  if (aboutPanel && introBlock) {
    var introClone = introBlock.cloneNode(true);
    introClone.removeAttribute('id');
    aboutPanel.appendChild(introClone);
  }

  function positionAboutPanel() {
    if (!aboutPanel) return;
    var gridEl = document.querySelector('.grid');
    if (!gridEl) return;
    var gridRect = gridEl.getBoundingClientRect();
    var colW = Math.round(gridRect.width / 3 - 14);
    aboutPanel.style.left  = Math.round(gridRect.left + window.scrollX) + 'px';
    aboutPanel.style.top   = Math.round(gridRect.top + window.scrollY) + 'px';
    aboutPanel.style.width = colW + 'px';
  }

  // About toggle — floating panel in compact modes, in-grid block in 3-col
  var aboutBtn = document.getElementById('about-btn');
  if (aboutBtn) {
    aboutBtn.addEventListener('click', function() {
      aboutActive = !aboutActive;
      aboutBtn.classList.toggle('active', aboutActive);
      if (scaleIndex > 0) {
        if (aboutActive) { positionAboutPanel(); aboutPanel.classList.add('active'); }
        else { aboutPanel.classList.remove('active'); }
      } else {
        if (aboutPanel) aboutPanel.classList.remove('active');
        if (introBlock) {
          if (aboutActive) {
            introBlock.style.opacity = '0';
            introBlock.style.display = '';
            requestAnimationFrame(function() {
              introBlock.style.opacity = '1';
              requestAnimationFrame(positionScaleCtrl);
            });
          } else {
            introBlock.style.display = 'none';
            requestAnimationFrame(positionScaleCtrl);
          }
        }
      }
    });
  }
  window.addEventListener('resize', positionAboutPanel);

  // On mobile: move intro block above the filter tags so reading order is
  // intro → tags → cards instead of tags → intro → cards
  if (window.innerWidth <= 768 && introBlock && filtersBar) {
    filtersBar.parentNode.insertBefore(introBlock, filtersBar);
  }

  // Prepend year to duration label (year column is hidden on the main view)
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

  // DVD screensaver logo
  (function() {
    var wrap = document.createElement('div');
    wrap.id = 'dvd-logo';
    document.body.appendChild(wrap);

    var logoBase = document.createElement('img');
    logoBase.src = '/public/inlimbo-logo2.png';
    logoBase.draggable = false;
    logoBase.style.opacity = '1';

    var logoSel = document.createElement('img');
    logoSel.src = '/public/inlimbo-logo2_selected.png';
    logoSel.draggable = false;
    logoSel.style.opacity = '0';
    logoSel.style.transition = 'opacity 0.5s';

    wrap.appendChild(logoBase);
    wrap.appendChild(logoSel);

    var closeBtn = document.createElement('div');
    closeBtn.id = 'dvd-logo-close';

    var iconPause = '<svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="white" stroke="#000" stroke-width="0.5"/><rect x="5.5" y="5" width="2" height="6" rx="0.5" fill="#000"/><rect x="8.5" y="5" width="2" height="6" rx="0.5" fill="#000"/></svg>';
    var iconPlay  = '<svg width="26" height="26" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="white" stroke="#000" stroke-width="0.5"/><polygon points="6.5,5 12,8 6.5,11" fill="#000"/></svg>';

    closeBtn.innerHTML = iconPause;
    closeBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (paused) {
        paused = false;
        closeBtn.innerHTML = iconPause;
      }
    });
    wrap.appendChild(closeBtn);

    var isSelected = false;

    function fadeTo(sel, duration) {
      logoSel.style.transition = 'opacity ' + (duration || 0.5) + 's';
      logoSel.style.opacity = sel ? '1' : '0';
      isSelected = sel;
      if (!dragging) wrap.style.cursor = sel ? 'pointer' : 'grab';
    }

    wrap.addEventListener('mousemove', function(e) {
      var rect = wrap.getBoundingClientRect();
      var dx = e.clientX - (rect.left + rect.width / 2);
      var dy = e.clientY - (rect.top  + rect.height / 2);
      var inCenter = Math.sqrt(dx*dx + dy*dy) < rect.width * 0.32;
      if (inCenter !== isSelected) fadeTo(inCenter, 0.5);
    });
    wrap.addEventListener('mouseleave', function() { fadeTo(false, 0.5); });
    wrap.addEventListener('click', function() {
      if (!isSelected) return;
      if (typeof aboutActive !== 'undefined' && !aboutActive) {
        var btn = document.getElementById('about-btn');
        if (btn) btn.click();
      }
      if (typeof applyFilter === 'function') applyFilter('all', 'tag');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    var introEl = document.getElementById('intro-block');
    var size = introEl ? Math.round(introEl.offsetWidth * 7 / 16) : 158;
    wrap.style.width  = size + 'px';
    wrap.style.height = size + 'px';

    var margin = 24;
    var startRect = introEl ? introEl.getBoundingClientRect() : { left: 40, top: 120 };
    var x = startRect.left + margin;
    var y = startRect.top  + margin;

    var speed = 0.78;
    var vx = speed;
    var vy = speed * 0.65;

    var hovering = false;
    var dragging = false;
    var paused = false;
    var dragOffX = 0, dragOffY = 0;

    document.addEventListener('mousemove', function(e) {
      if (wrap.style.display === 'none') return;
      if (dragging) {
        x = e.clientX - dragOffX;
        y = e.clientY - dragOffY;
        return;
      }
      var rect = wrap.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var dx = e.clientX - cx;
      var dy = e.clientY - cy;
      hovering = (dx*dx + dy*dy) < Math.pow(rect.width / 2 + 40, 2);
    }, { passive: true });

    wrap.addEventListener('mousedown', function(e) {
      if (e.target === closeBtn || closeBtn.contains(e.target)) return;
      dragging = true;
      paused = false;
      dragOffX = e.clientX - x;
      dragOffY = e.clientY - y;
      wrap.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      paused = true;
      closeBtn.innerHTML = iconPlay;
      wrap.style.cursor = isSelected ? 'pointer' : 'grab';
    });

    var lastTs = 0;
    function tick(ts) {
      var dt = lastTs ? Math.min(ts - lastTs, 50) : 16.667;
      lastTs = ts;
      var scale = dt / 16.667;
      var minX = 0;
      var maxX = Math.max(0, window.innerWidth - size);
      var minY = 0;
      var maxY = Math.max(0, window.innerHeight - size);
      if (!hovering && !dragging && !paused) {
        x += vx * scale;
        y += vy * scale;
        if (x <= minX) { x = minX; vx =  Math.abs(vx); }
        if (x >= maxX) { x = maxX; vx = -Math.abs(vx); }
        if (y <= minY) { y = minY; vy =  Math.abs(vy); }
        if (y >= maxY) { y = maxY; vy = -Math.abs(vy); }
      }
      x = Math.min(Math.max(x, minX), maxX);
      y = Math.min(Math.max(y, minY), maxY);
      wrap.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);

  })();
</script>

</body>
</html>`;
}

module.exports = { renderPublic };
