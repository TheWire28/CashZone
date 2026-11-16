# The CashZone

Model picks, fair odds and a public record of how they did. Installable on your phone's home screen.

| Folder | What it is | Where it runs |
|---|---|---|
| `web/` | The app you open on your phone (React, installable PWA) | Netlify |
| `engine/` | The job that pulls games, makes picks and grades them | Render (every 30 min) |
| `supabase/` | The database tables | Supabase |

**Phase 1 covers the NFL.** Other leagues plug into `engine/src/leagues.js`.

## How a pick is made

1. **Pull** schedules, scores and the current betting line from ESPN's public scoreboard feed.
2. **Rate** every team from all finished games (Elo with margin of victory and home field; scoring for/against for totals).
3. **Project** each upcoming game: win chance, score, fair price, and a spread/total lean when a line exists.
4. **Store** the pick. It can update until kickoff, then it is locked for good.
5. **Grade** it against the final score. Past games loaded as history are never graded, so the record only counts picks made in advance.

## Setup (one time, about 20 minutes)

### 1. Supabase (database)
1. Create a project at supabase.com.
2. Open **SQL Editor**, paste all of `supabase/migrations/001_init.sql`, press **Run**.
3. Open **Project Settings → API** and keep the page open. You need the Project URL, the `anon` public key and the `service_role` secret key.

### 2. Render (the engine)
1. At render.com choose **New → Blueprint** and pick this repo. Render reads `render.yaml`.
2. When asked, paste `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. Open the `cashzone-engine` job and press **Trigger Run**. The first run loads last season plus this season (about a minute) and stores picks for the upcoming games.

### 3. Netlify (the app)
1. At netlify.com choose **Add new site → Import an existing project** and pick this repo. `netlify.toml` fills in the build settings.
2. Under **Site configuration → Environment variables** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the `anon` key, not the service-role one).
3. Deploy. Rename the site under **Domain management** if you want a nicer address.

### 4. Put it on your phone
- **iPhone:** open the Netlify address in Safari → Share → **Add to Home Screen**.
- **Android:** open it in Chrome → menu → **Add to Home screen** / **Install app**.

## Keys: which goes where

| Key | Goes in | Safe to expose? |
|---|---|---|
| `anon` public key | Netlify | Yes. The database only allows reading with it. |
| `service_role` secret | Render only | **No.** It can write. Never put it in Netlify or in this repo. |

## Running it yourself

```bash
cd engine && npm install
npm run sync:local   # prints this week's picks, saves nothing
npm run backtest     # how the model would have done on past games
npm test

cd ../web && npm install
npm run dev          # after sync:local, shows those picks at localhost:5173
```

Informational analysis only, not betting advice.
