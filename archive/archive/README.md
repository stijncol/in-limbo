# in limbo

Video archive for KULeuven Architectuur — Positioneren II 2025-2026

## Quick start

```bash
npm install
node server.js
```

Open http://localhost:3000 for the public site.
Open http://localhost:3000/user for the admin panel.

## Admin credentials

- **Username:** admin
- **Password:** limbo2026

Change these in `server.js` (lines 10-11).

## Admin panel features

- Add videos with: title, students, year, Vimeo link, description (150 words), tags, sort order
- Mark as **highlight** (shown on front page) or **archief** (hidden behind "ontdek het volledige video-archief")
- Edit and delete existing videos
- Sort order: lower number = appears first. Use this to force specific videos to the top.

## Deploy to Railway / Render / Fly.io

1. Push the folder to a GitHub repo
2. Connect it to Railway, Render, or Fly.io
3. Set the start command to `node server.js`
4. The SQLite database (`videos.db`) persists in the same directory

For persistent storage on Railway/Render, consider adding a volume mount for the db file.

## Stack

- Node.js + Express
- sql.js (SQLite in pure JS)
- No build step, no framework, single file
