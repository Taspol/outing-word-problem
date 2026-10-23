# Outing Word Flip

A Thai word game for team outings: **ตอบให้ได้ 5 ข้อ ใน 30 วิ** (answer 5 in 30 seconds). Each card shows a
letter pattern with blanks (e.g. `ย _ _ ย _ _`). The host reads the clue from their phone and the team shouts the
word. No score is kept: the operator clicks the card once to show its answer and again for the next card, and clicks
**Complete** when the team is done. The round also ends when time runs out, and then the last card shows its answer. Round time and the number in the title are adjustable.

- **Play** — Begin a session, scan the QR on the host's phone, then **Start round**. During a round: click the card,
  **Show answer / Next** or `Space` to show the answer and then the next card, **Complete** or `C` to finish, `P` pause,
  `F` full screen. **Next round** (or `Space`) starts another. Cards don't repeat until the
  whole deck has been used.
- **Puzzles** — Edit, add or delete puzzles (pattern, clue, answer). Use `_` for each hidden letter.
  **Download CSV** exports the list (`no.,Hint,Clue,Answer`). **Upload CSV** replaces the whole list from a file
  (the same layout, any file with Hint/Pattern, Clue and Answer columns, or just those three columns with no header).
  You see the puzzles and any unusable rows before anything is replaced.
- **Monitor** (`/monitor/<code>`) — For the host: the clue to read out, the answer, the round clock and this
  round's cards, live. The clue and answer are never shown on the main screen during a round.

## Run locally

This project uses [pnpm](https://pnpm.io) (`corepack enable` sets up the pinned version).

```bash
pnpm install
pnpm dev             # http://localhost:3000 (or the next free port)
```

Phones on the same Wi-Fi can scan the QR code: it uses the computer's network address automatically.

## Deploy

The app needs **one long-running Node server**: puzzles are saved to a CSV file and live sessions are
kept in memory. Serverless hosts (Vercel, Netlify functions) won't keep either, so use Docker or any
Node host with a persistent disk.

### Docker (recommended)

```bash
docker compose up -d --build    # http://<server>:3010
```

The puzzle list lives in the `problems` volume at `/data/problems.csv` and survives rebuilds.
The first start copies the starter list from `data/problems.csv`.

Works the same on a VPS, Render, Railway or Fly.io — point them at the `Dockerfile`, expose port 3000,
mount a persistent disk at `/data`, and run **a single instance** (sessions are held in memory).

### Without Docker

```bash
pnpm install --frozen-lockfile
pnpm build
PROBLEMS_CSV=/var/lib/outing-word/problems.csv node .next/standalone/server.js
```

Copy `.next/static` to `.next/standalone/.next/static`, and `public` and `data` into `.next/standalone/`, before starting
(the Dockerfile does this for you).

### Settings

| Variable         | Default              | Purpose                                                    |
| ---------------- | -------------------- | ---------------------------------------------------------- |
| `PROBLEMS_CSV`   | `data/problems.csv`  | Where the puzzle list is saved.                            |
| `PORT`           | `3000`               | Port the server listens on.                                |
| `HOST_PORT`      | `3010`               | Port on the server Docker Compose publishes the app on.    |

There is no login: anyone with the link can host a game and edit the puzzle list. Session codes are
random and expire 12 hours after the last activity.

### Behind a reverse proxy

Live updates use Server-Sent Events. With nginx, turn off buffering for them:

```nginx
location /api/session/ {
    proxy_pass http://127.0.0.1:3010;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

Serve the site over HTTPS so browsers allow full screen and copy-to-clipboard everywhere.
