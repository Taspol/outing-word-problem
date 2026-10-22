# Outing Word Flip

A flip-card Thai word game for team outings. Each card shows a letter pattern with blanks (e.g. `ย _ _ ย _ _`)
and a clue; the host draws a random card, a timer counts down, and one tap shows the answer. Phones that scan
the session QR code follow each puzzle and its answer live.

- **Play** — Begin a session, scan the QR on the host's phone, then tap: draw → show answer → next card.
  `Space` advances, `P` pauses, `F` toggles full screen.
- **Puzzles** — Edit, add or delete puzzles (pattern, clue, answer). Use `_` for each hidden letter.
  **Download CSV** exports the list (`no.,Hint,Clue,Answer`). **Upload CSV** replaces the whole list from a file
  (the same layout, any file with Hint/Pattern, Clue and Answer columns, or just those three columns with no header).
  You see the puzzles and any unusable rows before anything is replaced.
- **Monitor** (`/monitor/<code>`) — Live puzzle, answer, timer and history for one session.

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000 (or the next free port)
```

Phones on the same Wi-Fi can scan the QR code: it uses the computer's network address automatically.

## Deploy

The app needs **one long-running Node server**: puzzles are saved to a CSV file and live sessions are
kept in memory. Serverless hosts (Vercel, Netlify functions) won't keep either, so use Docker or any
Node host with a persistent disk.

### Docker (recommended)

```bash
docker compose up -d --build    # http://<server>:3000
```

The puzzle list lives in the `problems` volume at `/data/problems.csv` and survives rebuilds.
The first start copies the starter list from `data/problems.csv`.

Works the same on a VPS, Render, Railway or Fly.io — point them at the `Dockerfile`, expose port 3000,
mount a persistent disk at `/data`, and run **a single instance** (sessions are held in memory).

### Without Docker

```bash
npm ci
npm run build
PROBLEMS_CSV=/var/lib/outing-word/problems.csv node .next/standalone/server.js
```

Copy `.next/static` to `.next/standalone/.next/static`, and `public` and `data` into `.next/standalone/`, before starting
(the Dockerfile does this for you).

### Settings

| Variable         | Default              | Purpose                                                    |
| ---------------- | -------------------- | ---------------------------------------------------------- |
| `PROBLEMS_CSV`   | `data/problems.csv`  | Where the puzzle list is saved.                            |
| `PORT`           | `3000`               | Port the server listens on.                                |

There is no login: anyone with the link can host a game and edit the puzzle list. Session codes are
random and expire 12 hours after the last activity.

### Behind a reverse proxy

Live updates use Server-Sent Events. With nginx, turn off buffering for them:

```nginx
location /api/session/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Serve the site over HTTPS so browsers allow full screen and copy-to-clipboard everywhere.
