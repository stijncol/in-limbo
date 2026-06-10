// All environment configuration in one place.
// Fallbacks preserve the pre-refactor hardcoded values so existing deploys
// keep working. Once ADMIN_PASS / STUDENT_PASS / DATABASE_URL are set in the
// Render dashboard, the fallbacks here should be removed (and the database
// password rotated, since it has been committed to the repo).
module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://in_limbo_db_user:R81k6JoQsAzzZNEBxU4Yetqzik6MowsV@dpg-d832nvbrjlhs73817e00-a/in_limbo_db',
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS: process.env.ADMIN_PASS || 'limbo2026',
  STUDENT_USER: process.env.STUDENT_USER || 'student',
  STUDENT_PASS: process.env.STUDENT_PASS || 'inlimbo',
  VIMEO_ACCESS_TOKEN: process.env.VIMEO_ACCESS_TOKEN,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || ''
};
