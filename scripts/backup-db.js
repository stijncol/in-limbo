// Writes a full, self-contained copy of the archive to a folder on disk.
//
//   node scripts/backup-db.js                    # back up DATABASE_URL
//   node scripts/backup-db.js --from NEON_URL    # back up a different one
//   node scripts/backup-db.js --restore <folder> --into NEON_URL [--table name]
//
// The point of this file is to depend on nobody: not Render, not Neon, not a
// matching Postgres version. It is plain JSON plus ordinary PNG files, so the
// thumbnails can be opened by double-clicking them and the text can be read in
// any editor even if every account involved is gone.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Timestamps as the text Postgres printed them: a JavaScript Date holds only
// milliseconds and would silently drop the microseconds.
types.setTypeParser(1114, v => v);
types.setTypeParser(1184, v => v);

const TABLE = 'videos';
const BLOBS = ['thumb_data', 'thumb_sharp'];
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

const sslFor = (url) =>
  /[?&]sslmode=(require|verify-ca|verify-full)/.test(url) || /neon\.tech/.test(url) ? true
  : /render\.com/.test(url) ? { rejectUnauthorized: false }
  : false;

async function backup() {
  const urlName = flag('--from') || 'DATABASE_URL';
  const url = process.env[urlName];
  if (!url) throw new Error(`${urlName} is not set`);

  const stamp = new Date().toISOString().slice(0, 10);
  const dir = flag('--to') || path.join(process.env.HOME, 'Desktop', `in-limbo-backup-${stamp}`);
  const thumbDir = path.join(dir, 'thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });

  const pool = new Pool({ connectionString: url, ssl: sslFor(url) });
  const cols = (await pool.query(
    `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [TABLE])).rows;
  const rows = (await pool.query(`SELECT * FROM ${TABLE} ORDER BY id`)).rows;

  // Blobs go to disk as real PNGs rather than base64 inside the JSON: a third
  // smaller, and you can look at them without any tooling at all.
  let bytes = 0;
  const plain = rows.map(row => {
    const out = {};
    for (const c of cols) {
      const n = c.column_name;
      if (BLOBS.includes(n)) {
        if (row[n]) {
          const file = `${row.id}-${n === 'thumb_data' ? 'blur' : 'sharp'}.png`;
          fs.writeFileSync(path.join(thumbDir, file), row[n]);
          bytes += row[n].length;
          out[n] = { file };
        } else out[n] = null;
      } else out[n] = row[n];
    }
    return out;
  });

  fs.writeFileSync(path.join(dir, 'data.json'),
    JSON.stringify({ table: TABLE, takenAt: new Date().toISOString(), source: url.replace(/\/\/[^@]*@/, '//<credentials>@'), columns: cols, rows: plain }, null, 2));

  // A list a person can read, for when the JSON is not the point.
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  fs.writeFileSync(path.join(dir, 'films.csv'),
    ['id,title,students,year,video_type,video_id,status',
      ...rows.map(r => [r.id, r.title, r.students, r.year, r.video_type, r.video_id, r.status].map(esc).join(','))].join('\n'));

  fs.writeFileSync(path.join(dir, 'RESTORE.md'),
`# in limbo — backup of ${stamp}

${rows.length} films, ${(bytes / 1048576).toFixed(1)} MB of thumbnails.

- \`films.csv\` — the archive as a readable list, opens in Numbers or Excel
- \`thumbs/\` — every thumbnail as an ordinary PNG, blur and sharp per film
- \`data.json\` — everything, including the exact table structure

## Putting it back

With the project checked out and the target database in .env:

    node scripts/backup-db.js --restore "${dir}" --into NEON_URL

That rebuilds the table exactly as it was and copies every row and image
back. Add \`--table videos_test\` to restore beside the real table instead
of replacing it.

This folder depends on no account and no service. Even with Render, Neon and
GitHub all gone, the films, texts and images are here.
`);

  await pool.end();
  console.log(`backed up to ${dir}`);
  console.log(`  ${rows.length} films, ${cols.length} columns`);
  console.log(`  ${fs.readdirSync(thumbDir).length} thumbnail files, ${(bytes / 1048576).toFixed(1)} MB`);
  return dir;
}

async function restore() {
  const dir = flag('--restore');
  const urlName = flag('--into');
  const table = flag('--table') || TABLE;
  const url = process.env[urlName];
  if (!url) throw new Error(`${urlName} is not set`);

  const dump = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  const pool = new Pool({ connectionString: url, ssl: sslFor(url) });
  const q = (s) => '"' + s.replace(/"/g, '""') + '"';

  const defs = dump.columns.map(c => {
    const serial = c.column_default && c.column_default.startsWith('nextval');
    let type = serial ? (c.data_type === 'bigint' ? 'BIGSERIAL' : 'SERIAL')
      : c.data_type === 'timestamp without time zone' ? 'TIMESTAMP'
      : c.data_type === 'character varying' && c.character_maximum_length ? `VARCHAR(${c.character_maximum_length})`
      : c.data_type;
    let d = `  ${q(c.column_name)} ${type}`;
    if (!serial && c.column_default !== null) d += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === 'NO' && !serial) d += ' NOT NULL';
    return d;
  });
  defs.push('  PRIMARY KEY (id)');

  await pool.query(`DROP TABLE IF EXISTS ${q(table)}`);
  await pool.query(`CREATE TABLE ${q(table)} (\n${defs.join(',\n')}\n)`);

  const names = dump.columns.map(c => c.column_name);
  for (const row of dump.rows) {
    const values = names.map(n => {
      const v = row[n];
      if (v && typeof v === 'object' && v.file) return fs.readFileSync(path.join(dir, 'thumbs', v.file));
      return v;
    });
    await pool.query(
      `INSERT INTO ${q(table)} (${names.map(q).join(', ')}) VALUES (${values.map((_, i) => '$' + (i + 1)).join(', ')})`,
      values);
  }
  await pool.query(`SELECT setval(pg_get_serial_sequence($1,'id'), COALESCE((SELECT MAX(id) FROM ${q(table)}),1))`, [table]);
  await pool.end();
  console.log(`restored ${dump.rows.length} rows into "${table}"`);
}

(flag('--restore') ? restore() : backup()).catch(e => {
  console.error('failed:', e.message);
  process.exit(1);
});
