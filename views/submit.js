const { STUDENT_USER, STUDENT_PASS } = require('../config');

function renderSubmit() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo — submit</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: inherit;
    background: #fff;
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
    max-width: 600px;
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
  textarea { resize: vertical; min-height: 120px; }
  .row { display: flex; gap: 16px; }
  .row > div { flex: 1; }
  button[type="submit"] {
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
  button[type="submit"]:hover { background: #333; }
  .success {
    padding: 16px 20px;
    background: #f0faf0;
    border: 1px solid #c0e0c0;
    color: #2a6e2a;
    font-size: 14px;
    margin-bottom: 24px;
    max-width: 600px;
    display: none;
  }
  .success.show { display: block; }
  .note {
    font-size: 12px;
    color: #999;
    margin-top: 12px;
    line-height: 1.5;
  }
</style>
</head>
<body>
  <h1>in limbo</h1>
  <div class="subtitle">submit your work &middot; <a href="/">← back to archive</a></div>

  <div class="success" id="success-msg">
    Your video has been submitted and is awaiting review. You'll see it on the archive once it's been approved.
  </div>

  <div class="form-section">
    <h2>submit a video</h2>
    <form id="submit-form">
      <label>title</label>
      <input type="text" name="title" required>

      <div class="row">
        <div>
          <label>student(s)</label>
          <input type="text" name="students" placeholder="Name & Name" required>
        </div>
        <div>
          <label>year</label>
          <input type="number" name="year" min="2020" max="2030" value="2026" required>
        </div>
      </div>

      <label>video link (Vimeo or YouTube)</label>
      <input type="text" name="video_link" placeholder="https://vimeo.com/123456789 or https://youtu.be/..." required>

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
  const authHeader = 'Basic ' + btoa('${STUDENT_USER}:${STUDENT_PASS}');
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
</script>
</body>
</html>`;
}

module.exports = { renderSubmit };
