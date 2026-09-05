// Guards what the public API is allowed to show.
//
// /api/videos used to return every row. The archive is all-approved today, so
// nothing leaked and nothing looked wrong — but the moment a student submits,
// their name, title and synopsis would have been readable by anyone before it
// had been looked at. This test keeps a pending row in the fixture on purpose,
// because that is the only state in which the bug is visible.
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@localhost/db';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'adminpass';
process.env.STUDENT_USER = 'student';
process.env.STUDENT_PASS = 'studentpass';

const path = require('path');
const APP = path.join(__dirname, '..');

const ROWS = [
  { id: 1, title: 'Published film',  students: 'A', status: 'approved', video_id: '111' },
  { id: 2, title: 'Older film',      students: 'B', status: null,       video_id: '222' },
  { id: 3, title: 'Just submitted',  students: 'A student who has not been approved yet', status: 'pending',  video_id: '333' },
  { id: 4, title: 'Turned down',     students: 'D', status: 'rejected', video_id: '444' },
];

// Stub the data layer before the route module pulls it in.
const videosPath = require.resolve(path.join(APP, 'db/videos'));
require.cache[videosPath] = { id: videosPath, filename: videosPath, loaded: true, exports: {
  getVideoRows: async () => ROWS,
  createVideo: async () => {}, updateVideo: async () => {}, deleteVideo: async () => {},
  submitVideo: async () => {}, approveVideo: async () => {}, rejectVideo: async () => {},
} };
const poolPath = require.resolve(path.join(APP, 'db/pool'));
require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: { pool: null, initDB: async () => {} } };

const router = require(path.join(APP, 'routes/api'));

// Find the handler stack Express built, and run one route by hand.
function call(method, url, headers = {}) {
  return new Promise(resolve => {
    const layer = router.stack.find(l => l.route && l.route.path === url && l.route.methods[method]);
    if (!layer) return resolve({ status: 0, body: 'no such route' });
    const handlers = layer.route.stack.map(s => s.handle);
    const req = { method: method.toUpperCase(), url, originalUrl: url, headers, params: {}, ip: '1.2.3.4', socket: {} };
    const res = {
      statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
      send(b) { resolve({ status: this.statusCode, body: b }); },
    };
    let i = 0;
    const next = () => { const h = handlers[i++]; if (h) h(req, res, next); else resolve({ status: 404, body: null }); };
    next();
  });
}

const basic = (u, p) => ({ authorization: 'Basic ' + Buffer.from(u + ':' + p).toString('base64') });

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n)); };

(async () => {
  const anon = await call('get', '/videos');
  const titles = anon.body.map(v => v.title);
  check('anonymous sees the approved films', titles.includes('Published film') && titles.includes('Older film'));
  check('a pending submission is NOT public', !titles.includes('Just submitted'));
  check('a rejected film is NOT public', !titles.includes('Turned down'));
  check('anonymous gets exactly the two public rows', anon.body.length === 2);

  const admin = await call('get', '/videos', basic('admin', 'adminpass'));
  check('an admin still sees everything, pending included', admin.body.length === 4);

  const wrong = await call('get', '/videos', basic('admin', 'not-the-password'));
  check('a bad password falls back to the public list, it does not error', wrong.body.length === 2);

  const student = await call('get', '/videos', basic('student', 'studentpass'));
  check('student credentials do not unlock the full list', student.body.length === 2);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
