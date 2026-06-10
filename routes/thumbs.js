const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getThumb, getThumbSharp, saveThumb } = require('../db/videos');

router.get('/:id', async (req, res) => {
  try {
    const thumb = await getThumb(req.params.id);
    if (!thumb) return res.status(404).send('Not found');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(thumb);
  } catch(e) { res.status(500).send('Error'); }
});

router.get('/:id/sharp', async (req, res) => {
  try {
    const thumb = await getThumbSharp(req.params.id);
    if (!thumb) return res.status(404).send('Not found');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(thumb);
  } catch(e) { res.status(500).send('Error'); }
});

router.post('/:id', requireAuth, async (req, res) => {
  try {
    const { blurData, sharpData, imageData, settings } = req.body;
    const blurBase64 = (blurData || imageData || '').replace(/^data:image\/png;base64,/, '');
    if (!blurBase64) return res.status(400).json({ error: 'blurData required' });
    const blurBuf = Buffer.from(blurBase64, 'base64');
    const sharpBuf = sharpData ? Buffer.from(sharpData.replace(/^data:image\/png;base64,/, ''), 'base64') : null;
    await saveThumb(req.params.id, blurBuf, sharpBuf, settings);
    res.json({ ok: true });
  } catch(e) { console.error('POST /thumb error:', e.message); res.status(500).json({ error: e.message }); }
});

module.exports = router;
