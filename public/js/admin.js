  const authHeader = 'Basic ' + btoa(window.__CONFIG__.user + ':' + window.__CONFIG__.pass);

  document.getElementById('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      students: fd.get('students'),
      tutor: fd.get('tutor'),
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
    document.getElementById('edit-tutor').value = item.dataset.tutor || '';
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

  // ── thumbnail baking ──────────────────────────────────────
  // Bakes the dithered thumbnails (blur + sharp) client-side with the shared
  // pipeline in dither.js, using the canonical DEFAULT_DITHER_CFG, then POSTs
  // them to /thumb/:id. CORS-reads the source thumbnail from YouTube/Vimeo.
  function bakeTargets(onlyNew) {
    return [...document.querySelectorAll('.video-item[data-video-id]')].filter((it) => {
      if (!it.dataset.videoId) return false;
      return onlyNew ? it.dataset.hasThumb !== '1' : true;
    });
  }

  async function bakeItem(item) {
    const id = item.dataset.id;
    const vid = item.dataset.videoId;
    const vtype = item.dataset.videoType || 'vimeo';
    const img = await loadSourceThumb(vid, vtype);
    const out = bakeImage(img); // DEFAULT_DITHER_CFG
    const r = await fetch('/thumb/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify({ blurData: out.blurData, sharpData: out.sharpData, settings: DEFAULT_DITHER_CFG })
    });
    if (!r.ok) throw new Error('save failed (' + r.status + ')');
    item.dataset.hasThumb = '1';
    const badge = item.querySelector('.badge.no-thumb');
    if (badge) badge.remove();
  }

  async function runBake(onlyNew, btn) {
    const targets = bakeTargets(onlyNew);
    const status = document.getElementById('bake-status');
    const newBtn = document.getElementById('bake-new-btn');
    const allBtn = document.getElementById('bake-all-btn');
    if (!targets.length) { status.textContent = 'niets te bakken.'; return; }
    if (!onlyNew && !confirm('Alle ' + targets.length + ' thumbnails opnieuw bakken?')) return;
    newBtn.disabled = true; allBtn.disabled = true;
    let done = 0, failed = 0;
    for (const item of targets) {
      status.textContent = 'bakken ' + (done + failed + 1) + '/' + targets.length + '… (' + (item.dataset.title || item.dataset.videoId) + ')';
      try { await bakeItem(item); done++; }
      catch (e) { failed++; console.error('bake failed for', item.dataset.id, e); }
    }
    status.textContent = '✓ ' + done + ' gebakken' + (failed ? ', ' + failed + ' mislukt (zie console)' : '') + '.';
    newBtn.textContent = 'bake nieuwe thumbnails (' + bakeTargets(true).length + ')';
    newBtn.disabled = false; allBtn.disabled = false;
  }

  document.getElementById('bake-new-btn').addEventListener('click', function () { runBake(true, this); });
  document.getElementById('bake-all-btn').addEventListener('click', function () { runBake(false, this); });

  document.getElementById('edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const body = {
      title: fd.get('title'),
      students: fd.get('students'),
      tutor: fd.get('tutor'),
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
