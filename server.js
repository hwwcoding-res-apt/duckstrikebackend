// ═══════════════════════════════════════════════════════════════════
//  DUCK STRIKE — server.js additions
//  Add these routes to your existing server.js file.
//
//  IMPORTANT: Replace `users` below with whatever variable/object/map
//  you use to store registered accounts in your server.js.
//  Common names: users, accounts, db.users, userStore, etc.
//
//  The route assumes your user objects look like:
//    { username, passwordHash, xp, level }
//  which matches what your existing PUT /api/users/:username stores.
// ═══════════════════════════════════════════════════════════════════


// ── GET /api/admin/users ─────────────────────────────────────────
// Returns all registered accounts as { username: { xp, level } }.
// Used by the admin panel Accounts section.
// No authentication required (admin password is checked client-side,
// and this endpoint only exposes XP/level — no passwords).
app.get('/api/admin/users', (req, res) => {
  try {
    const out = {};
    // ------------------------------------------------------------------
    // Adapt the line below to match how YOUR server stores users.
    //
    // If users is a plain object keyed by username:
    //   Object.keys(users).forEach(username => { ... })
    //
    // If users is a Map:
    //   users.forEach((u, username) => { ... })
    //
    // If users is a JSON file read into memory:
    //   Same as plain object below.
    // ------------------------------------------------------------------
    Object.keys(users).forEach(username => {
      const u = users[username];
      out[username] = {
        xp:    u.xp    ?? 0,
        level: u.level ?? 1,
      };
    });
    res.json(out);
  } catch (err) {
    console.error('[admin/users]', err);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});


// ── DELETE /api/users/:username ──────────────────────────────────
// Permanently remove an account.
// You may already have this — check before adding.
app.delete('/api/users/:username', (req, res) => {
  const username = decodeURIComponent(req.params.username);
  if (!users[username]) {
    return res.status(404).json({ error: 'User not found.' });
  }
  delete users[username];
  // If you persist users to a file/DB, save here:
  // saveUsers();   ← call your persistence function
  res.json({ success: true });
});


// ═══════════════════════════════════════════════════════════════════
//  NOTES ON BAN STORAGE
//
//  Bans are already stored in your config object via PUT /api/config
//  with { bans: ["username1", "username2"] }.  That continues to work
//  as-is — no changes needed there.
//
//  The admin panel now:
//    1. Loads ALL users from GET /api/admin/users
//    2. Loads the ban list from GET /api/config
//    3. Cross-references them to show BANNED badges + Ban/Unban buttons
//    4. Saves ban changes to PUT /api/config as before
//
//  If you want ban status baked into the user record itself instead,
//  you can also store it on the user object and include it in the
//  GET /api/admin/users response as: banned: u.banned ?? false
//  — but that's optional, the current approach works fine.
// ═══════════════════════════════════════════════════════════════════
