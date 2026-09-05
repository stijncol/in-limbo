const { pool } = require('./pool');

// ── in-memory cache ───────────────────────────────────────────────────────
// The archive changes a handful of times a year, but every page view used to
// ask Postgres for all the rows, and every thumbnail for its blob. That made
// the site exactly as available as the database at that instant: one hiccup
// and every visitor got an error page.
//
// So it is read once and kept here. Writes clear it, so an edit in the admin
// panel is visible immediately. The TTL is checked lazily, on read, rather
// than on a timer: a timer would poll the database around the clock, which is
// precisely what stops a serverless instance from ever idling.
const TTL_MS = 15 * 60 * 1000;

let rows = null;          // last good row list — kept even when stale
let rowsAt = 0;           // when it was fetched; 0 means "refetch on next read"
let rowsInFlight = null;  // collapses a burst of concurrent misses into one query
const thumbs = new Map(); // 'id' | 'id:sharp' -> Buffer | null

// Marks the list as needing a refetch WITHOUT discarding it. These are two
// different things, and conflating them is a trap: if invalidating threw the
// copy away, then an edit followed by a database outage would leave nothing to
// fall back on — exactly the case this cache exists for. The stale copy can
// briefly outlive a deleted film; that self-corrects on the next good read,
// and it beats showing everyone an error page.
function invalidateRows() { rowsAt = 0; }
function invalidateThumbs(id) { thumbs.delete(String(id)); thumbs.delete(id + ':sharp'); }

async function fetchRows() {
  const result = await pool.query('SELECT *, thumb_data IS NOT NULL AS has_thumb FROM videos ORDER BY sort_order ASC, id DESC');
  return result.rows.map(r => { const row = Object.assign({}, r); delete row.thumb_data; return row; });
}

async function getVideoRows() {
  if (rows && Date.now() - rowsAt < TTL_MS) return rows;
  if (!rowsInFlight) {
    rowsInFlight = fetchRows()
      .then(r => { rows = r; rowsAt = Date.now(); return r; })
      .finally(() => { rowsInFlight = null; });
  }
  try {
    return await rowsInFlight;
  } catch (e) {
    // A refresh that fails is not a reason to take the site down: keep serving
    // the last good copy. Only a cold start with nothing cached can still
    // fail, and then there is genuinely nothing to show.
    if (rows) {
      console.error('getVideoRows failed, serving the cached copy:', e.message);
      return rows;
    }
    throw e;
  }
}

// Warm the cache at startup so the first visitor does not pay for the first
// query. Failure here is not fatal — the next request simply tries again.
async function warmCache() {
  try { await getVideoRows(); } catch (e) { console.error('cache warm failed:', e.message); }
}

// v: { title, students, tutor, description, video_id, video_type, year, tags_theme, tags_medium, featured, archived, sort_order }
// values already coerced by the caller
async function createVideo(v) {
  await pool.query(
    `INSERT INTO videos (title, students, tutor, description, video_id, video_type, vimeo_id, year, tags_theme, tags_medium, featured, archived, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [v.title, v.students, v.tutor || '', v.description, v.video_id, v.video_type, v.video_id, v.year, v.tags_theme, v.tags_medium, v.featured, v.archived, v.sort_order]);
  invalidateRows();
}

async function updateVideo(id, v) {
  await pool.query(
    `UPDATE videos SET title=$1, students=$2, tutor=$3, description=$4, video_id=$5, video_type=$6, vimeo_id=$7, year=$8, tags_theme=$9, tags_medium=$10, featured=$11, archived=$12, sort_order=$13 WHERE id=$14`,
    [v.title, v.students, v.tutor || '', v.description, v.video_id, v.video_type, v.video_id, v.year, v.tags_theme, v.tags_medium, v.featured, v.archived, v.sort_order, id]);
  invalidateRows();
}

async function deleteVideo(id) {
  await pool.query('DELETE FROM videos WHERE id=$1', [id]);
  invalidateRows();
  invalidateThumbs(id);
}

// Student submissions always enter as non-featured, non-archived, pending
async function submitVideo(v) {
  await pool.query(
    `INSERT INTO videos (title, students, description, video_id, video_type, vimeo_id, year, tags_theme, tags_medium, featured, archived, sort_order, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,999,'pending')`,
    [v.title, v.students, v.description, v.video_id, v.video_type, v.video_id, v.year, v.tags_theme, v.tags_medium]);
  invalidateRows();
}

async function approveVideo(id, featured, archived) {
  await pool.query('UPDATE videos SET status=$1, featured=$2, archived=$3 WHERE id=$4',
    ['approved', featured, archived, id]);
  invalidateRows();
}

async function rejectVideo(id) {
  await pool.query('UPDATE videos SET status=$1 WHERE id=$2', ['rejected', id]);
  invalidateRows();
}

// Blobs never change without a re-bake, and a re-bake clears them, so these
// are cached without a TTL. `column` is one of two literals chosen here, never
// anything that came in from a request. Total size is bounded by the archive:
// two blobs per film, around 68 KB each.
async function cachedThumb(key, column, id) {
  if (thumbs.has(key)) return thumbs.get(key);
  const result = await pool.query('SELECT ' + column + ' FROM videos WHERE id=$1', [id]);
  const buf = result.rows[0] ? result.rows[0][column] : null;
  thumbs.set(key, buf);
  return buf;
}

async function getThumb(id) {
  return cachedThumb(String(id), 'thumb_data', id);
}

async function getThumbSharp(id) {
  return cachedThumb(id + ':sharp', 'thumb_sharp', id);
}

async function saveThumb(id, blurBuf, sharpBuf, settings) {
  if (sharpBuf) {
    await pool.query('UPDATE videos SET thumb_data=$1, thumb_sharp=$2, thumb_settings=$3 WHERE id=$4',
      [blurBuf, sharpBuf, settings ? JSON.stringify(settings) : null, id]);
  } else {
    await pool.query('UPDATE videos SET thumb_data=$1, thumb_settings=$2 WHERE id=$3',
      [blurBuf, settings ? JSON.stringify(settings) : null, id]);
  }
  // has_thumb flips on the first bake, so the row list is stale too
  invalidateRows();
  invalidateThumbs(id);
}

// Startup log: how many approved videos have a baked thumbnail
async function getThumbStats() {
  const r = await pool.query('SELECT COUNT(*) AS total, COUNT(thumb_data) AS baked FROM videos WHERE status=$1 OR status IS NULL', ['approved']);
  return r.rows[0];
}

module.exports = { getVideoRows, createVideo, updateVideo, deleteVideo, submitVideo, approveVideo, rejectVideo, getThumb, getThumbSharp, saveThumb, getThumbStats, warmCache };
