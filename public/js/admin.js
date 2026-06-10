  const authHeader = 'Basic ' + btoa(window.__CONFIG__.user + ':' + window.__CONFIG__.pass);

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
