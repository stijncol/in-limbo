const { ADMIN_USER, ADMIN_PASS } = require('../config');

function renderAdmin(videos) {

  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return `<!DOCTYPE html>
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
</html>`;
}

module.exports = { renderAdmin };
