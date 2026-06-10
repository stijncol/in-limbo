# in limbo

Video archive for KULeuven Architectuur — Positioneren II 2025-2026

## Quick start

```bash
npm install
node server.js
```

Open http://localhost:3000 for the public site.
Open http://localhost:3000/user for the admin panel.
Open http://localhost:3000/submit for the student submit form.
Open http://localhost:3000/lab for the thumbnail dither lab (admin login).

Running locally needs a reachable Postgres database: copy `.env.example` to
`.env`, set `DATABASE_URL` (e.g. the External Database URL from the Render
dashboard), and start with `node --env-file=.env server.js`.

## Project structure

```
server.js          entry point: express setup, mounts routers, starts server
config.js          all environment variables (with fallback defaults)
db/
  pool.js          Postgres pool + schema migrations (run on every start)
  videos.js        every SQL query lives here
middleware/
  auth.js          Basic Auth (admin tier + student tier)
routes/
  api.js           /api/videos CRUD, /api/submit, approve/reject, Vimeo proxy
  thumbs.js        /thumb/:id (blur) and /thumb/:id/sharp PNG blobs
  pages.js         the four pages: / , /submit , /user , /lab
views/
  *.js             one render function per page: (data) → HTML string
public/
  css/, js/        per-page stylesheets and client scripts
  fonts/, *.png    static assets
```

Conventions: `server.js` only wires things together; SQL only exists in
`db/`; `config.js` is the only file that reads `process.env`; views are pure
functions that return HTML strings (no templating engine — the pages are
template literals, same as before the refactor).

## Authentication

Two Basic Auth tiers, configured via env vars (see `.env.example`):

- **admin** — full access (`/user`, `/lab`, video CRUD). Defaults to `admin` / `limbo2026`.
- **student** — submit-only (`/submit`, `POST /api/submit`). Defaults to `student` / `inlimbo`.

## Environment variables

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Postgres connection string (Render: link the database in the Environment tab) |
| `ADMIN_PASS` | **yes** | admin password — the server refuses to start without it |
| `STUDENT_PASS` | **yes** | student password — the server refuses to start without it |
| `ADMIN_USER` / `STUDENT_USER` | no | default to `admin` / `student` |
| `SITE_URL` | no | canonical URL (e.g. `https://www.example.com`); enables redirect + OG tags |
| `PORT` | no | Render injects this; defaults to 3000 |
| `VIMEO_ACCESS_TOKEN` | optional | enables video duration display |
| `YOUTUBE_API_KEY` | optional | enables YouTube duration display |

## Deploy (Render)

- Web Service connected to this GitHub repo; push to `main` auto-deploys
- Build command: `npm install` — start command: `node server.js`
- Database: Render Postgres, connected via `DATABASE_URL`

### Before deploying this version

`DATABASE_URL`, `ADMIN_PASS` and `STUDENT_PASS` **must** be set in the Render
dashboard before this version goes live — the server exits at startup if any
of them is missing. Pick fresh passwords (the old `limbo2026` / `inlimbo`
values are in the repo's git history) and **rotate the database password**
in the Render Postgres settings for the same reason.

## Admin panel features

- Add videos with: title, students, year, Vimeo/YouTube link, description, tags (theme + medium), sort order
- Mark as **highlight** (shown on front page) or **archief** (behind "ontdek het volledige video-archief")
- Approve or reject student submissions (they arrive as status `pending`)
- Edit and delete existing videos
- Sort order: lower number = appears first

## Stack

- Node.js + Express 5
- PostgreSQL via `pg`
- No build step, no framework, no view engine
