# in limbo

Video archive for KU Leuven Architectuur — Positioneren II, studio
Stelling–Strategie. Live at [inlimbo.video](https://inlimbo.video).

## Running it

```bash
npm install
node server.js
```

`.env` is read automatically. It needs `DATABASE_URL`, `ADMIN_PASS` and
`STUDENT_PASS`; the server refuses to start without them rather than coming up
half-configured. The site is then on the port in `PORT` (3000 by default).

### Without a database

```bash
node scripts/preview-server.js
```

Serves the real app on port 3100 with the data layer replaced by fixtures in
`scripts/fixtures/`. Nothing it writes reaches a database, so it is the right
place to try anything destructive.

### Tests

```bash
npm test
```

No database and no server needed — everything is stubbed. It covers the four
things that have actually gone wrong here: the in-memory cache, the login
guards, the TLS rule, and what the public API is allowed to show.

## Pages

| | |
| --- | --- |
| `/` | the archive |
| `/film/<slug>` | one film, for sharing — same page, that film's metadata |
| `/user` | admin panel (admin login) |
| `/lab` | dither lab, for tuning thumbnails (admin login) |
| `/submit` | student submission form (student login) |
| `/health` | `{ok, films}` — what uptime monitoring should watch |

Point UptimeRobot at `/health`, not at the homepage: it answers from memory,
so it costs no database query, but it still fails if the archive cannot be
produced at all.

## Structure

```
server.js          express setup, security headers, health, 404, error handler
config.js          the only file that reads process.env
db/
  pool.js          Postgres pool, TLS rule per host, schema migrations
  videos.js        every SQL query, plus the in-memory cache
middleware/
  auth.js          Basic Auth, two tiers, with a brute-force brake
routes/
  api.js           video CRUD, submissions, the Vimeo duration proxy
  thumbs.js        /thumb/:id (blur) and /thumb/:id/sharp
  pages.js         the pages above
views/*.js         one render function per page: (data) → HTML string
public/css, js     per-page stylesheets and client scripts
scripts/
  preview-server.js  the app on fixtures, no database
  backup-db.js       backup and restore to a folder on disk
  migrate-db.js      copy the table between two databases, then prove it
  test-*.js          the suite behind `npm test`
```

Conventions: `server.js` only wires things together, SQL only exists in `db/`,
`config.js` is the only file that reads `process.env`, and views are plain
functions returning HTML strings — no templating engine, no build step.

## How the archive is served

The rows and the thumbnail blobs are read once and kept in memory. A page view
does no database query at all; writes from the admin panel mark the list stale
so an edit shows up immediately, and a refresh that fails keeps serving the
last good copy rather than showing everyone an error. See the comments at the
top of `db/videos.js` — the distinction between *marking stale* and *throwing
away* is load-bearing, and conflating them was a real bug.

## Thumbnails

Baked in the browser from the platform's still, dithered, and stored as two
PNG blobs per film (blurred and sharp). YouTube pads every still into a fixed
frame, and which edges go black depends on the film's own aspect ratio, not on
the size requested — so `dither.js` measures the border and cuts it off before
cropping to 16:9 rather than assuming a shape.

Re-bake from `/user` (all, or only new) or per film from `/lab`. Settings
chosen in the lab are flagged `perFilm` so a later re-bake of the whole archive
does not overwrite a hand-corrected film.

## Environment

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Postgres connection string |
| `ADMIN_PASS` | **yes** | server exits at startup without it |
| `STUDENT_PASS` | **yes** | server exits at startup without it |
| `ADMIN_USER` / `STUDENT_USER` | no | default to `admin` / `student` |
| `SITE_URL` | no | canonical URL; enables the redirect and OG tags |
| `PORT` | no | Render injects this |
| `VIMEO_ACCESS_TOKEN` | no | film durations for Vimeo |
| `YOUTUBE_API_KEY` | no | film durations for YouTube; restrict it by HTTP referrer, it is sent to every visitor |

Passwords live in the Render dashboard and in a local `.env` that git ignores.
They are never in this repository, and no page ships one to the browser.

## Deploy

Render Web Service, connected to this repo — a push to `main` deploys. Build
`npm install`, start `node server.js`. The database is Neon (Frankfurt),
addressed through `DATABASE_URL`.

`db/pool.js` picks TLS per host: Render's certificate is self-signed and gets
an exception, anything else with an `sslmode` in the URL is verified properly,
and a database on localhost runs without TLS. Getting this wrong crash-loops
the deploy with an error that never mentions TLS, so `npm test` pins all five
URL shapes.

## Backups

```bash
node scripts/backup-db.js
```

Writes the whole archive to `~/Desktop/in-limbo-backup-<date>/`: the rows as
JSON, every thumbnail as an ordinary PNG, and a CSV that opens in Numbers. It
depends on no account and no service — with Render, Neon and GitHub all gone,
the films, texts and images are still there and readable.

Restore, or copy to a new database:

```bash
node scripts/backup-db.js --restore <folder> --into NEON_URL
node scripts/migrate-db.js            # DATABASE_URL → NEON_URL, then verify
```

Both verify what actually landed — row counts, blob byte totals, and a digest
of every row — rather than reporting success because nothing threw.

Do this before deleting any database, and keep a copy somewhere other than the
machine that made it.

## Stack

Node.js 20–24, Express 5, PostgreSQL via `pg`, `dotenv`. No framework, no view
engine, no build step.
