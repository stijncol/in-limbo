// Guards the TLS rule in db/pool.js against the mistake it already made once.
//
// On Render the DATABASE_URL is the INTERNAL hostname — `@dpg-xxxxx-a/dbname`,
// no domain at all. A rule that looked for "render.com" missed it, demanded a
// verified certificate, and met Render's self-signed one: the app crash-looped
// on boot with DEPTH_ZERO_SELF_SIGNED_CERT, an error that never mentions TLS.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@localhost/db';
process.env.ADMIN_PASS = process.env.ADMIN_PASS || 'x';
process.env.STUDENT_PASS = process.env.STUDENT_PASS || 'x';

const path = require('path');
const { sslFor } = require(path.join(__dirname, '..', 'db/pool'));

const cases = [
  ['Render internal (no domain in the host)', 'postgresql://u:p@dpg-abc123-a/in_limbo_db', false],
  ['Render external',                          'postgresql://u:p@dpg-abc123-a.oregon-postgres.render.com/db', { rejectUnauthorized: false }],
  ['Neon, sslmode in the URL',                 'postgresql://u:p@ep-x-pooler.c-6.eu-central-1.aws.neon.tech/neondb?sslmode=require', true],
  ['Neon, no query parameters',                'postgresql://u:p@ep-x-pooler.c-6.eu-central-1.aws.neon.tech/neondb', true],
  ['a database on this machine',               'postgresql://u:p@localhost/db', false],
];

let pass = 0, fail = 0;
for (const [name, url, want] of cases) {
  const got = sslFor(url);
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + ' -> ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
