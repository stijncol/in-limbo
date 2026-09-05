// Tests the in-memory cache in db/videos.js against a fake pool, so it runs
// without a database. Run with `npm test`.
//
// The case worth guarding is the last one: an edit clears the cache, then the
// database goes down, and a visitor still has to be served. An earlier version
// failed exactly there, because invalidating the list also threw away the copy
// it was supposed to fall back on.
const path = require('path');
const APP = path.join(__dirname, '..');

let queries = 0, failing = false;
const poolPath = require.resolve(path.join(APP, 'db/pool'));
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: {
  pool: { query: async (sql) => {
    queries++;
    if (failing) throw new Error('database unreachable');
    if (sql.includes('thumb_data FROM')) return { rows: [{ thumb_data: Buffer.from('BLUR') }] };
    if (sql.includes('thumb_sharp FROM')) return { rows: [{ thumb_sharp: Buffer.from('SHARP') }] };
    return { rows: [{ id: 1, title: 'Film', has_thumb: true, thumb_data: Buffer.from('x') }] };
  } },
  initDB: async () => {}
}};

const db = require(path.join(APP, 'db/videos'));
const V = { title: 'x', students: '', description: '', video_id: '', video_type: '',
            year: 2026, tags_theme: '', tags_medium: '', featured: 1, archived: 0, sort_order: 0 };

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
};

(async () => {
  console.log('reading');
  queries = 0;
  await db.getVideoRows();
  check('the first call queries the database', queries === 1);
  await db.getVideoRows();
  await db.getVideoRows();
  check('repeat calls are served from memory', queries === 1);

  queries = 0;
  await db.updateVideo(1, V);
  queries = 0;
  await Promise.all([db.getVideoRows(), db.getVideoRows(), db.getVideoRows(), db.getVideoRows()]);
  check('a burst of concurrent misses collapses into one query', queries === 1);

  console.log('writing');
  queries = 0;
  await db.updateVideo(1, V);
  await db.getVideoRows();
  check('an edit forces a fresh read', queries === 2);

  console.log('thumbnails');
  queries = 0;
  const blur = await db.getThumb(1);
  await db.getThumb(1);
  check('a thumbnail is fetched once and then cached', queries === 1);
  check('the cached thumbnail is the right blob', blur && blur.toString() === 'BLUR');
  const sharp = await db.getThumbSharp(1);
  check('blur and sharp are separate entries', queries === 2 && sharp.toString() === 'SHARP');
  queries = 0;
  await db.saveThumb(1, Buffer.from('NEW'), Buffer.from('NEWSHARP'), null);
  await db.getThumb(1);
  check('re-baking drops the cached blob', queries === 2);

  console.log('surviving an outage');
  await db.getVideoRows();
  await db.updateVideo(1, V);   // succeeds, so the list is marked stale
  failing = true;               // and only then does the database die
  queries = 0;
  let rows = null, threw = false;
  try { rows = await db.getVideoRows(); } catch (e) { threw = true; }
  check('stale list + dead database still serves the last good copy', !threw && Array.isArray(rows) && rows.length === 1);
  check('it did try the database first', queries === 1);
  let second = null;
  try { second = await db.getVideoRows(); } catch (e) { second = null; }
  check('the next visitor is served too', Array.isArray(second) && second.length === 1);
  failing = false;
  check('it recovers once the database is back', (await db.getVideoRows()).length === 1);

  delete require.cache[require.resolve(path.join(APP, 'db/videos'))];
  const cold = require(path.join(APP, 'db/videos'));
  failing = true;
  let coldThrew = false;
  try { await cold.getVideoRows(); } catch (e) { coldThrew = true; }
  check('a cold start with nothing cached still reports the failure', coldThrew);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
