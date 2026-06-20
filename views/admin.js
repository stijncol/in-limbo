const { ADMIN_USER, ADMIN_PASS } = require('../config');

function renderAdmin(videos) {

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Approved videos still missing a baked thumbnail (the "new" ones to bake)
  const unbakedCount = videos.filter(v => v.status !== 'pending' && v.status !== 'rejected' && !v.has_thumb).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo — admin</title>
<meta name="robots" content="noindex">
<link rel="icon" type="image/png" href="/public/favicon.png">
<link rel="stylesheet" href="/public/css/admin.css">
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

  <div class="form-section">
    <h2>thumbnails</h2>
    <p style="font-size:13px;color:#666;margin-bottom:14px;line-height:1.5;">
      Genereer de dithered thumbnails (blur + scherp) met de standaardinstellingen.
      Dit gebeurt in je browser en kan even duren. Laat dit tabblad open tot het klaar is.
    </p>
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
      <button type="button" id="bake-new-btn" class="btn btn-edit">bake nieuwe thumbnails (${unbakedCount})</button>
      <button type="button" id="bake-all-btn" class="btn" style="background:#fff;color:#555;border-color:#ccc;">alles opnieuw bakken</button>
      <span id="bake-status" style="font-size:13px;color:#666;"></span>
    </div>
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
    <div class="video-item" data-id="${v.id}" data-title="${esc(v.title)}" data-students="${esc(v.students)}" data-year="${v.year}" data-video-id="${v.video_id || v.vimeo_id}" data-video-type="${v.video_type || 'vimeo'}" data-desc="${esc(v.description)}" data-tags-theme="${esc(v.tags_theme||v.tags||'')}" data-tags-medium="${esc(v.tags_medium||'')}" data-sort="${v.sort_order}" data-featured="${v.featured}" data-archived="${v.archived}" data-has-thumb="${v.has_thumb ? '1' : ''}">
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
          ${v.has_thumb ? '' : '<span class="badge no-thumb">geen thumbnail</span>'}
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

<script>window.__CONFIG__ = { user: '${ADMIN_USER}', pass: '${ADMIN_PASS}' };</script>
<script src="/public/js/dither.js?v=20260615f"></script>
<script src="/public/js/admin.js"></script>
</body>
</html>`;
}

module.exports = { renderAdmin };
