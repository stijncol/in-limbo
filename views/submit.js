const { STUDENT_USER, STUDENT_PASS } = require('../config');

function renderSubmit() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>in limbo — submit</title>
<link rel="stylesheet" href="/public/css/submit.css">
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

<script>window.__CONFIG__ = { user: '${STUDENT_USER}', pass: '${STUDENT_PASS}' };</script>
<script src="/public/js/submit.js"></script>
</body>
</html>`;
}

module.exports = { renderSubmit };
