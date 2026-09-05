const { Pool } = require('pg');
const { DATABASE_URL } = require('../config');

// How to speak TLS to whichever database DATABASE_URL points at.
//
// This got it wrong once, so the rule is now deliberately conservative: every
// URL that worked before keeps its exact old behaviour, and TLS is only turned
// on where the connection asks for it.
//
// The trap was Render's INTERNAL hostname. On Render itself the URL is
// `@dpg-xxxxx-a/dbname` with no domain in it at all, so a check for
// "render.com" missed it, strict verification kicked in, and Render's
// self-signed certificate failed the handshake with DEPTH_ZERO_SELF_SIGNED_CERT
// — a crash loop on boot, with an error that never says the word TLS.
function sslFor(url) {
  // Neon and most hosted providers say so in the URL and have real certificates.
  if (/[?&]sslmode=(require|verify-ca|verify-full)/.test(url)) return true;
  if (/neon\.tech/.test(url)) return true;
  // Render's external hostname: TLS, but its certificate cannot be verified.
  if (/render\.com/.test(url)) return { rejectUnauthorized: false };
  // Everything else — Render's internal dpg-… host, a database on this
  // machine — connects exactly as it did before.
  return false;
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslFor(DATABASE_URL)
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
  try { await pool.query("ALTER TABLE videos ADD COLUMN tutor TEXT DEFAULT ''"); } catch(e) {}
}

module.exports = { pool, initDB, sslFor };
