// All environment configuration in one place.
// DATABASE_URL, ADMIN_PASS and STUDENT_PASS are required: set them in the
// Render dashboard (Environment) or in a local .env file for development.
const required = ['DATABASE_URL', 'ADMIN_PASS', 'STUDENT_PASS'];
const missing = required.filter(name => !process.env[name]);
if (missing.length > 0) {
  console.error('Missing required environment variable(s): ' + missing.join(', '));
  console.error('Set them in the Render dashboard (Environment tab) or in .env for local development.');
  process.exit(1);
}

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  ADMIN_USER: process.env.ADMIN_USER || 'admin',
  ADMIN_PASS: process.env.ADMIN_PASS,
  STUDENT_USER: process.env.STUDENT_USER || 'student',
  STUDENT_PASS: process.env.STUDENT_PASS,
  VIMEO_ACCESS_TOKEN: process.env.VIMEO_ACCESS_TOKEN,
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
  // Canonical public URL of the site, e.g. https://inlimbo.example — when set,
  // requests on other hostnames (www, .onrender.com) get a 301 redirect to it
  // and absolute OG/canonical tags are emitted.
  SITE_URL: (process.env.SITE_URL || '').replace(/\/+$/, '')
};
