const express = require('express');
const { pool } = require('../db');
const {
  hashPassword,
  comparePassword,
  signToken,
  setAuthCookie,
  clearAuthCookie,
} = require('../auth');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

function publicUser(row) {
  return { id: row.id, username: row.username, is_admin: row.is_admin, created_at: row.created_at };
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const cleanUsername = username.trim();

  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [cleanUsername]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'That username is already taken' });
    }

    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const isFirstUser = countResult.rows[0].count === 0;

    const passwordHash = await hashPassword(password);
    const insertResult = await pool.query(
      'INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3) RETURNING *',
      [cleanUsername, passwordHash, isFirstUser]
    );
    const user = insertResult.rows[0];

    const token = signToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('me error', err);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

module.exports = router;
