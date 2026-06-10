const { Pool } = require('pg');
const { DATABASE_URL } = require('../config');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`CREATE TABLE IF NOT EXISTS videos (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    students TEXT NOT NULL,
    description TEXT NOT NULL,
    video_id TEXT NOT NULL,
    video_type TEXT DEFAULT 'vimeo',
    year INTEGER NOT NULL,
    tags_theme TEXT DEFAULT '',
    tags_medium TEXT DEFAULT '',
    featured INTEGER DEFAULT 1,
    archived INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    status TEXT DEFAULT 'approved',
    created_at TIMESTAMP DEFAULT NOW()
  )`);

  // Migrate existing tables
  try { await pool.query("ALTER TABLE videos ADD COLUMN tags_theme TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN tags_medium TEXT DEFAULT ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN video_type TEXT DEFAULT 'vimeo'"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN video_id TEXT"); } catch(e) {}
  // Migrate old data: copy vimeo_id to video_id, tags to tags_theme
  try { await pool.query("UPDATE videos SET video_id = vimeo_id WHERE video_id IS NULL"); } catch(e) {}
  try { await pool.query("UPDATE videos SET tags_theme = tags WHERE tags_theme = '' AND tags != ''"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN thumb_data BYTEA"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN thumb_settings JSONB"); } catch(e) {}
  try { await pool.query("ALTER TABLE videos ADD COLUMN thumb_sharp BYTEA"); } catch(e) {}
}

module.exports = { pool, initDB };
