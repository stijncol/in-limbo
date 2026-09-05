// Copies the videos table from DATABASE_URL to NEON_URL, then verifies it.
//
//   node scripts/migrate-db.js          # copy and verify
//   node scripts/migrate-db.js --verify # verify only, copy nothing
//
// Reads from the source and only ever writes to the target, so running it
// cannot damage the database still serving the site. The target table is
// dropped and rebuilt each run, so it is safe to run again after a failure.
//
// The schema is read from the source rather than taken from db/pool.js on
// purpose: the live table carries columns that initDB no longer creates
// (vimeo_id, tags) but that the INSERT in db/videos.js still writes to. Building
// the target from initDB alone would produce a table that reads fine and then
// fails the first time you add a film.
require('dotenv').config({ quiet: true });
const { Pool, types } = require('pg');

// Hand timestamps through as the text Postgres printed, instead of letting
// node-postgres turn them into JavaScript Dates. A Date only holds
// milliseconds, so a round trip quietly truncated created_at from
// 07:34:37.110793 to 07:34:37.11 — the copy looked complete and every count
// matched, and only the row digest caught it.
types.setTypeParser(1114, v => v); // timestamp without time zone
types.setTypeParser(1184, v => v); // timestamp with time zone

const SOURCE = process.env.DATABASE_URL;
const TARGET = process.env.NEON_URL;
const TABLE = 'videos';
const verifyOnly = process.argv.includes('--verify');

if (!SOURCE || !TARGET) {
  console.error('Need DATABASE_URL and NEON_URL in .env');
  process.exit(1);
}

const sslFor = (url) =>
  /@(localhost|127\.0\.0\.1)/.test(url) ? false
  : url.includes('render.com') ? { rejectUnauthorized: false }
  : true;

const src = new Pool({ connectionString: SOURCE, ssl: sslFor(SOURCE) });
const dst = new Pool({ connectionString: TARGET, ssl: sslFor(TARGET) });

const q = (s) => '"' + s.replace(/"/g, '""') + '"';

async function readSchema() {
  const cols = await src.query(
    `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
      WHERE table_name = $1 ORDER BY ordinal_position`, [TABLE]);
  const pk = await src.query(
    `SELECT a.attname FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary`, [TABLE]);
  return { cols: cols.rows, pk: pk.rows.map(r => r.attname) };
}

function createTableSql({ cols, pk }) {
  const defs = cols.map(c => {
    const serial = c.column_default && c.column_default.startsWith('nextval');
    let type = c.data_type;
    if (serial) type = c.data_type === 'bigint' ? 'BIGSERIAL' : 'SERIAL';
    else if (type === 'character varying' && c.character_maximum_length) type = `VARCHAR(${c.character_maximum_length})`;
    else if (type === 'timestamp without time zone') type = 'TIMESTAMP';
    else if (type === 'USER-DEFINED') type = 'TEXT';
    let def = `  ${q(c.column_name)} ${type}`;
    if (!serial && c.column_default !== null) def += ` DEFAULT ${c.column_default}`;
    if (c.is_nullable === 'NO' && !serial) def += ' NOT NULL';
    return def;
  });
  if (pk.length) defs.push(`  PRIMARY KEY (${pk.map(q).join(', ')})`);
  return `CREATE TABLE ${q(TABLE)} (\n${defs.join(',\n')}\n)`;
}

// Compares what actually landed, not what we think we sent: row count, the
// blob columns that carry almost all the bytes, and a digest of every row.
async function fingerprint(pool, cols) {
  const names = cols.map(c => c.column_name);
  const has = (n) => names.includes(n);
  const parts = [
    `COUNT(*)::int AS rows`,
    has('thumb_data')  ? `COUNT(thumb_data)::int AS blur`   : `0 AS blur`,
    has('thumb_sharp') ? `COUNT(thumb_sharp)::int AS sharp` : `0 AS sharp`,
    has('thumb_data')  ? `COALESCE(SUM(octet_length(thumb_data)),0)::bigint AS blur_bytes`   : `0 AS blur_bytes`,
    has('thumb_sharp') ? `COALESCE(SUM(octet_length(thumb_sharp)),0)::bigint AS sharp_bytes` : `0 AS sharp_bytes`,
  ];
  const agg = (await pool.query(`SELECT ${parts.join(', ')} FROM ${q(TABLE)}`)).rows[0];
  const digest = (await pool.query(
    `SELECT md5(string_agg(t.digest, '' ORDER BY t.digest)) AS all_rows
       FROM (SELECT md5(${q(TABLE)}.*::text) AS digest FROM ${q(TABLE)}) t`)).rows[0].all_rows;
  return { ...agg, digest };
}

(async () => {
  const schema = await readSchema();
  if (!schema.cols.length) throw new Error(`table "${TABLE}" not found in the source database`);
  const names = schema.cols.map(c => c.column_name);
  console.log(`source table: ${schema.cols.length} columns, primary key ${schema.pk.join(', ') || '(none)'}`);

  if (!verifyOnly) {
    console.log('\nbuilding the table on Neon...');
    await dst.query(`DROP TABLE IF EXISTS ${q(TABLE)}`);
    await dst.query(createTableSql(schema));

    const rows = (await src.query(`SELECT * FROM ${q(TABLE)} ORDER BY id`)).rows;
    console.log(`copying ${rows.length} rows...`);
    const colList = names.map(q).join(', ');
    for (const row of rows) {
      const values = names.map(n => row[n]);
      const holes = values.map((_, i) => '$' + (i + 1)).join(', ');
      await dst.query(`INSERT INTO ${q(TABLE)} (${colList}) VALUES (${holes})`, values);
    }

    // The id column keeps its values, so the sequence has to be moved past them
    // or the next insert collides with an existing row.
    const idCol = schema.cols.find(c => c.column_default && c.column_default.startsWith('nextval'));
    if (idCol) {
      await dst.query(
        `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${q(idCol.column_name)}) FROM ${q(TABLE)}), 1))`,
        [TABLE, idCol.column_name]);
      console.log('id sequence moved past the copied rows');
    }
  }

  console.log('\nverifying...');
  const a = await fingerprint(src, schema.cols);
  const b = await fingerprint(dst, schema.cols);
  const line = (label, x, y) => {
    const ok = String(x) === String(y);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(22)} source ${String(x).padStart(12)}   neon ${String(y).padStart(12)}`);
    return ok;
  };
  let ok = true;
  ok = line('rows', a.rows, b.rows) && ok;
  ok = line('blurred thumbnails', a.blur, b.blur) && ok;
  ok = line('sharp thumbnails', a.sharp, b.sharp) && ok;
  ok = line('blurred bytes', a.blur_bytes, b.blur_bytes) && ok;
  ok = line('sharp bytes', a.sharp_bytes, b.sharp_bytes) && ok;
  ok = line('digest of every row', a.digest, b.digest) && ok;

  console.log(ok ? '\nidentical — Neon holds exactly what Render holds'
                 : '\nMISMATCH — do not switch DATABASE_URL yet');
  await src.end(); await dst.end();
  process.exit(ok ? 0 : 1);
})().catch(async (e) => {
  console.error('\nfailed:', e.message);
  try { await src.end(); await dst.end(); } catch (_) {}
  process.exit(1);
});
