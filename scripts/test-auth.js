// Tests the login guards without a server or a database: fake req/res objects
// straight into the middleware. Run with `npm test`.
//
// The colon case is a real bug this replaced: the old code split the decoded
// header on every colon, so a password containing one was silently truncated
// and a correct password was rejected forever.
process.env.DATABASE_URL = 'postgres://x:y@localhost/z';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'pa:ss word!';   // deliberately contains a colon and a space
process.env.STUDENT_USER = 'student';
process.env.STUDENT_PASS = 'studpass';

const path = require('path');
const { requireAuth, requireStudent } = require(path.join(__dirname, '..', 'middleware/auth'));

function call(mw, user, pass, ip) {
  return new Promise(res => {
    const headers = {};
    if (user !== null) headers.authorization = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
    const req = { headers, ip: ip || '1.2.3.4', socket: {} };
    const resp = { statusCode: null, set(){return this}, status(c){this.statusCode=c;return this}, send(){res(this.statusCode)} };
    mw(req, resp, () => res(200));
  });
}

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ok   ' + n)) : (fail++, console.log('  FAIL ' + n)); };

(async () => {
  check('correct admin credentials are accepted', await call(requireAuth, 'admin', 'pa:ss word!', 'a') === 200);
  check('a password containing a colon works (it used to be truncated)', await call(requireAuth, 'admin', 'pa:ss word!', 'b') === 200);
  check('wrong password is rejected', await call(requireAuth, 'admin', 'wrong', 'c') === 401);
  check('no header at all asks for credentials', await call(requireAuth, null, null, 'd') === 401);
  check('student credentials do not open the admin panel', await call(requireAuth, 'student', 'studpass', 'e') === 401);
  check('student credentials open the submit form', await call(requireStudent, 'student', 'studpass', 'f') === 200);
  check('admin credentials also open the submit form', await call(requireStudent, 'admin', 'pa:ss word!', 'g') === 200);

  console.log('brute-force brake');
  const ip = 'attacker';
  let codes = [];
  for (let i = 0; i < 10; i++) codes.push(await call(requireAuth, 'admin', 'guess' + i, ip));
  check('the first ten wrong tries are plain rejections', codes.every(c => c === 401));
  check('the eleventh is refused outright (429)', await call(requireAuth, 'admin', 'guess', ip) === 429);
  check('even the CORRECT password is refused while blocked', await call(requireAuth, 'admin', 'pa:ss word!', ip) === 429);
  check('another address is unaffected', await call(requireAuth, 'admin', 'pa:ss word!', 'someone-else') === 200);

  console.log('recovery');
  const ip2 = 'clumsy';
  for (let i = 0; i < 9; i++) await call(requireAuth, 'admin', 'oops', ip2);
  check('nine wrong tries then the right one still gets you in', await call(requireAuth, 'admin', 'pa:ss word!', ip2) === 200);
  check('and the counter is cleared by that success', await call(requireAuth, 'admin', 'oops', ip2) === 401);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
