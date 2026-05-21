# Duck Strike — Backend Setup

## What's in this folder

| File | Purpose |
|------|---------|
| `server.js` | Node.js/Express API server |
| `package.json` | Node dependencies |
| `duck_strike.html` | Updated game (points to backend) |

---

## Deploying the backend to Render.com

### Step 1 — Push to GitHub
Create a new GitHub repo and push `server.js` + `package.json` to it.

### Step 2 — Create a Web Service on Render
1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repo
3. Set:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Environment:** Node

### Step 3 (Recommended) — Add a Persistent Disk
Without a disk, the SQLite database resets on every redeploy.
- In your Render service → **Disks → Add Disk**
- Mount path: `/data`
- Then add an **Environment Variable**: `DB_PATH` = `/data/duckstrike.db`

### Step 4 — Connect the game
After Render gives you a URL (e.g. `https://duckstrike-abc.onrender.com`), open `duck_strike.html` and find:

```javascript
const BACKEND_URL = 'https://YOUR-RENDER-APP.onrender.com';
```

Replace `YOUR-RENDER-APP` with your actual Render subdomain. Save and serve the file.

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Login |
| `GET` | `/api/users/:username` | Get XP/level |
| `PUT` | `/api/users/:username` | Update XP/level |
| `DELETE` | `/api/users/:username` | Delete account |
| `GET` | `/api/admin/users` | List all accounts |
| `GET` | `/api/config` | Get gate/admin passwords + bans |
| `PUT` | `/api/config` | Update gate/admin passwords + bans |
| `GET` | `/health` | Health check |

---

## Default passwords
- **Gate password:** `chicken`
- **Admin password:** `admin123`

Change both immediately via the in-game Admin Panel after first launch.

---

## Fallback behaviour
If `BACKEND_URL` is left as the placeholder (or the server is unreachable), the game automatically falls back to `localStorage` — so it still works as a local-only game with no backend.
