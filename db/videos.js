const { pool } = require('./pool');

async function getVideoRows() {
  const result = await pool.query('SELECT *, thumb_data IS NOT NULL AS has_thumb FROM videos ORDER BY sort_order ASC, id DESC');
  return result.rows.map(r => { const row = Object.assign({}, r); delete row.thumb_data; return row; });
}

// v: { title, students, description, video_id, video_type, year, tags_theme, tags_medium, featured, archived, sort_order }
// values already coerced by the caller
async function createVideo(v) {
  await pool.query(
    `INSERT INTO videos (title, students, description, video_id, video_type, vimeo_id, year, tags_theme, tags_medium, featured, archived, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [v.title, v.students, v.description, v.video_id, v.video_type, v.video_id, v.year, v.tags_theme, v.tags_medium, v.featured, v.archived, v.sort_order]);
}

async function updateVideo(id, v) {
  await pool.query(
    `UPDATE videos SET title=$1, students=$2, description=$3, video_id=$4, video_type=$5, vimeo_id=$6, year=$7, tags_theme=$8, tags_medium=$9, featured=$10, archived=$11, sort_order=$12 WHERE id=$13`,
    [v.title, v.students, v.description, v.video_id, v.video_type, v.video_id, v.year, v.tags_theme, v.tags_medium, v.featured, v.archived, v.sort_order, id]);
}

async function deleteVideo(id) {
  await pool.query('DELETE FROM videos WHERE id=$1', [id]);
}

// Student submissions always enter as non-featured, non-archived, pending
async function submitVideo(v) {
  await pool.query(
    `INSERT INTO videos (title, students, description, video_id, video_type, vimeo_id, year, tags_theme, tags_medium, featured, archived, sort_order, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,999,'pending')`,
    [v.title, v.students, v.description, v.video_id, v.video_type, v.video_id, v.year, v.tags_theme, v.tags_medium]);
}

async function approveVideo(id, featured, archived) {
  await pool.query('UPDATE videos SET status=$1, featured=$2, archived=$3 WHERE id=$4',
    ['approved', featured, archived, id]);
}

async function rejectVideo(id) {
  await pool.query('UPDATE videos SET status=$1 WHERE id=$2', ['rejected', id]);
}

async function getThumb(id) {
  const result = await pool.query('SELECT thumb_data FROM videos WHERE id=$1', [id]);
  return result.rows[0] ? result.rows[0].thumb_data : null;
}

async function getThumbSharp(id) {
  const result = await pool.query('SELECT thumb_sharp FROM videos WHERE id=$1', [id]);
  return result.rows[0] ? result.rows[0].thumb_sharp : null;
}

async function saveThumb(id, blurBuf, sharpBuf, settings) {
  if (sharpBuf) {
    await pool.query('UPDATE videos SET thumb_data=$1, thumb_sharp=$2, thumb_settings=$3 WHERE id=$4',
      [blurBuf, sharpBuf, settings ? JSON.stringify(settings) : null, id]);
  } else {
    await pool.query('UPDATE videos SET thumb_data=$1, thumb_settings=$2 WHERE id=$3',
      [blurBuf, settings ? JSON.stringify(settings) : null, id]);
  }
}

// Startup log: how many approved videos have a baked thumbnail
async function getThumbStats() {
  const r = await pool.query('SELECT COUNT(*) AS total, COUNT(thumb_data) AS baked FROM videos WHERE status=$1 OR status IS NULL', ['approved']);
  return r.rows[0];
}

module.exports = { getVideoRows, createVideo, updateVideo, deleteVideo, submitVideo, approveVideo, rejectVideo, getThumb, getThumbSharp, saveThumb, getThumbStats };
