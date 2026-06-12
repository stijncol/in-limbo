// Boots the real app with the db layer stubbed by local fixtures, so the
// site can run (and be screenshotted) without reaching the Render database.
// Usage: PORT=3100 node scripts/preview-server.js
const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'preview://stub';
process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'preview';
process.env.STUDENT_PASS = process.env.STUDENT_PASS || 'preview';

const fixtures = require('./fixtures/videos.json');
const thumbsDir = path.join(__dirname, 'fixtures', 'thumbs');

function readThumb(file) {
  try { return fs.readFileSync(path.join(thumbsDir, file)); } catch (e) { return null; }
}

const poolPath = require.resolve('../db/pool');
require.cache[poolPath] = {
  id: poolPath, filename: poolPath, loaded: true,
  exports: { pool: null, initDB: async () => {} }
};

const videosPath = require.resolve('../db/videos');
require.cache[videosPath] = {
  id: videosPath, filename: videosPath, loaded: true,
  exports: {
    getVideoRows: async () => fixtures,
    createVideo: async () => {},
    updateVideo: async () => {},
    deleteVideo: async () => {},
    submitVideo: async () => {},
    approveVideo: async () => {},
    rejectVideo: async () => {},
    getThumb: async (id) => readThumb(id + '.png'),
    getThumbSharp: async (id) => readThumb(id + '-sharp.png'),
    saveThumb: async () => {},
    getThumbStats: async () => ({ total: fixtures.length, baked: fixtures.filter(v => v.has_thumb).length })
  }
};

require('../server.js');
