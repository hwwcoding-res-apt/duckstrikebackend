/**
 * Duck Strike — Backend Server
 * Deploy to Render.com as a Web Service.
 *
 * ─── SETUP ──────────────────────────────────────────────────────────
 * 1. Push this folder (server.js + package.json) to a GitHub repo.
 * 2. Create a new Web Service on Render.com, connect your repo.
 * 3. Build command:  npm install
 *    Start command:  npm start
 * 4. (Recommended) Add a Render Disk at /data so the SQLite DB persists
 *    across deploys.  Then set env var:  DB_PATH=/data/duckstrike.db
 *    Without a disk, data resets on every redeploy (fine for testing).
 * 5. Copy your Render service URL into duck_strike.html:
 *      const BACKEND_URL = 'https://YOUR-APP.onrender.com';
 * ────────────────────────────────────────────────────────────────────
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');        // pure-JS bcrypt — no native deps
const Database   = require('better-sqlite3');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Database ──────────────────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'duckstrike.db');
const db = new Database(DB_PATH);
console.log(`[DB] Using database at: ${DB_PATH}`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username     TEXT    PRIMARY KEY,
    password_hash TEXT   NOT NULL,
    xp           INTEGER DEFAULT 0,
    level        INTEGER DEFAULT 1,
    created_at   INTEGER DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
  );
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  -- Default values (ignored if row already exists)
  INSERT OR IGNORE INTO config (key, value) VALUES ('gate_pwd',  'chicken');
  INSERT OR IGNORE INTO config (key, value) VALUES ('gate_ts',   '0');
  INSERT OR IGNORE INTO config (key, value) VALUES ('admin_pwd', 'admin123');
  INSERT OR IGNORE INTO config (key, value) VALUES ('bans',      '[]');
`);

// ── Helpers ───────────────────────────────────────────────────────
const getConfig = (key)           => { const r = db.prepare('SELECT value FROM config WHERE key = ?').get(key); return r ? r.value : null; };
const setConfig = (key, value)    => db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
const getBans   = ()              => JSON.parse(getConfig('bans') || '[]');

// ── Middleware ────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Config endpoints ──────────────────────────────────────────────

// GET /api/config — returns gate password, admin password, bans
// Called by the game client on startup to sync passwords.
app.get('/api/config', (_req, res) => {
  res.json({
    gatePwd:  getConfig('gate_pwd')  || 'chicken',
    gateTs:   parseInt(getConfig('gate_ts') || '0', 10),
    adminPwd: getConfig('admin_pwd') || 'admin123',
    bans:     getBans()
  });
});

// PUT /api/config — update gate/admin passwords or bans
app.put('/api/config', (req, res) => {
  const { gatePwd, gateTs, adminPwd, bans } = req.body || {};
  if (gatePwd  !== undefined) setConfig('gate_pwd',  gatePwd);
  if (gateTs   !== undefined) setConfig('gate_ts',   gateTs);
  if (adminPwd !== undefined) setConfig('admin_pwd', adminPwd);
  if (bans     !== undefined) setConfig('bans',      JSON.stringify(bans));
  res.json({ success: true });
});

// ── Auth endpoints ────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};

  // Input validation
  if (!username || !password)         return res.status(400).json({ error: 'Missing username or password.' });
  if (username.length < 2)            return res.status(400).json({ error: 'Username must be at least 2 characters.' });
  if (username.length > 14)           return res.status(400).json({ error: 'Username max 14 characters.' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Letters, numbers, and _ only.' });
  if (password.length < 4)            return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  // Ban check
  if (getBans().includes(username))   return res.status(403).json({ error: 'This account has been banned.' });

  // Duplicate check
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username))
    return res.status(409).json({ error: 'Username taken! Try another.' });

  const hash = await bcrypt.hash(password, 10);
  db.prepare('INSERT INTO users (username, password_hash, xp, level) VALUES (?, ?, 0, 1)').run(username, hash);

  console.log(`[Auth] Registered: ${username}`);
  res.json({ success: true, username, xp: 0, level: 1 });
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing username or password.' });

  // Ban check
  if (getBans().includes(username))   return res.status(403).json({ error: 'This account has been banned.' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'Account not found. Register first!' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Wrong password!' });

  console.log(`[Auth] Login: ${username} (Lv ${user.level}, ${user.xp} XP)`);
  res.json({ success: true, username, xp: user.xp, level: user.level });
});

// ── User data endpoints ───────────────────────────────────────────

// GET /api/users/:username — fetch user's XP & level (for auto-login)
app.get('/api/users/:username', (req, res) => {
  const user = db.prepare('SELECT username, xp, level FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

// PUT /api/users/:username — update XP and/or level (called after kills/deaths)
app.put('/api/users/:username', (req, res) => {
  const { xp, level } = req.body || {};
  const user = db.prepare('SELECT 1 FROM users WHERE username = ?').get(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (xp    !== undefined) db.prepare('UPDATE users SET xp    = ? WHERE username = ?').run(xp,    req.params.username);
  if (level !== undefined) db.prepare('UPDATE users SET level = ? WHERE username = ?').run(level, req.params.username);
  res.json({ success: true });
});

// DELETE /api/users/:username — delete account (admin panel)
app.delete('/api/users/:username', (req, res) => {
  const result = db.prepare('DELETE FROM users WHERE username = ?').run(req.params.username);
  if (!result.changes) return res.status(404).json({ error: 'User not found.' });
  console.log(`[Admin] Deleted account: ${req.params.username}`);
  res.json({ success: true });
});

// GET /api/admin/users — list all accounts (admin panel)
// Returns username, xp, level for every registered user (no passwords).
app.get('/api/admin/users', (_req, res) => {
  const rows = db.prepare('SELECT username, xp, level, created_at FROM users ORDER BY username').all();
  const result = {};
  rows.forEach(u => { result[u.username] = { xp: u.xp, level: u.level, createdAt: u.created_at }; });
  res.json(result);
});

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n }));

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🦆 Duck Strike backend running on port ${PORT}`);
  console.log(`   Gate password : ${getConfig('gate_pwd')}`);
  console.log(`   Admin password: ${getConfig('admin_pwd')}`);
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  console.log(`   Registered users: ${userCount}`);
});
