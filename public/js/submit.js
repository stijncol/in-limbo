  const authHeader = 'Basic ' + btoa(window.__CONFIG__.user + ':' + window.__CONFIG__.pass);
  document.getElementById('submit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      title: fd.get('title'),
      students: fd.get('students'),
      year: fd.get('year'),
      video_link: fd.get('video_link'),
      description: fd.get('description'),
      tags_theme: fd.get('tags_theme'),
      tags_medium: fd.get('tags_medium')
    };
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      document.getElementById('success-msg').classList.add('show');
      e.target.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
