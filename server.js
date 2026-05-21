'use strict';

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const { createClient } = require('@libsql/client');

// ── Turso client ───────────────────────────────────────────────────────
if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
  console.error('Missing TURSO_URL or TURSO_TOKEN environment variables.');
  process.exit(1);
}

const db = createClient({
  url:       process.env.TURSO_URL,
  authToken: process.env.TURSO_TOKEN
});

// ── Schema ─────────────────────────────────────────────────────────────
async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      xp            INTEGER NOT NULL DEFAULT 0,
      level         INTEGER NOT NULL DEFAULT 1,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bans (
      username TEXT PRIMARY KEY
    );
  `);

  // Seed initial passwords from env vars (only if not already set)
  await seedConfig('gate_password',  'GATE_PASSWORD',  'chicken');
  await seedConfig('admin_password', 'ADMIN_PASSWORD', 'admin123');
}

async function seedConfig(key, envKey, fallback) {
  const res = await db.execute({ sql: 'SELECT 1 FROM config WHERE key = ?', args: [key] });
  if (res.rows.length === 0) {
    await db.execute({
      sql:  'INSERT INTO config (key, value) VALUES (?, ?)',
      args: [key, process.env[envKey] || fallback]
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────
function hashPwd(pwd) {
  return crypto.createHash('sha256').update('duckstrike:' + pwd).digest('hex');
}

async function getConfig(key) {
  const res = await db.execute({ sql: 'SELECT value FROM config WHERE key = ?', args: [key] });
  return res.rows[0] ? res.rows[0].value : null;
}

async function setConfig(key, value) {
  await db.execute({
    sql:  'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)',
    args: [key, String(value)]
  });
}

async function getBans() {
  const res = await db.execute('SELECT username FROM bans');
  return res.rows.map(r => r.username);
}

// ── Express ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ── Health ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Register ───────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required.' });
    if (username.length < 2 || username.length > 14)
      return res.status(400).json({ error: 'Username must be 2–14 characters.' });
    if (/[^a-zA-Z0-9_]/.test(username))
      return res.status(400).json({ error: 'Letters, numbers, and _ only.' });
    if (password.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });

    const banned = await getBans();
    if (banned.includes(username))
      return res.status(403).json({ error: 'This account has been banned.' });

    const existing = await db.execute({ sql: 'SELECT 1 FROM users WHERE username = ?', args: [username] });
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Username already taken! Try another.' });

    await db.execute({
      sql:  'INSERT INTO users (username, password_hash, xp, level) VALUES (?, ?, 0, 1)',
      args: [username, hashPwd(password)]
    });

    res.json({ success: true, username, xp: 0, level: 1 });
  } catch (e) {
    console.error('[register]', e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Login ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required.' });

    const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
    const user = result.rows[0];
    if (!user)
      return res.status(401).json({ error: 'Account not found. Register first!' });

    const banned = await getBans();
    if (banned.includes(username))
      return res.status(403).json({ error: 'This account has been banned.' });

    if (hashPwd(password) !== user.password_hash)
      return res.status(401).json({ error: 'Wrong password!' });

    res.json({ success: true, username, xp: user.xp, level: user.level });
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Get user ───────────────────────────────────────────────────────────
app.get('/api/users/:username', async (req, res) => {
  try {
    const result = await db.execute({
      sql:  'SELECT username, xp, level FROM users WHERE username = ?',
      args: [req.params.username]
    });
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (e) {
    console.error('[get user]', e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Update user XP / level ─────────────────────────────────────────────
app.put('/api/users/:username', async (req, res) => {
  try {
    const { xp, level } = req.body || {};
    const result = await db.execute({ sql: 'SELECT 1 FROM users WHERE username = ?', args: [req.params.username] });
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    await db.execute({
      sql:  'UPDATE users SET xp = ?, level = ? WHERE username = ?',
      args: [xp ?? 0, level ?? 1, req.params.username]
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[update user]', e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── List all users (admin panel) ───────────────────────────────────────
app.get('/api/users', async (_req, res) => {
  try {
    const result = await db.execute('SELECT username, xp, level FROM users');
    res.json(result.rows);
  } catch (e) {
    console.error('[list users]', e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Get config ─────────────────────────────────────────────────────────
app.get('/api/config', async (_req, res) => {
  try {
    res.json({
      gatePwd:  await getConfig('gate_password'),
      adminPwd: await getConfig('admin_password'),
      bans:     await getBans()
    });
  } catch (e) {
    console.error('[get config]', e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Update config ──────────────────────────────────────────────────────
app.put('/api/config', async (req, res) => {
  try {
    const { gatePwd, adminPwd, bans } = req.body || {};

    if (gatePwd  !== undefined) await setConfig('gate_password',  gatePwd);
    if (adminPwd !== undefined) await setConfig('admin_password', adminPwd);

    if (Array.isArray(bans)) {
      await db.execute('DELETE FROM bans');
      for (const u of bans) {
        await db.execute({ sql: 'INSERT OR IGNORE INTO bans (username) VALUES (?)', args: [u] });
      }
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[update config]', e);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🦆 Duck Strike backend running on port ${PORT}`));
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
