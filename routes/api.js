const express = require('express');
const https = require('https');
const router = express.Router();
const { VIMEO_ACCESS_TOKEN } = require('../config');
const { requireAuth, requireStudent } = require('../middleware/auth');
const { getVideoRows, createVideo, updateVideo, deleteVideo, submitVideo, approveVideo, rejectVideo } = require('../db/videos');

function parseVideoUrl(url) {
  const vimeoMatch = (url || '').match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return { id: vimeoMatch[1], type: 'vimeo' };
  const ytMatch = (url || '').match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return { id: ytMatch[1], type: 'youtube' };
  return { id: url, type: 'vimeo' };
}

router.get('/videos', async (req, res) => {
  res.json(await getVideoRows());
});

router.post('/videos', requireAuth, async (req, res) => {
  try {
    const { title, students, tutor, description, video_link, year, tags_theme, tags_medium, featured, archived, sort_order } = req.body;
    const { id, type } = parseVideoUrl(video_link);
    await createVideo({
      title, students, tutor, description, video_id: id, video_type: type,
      year: parseInt(year), tags_theme: tags_theme || '', tags_medium: tags_medium || '',
      featured: featured ? 1 : 0, archived: archived ? 1 : 0, sort_order: parseInt(sort_order) || 0
    });
    res.json({ ok: true });
  } catch(e) { console.error('POST /api/videos error:', e.message); res.status(500).json({ error: e.message }); }
});

router.put('/videos/:id', requireAuth, async (req, res) => {
  try {
    const { title, students, tutor, description, video_link, year, tags_theme, tags_medium, featured, archived, sort_order } = req.body;
    const { id, type } = parseVideoUrl(video_link);
    await updateVideo(req.params.id, {
      title, students, tutor, description, video_id: id, video_type: type,
      year: parseInt(year), tags_theme: tags_theme || '', tags_medium: tags_medium || '',
      featured: featured ? 1 : 0, archived: archived ? 1 : 0, sort_order: parseInt(sort_order) || 0
    });
    res.json({ ok: true });
  } catch(e) { console.error('PUT /api/videos error:', e.message); res.status(500).json({ error: e.message }); }
});

router.delete('/videos/:id', requireAuth, async (req, res) => {
  await deleteVideo(req.params.id);
  res.json({ ok: true });
});

// Student submit — always pending
router.post('/submit', requireStudent, async (req, res) => {
  try {
    const { title, students, description, video_link, year, tags_theme, tags_medium } = req.body;
    const { id, type } = parseVideoUrl(video_link);
    await submitVideo({
      title, students, description, video_id: id, video_type: type,
      year: parseInt(year), tags_theme: tags_theme || '', tags_medium: tags_medium || ''
    });
    res.json({ ok: true });
  } catch(e) { console.error('POST /api/submit error:', e.message); res.status(500).json({ error: e.message }); }
});

// Admin approve/reject
router.put('/videos/:id/approve', requireAuth, async (req, res) => {
  const { featured, archived } = req.body;
  await approveVideo(req.params.id, featured ? 1 : 0, archived ? 1 : 0);
  res.json({ ok: true });
});

router.put('/videos/:id/reject', requireAuth, async (req, res) => {
  await rejectVideo(req.params.id);
  res.json({ ok: true });
});

const vimeoCache = new Map();

router.get('/vimeo/:id', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const token = VIMEO_ACCESS_TOKEN;
  if (!token) return res.json({});
  const id = req.params.id;
  if (vimeoCache.has(id)) return res.json(vimeoCache.get(id));
  const options = {
    hostname: 'api.vimeo.com',
    path: '/videos/' + id,
    headers: { 'Authorization': 'bearer ' + token, 'Accept': 'application/json' },
    agent: false
  };
  const apiReq = https.get(options, (r) => {
    let body = '';
    r.on('data', chunk => { body += chunk; });
    r.on('end', () => {
      console.log('[vimeo proxy]', id, 'status:', r.statusCode);
      if (r.statusCode !== 200) {
        console.log('[vimeo proxy] error body:', body.slice(0, 200));
        return res.json({});
      }
      try {
        const data = JSON.parse(body);
        console.log('[vimeo proxy] width:', data.width, 'duration:', data.duration);
        const result = { duration: data.duration, width: data.width, height: data.height };
        if (result.duration || result.width) vimeoCache.set(id, result);
        res.json(result);
      } catch(e) {
        console.log('[vimeo proxy] parse error:', e.message);
        res.json({});
      }
    });
  });
  apiReq.on('error', (e) => { console.log('[vimeo proxy] request error:', e.message); if (!res.headersSent) res.json({}); });
  apiReq.setTimeout(8000, () => { apiReq.destroy(); console.log('[vimeo proxy] timeout for', id); if (!res.headersSent) res.json({}); });
});

module.exports = router;
