const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/users', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.is_admin, u.created_at,
              COALESCE(h.habit_count, 0)::int AS habit_count
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS habit_count FROM habits GROUP BY user_id
       ) h ON h.user_id = u.id
       ORDER BY u.created_at ASC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('list users error', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.put('/users/:id/admin', async (req, res) => {
  const targetId = Number(req.params.id);
  const isAdmin = Boolean(req.body && req.body.is_admin);
  try {
    if (!isAdmin) {
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS count FROM users WHERE is_admin = TRUE AND id != $1',
        [targetId]
      );
      if (countResult.rows[0].count === 0) {
        return res.status(400).json({ error: 'Cannot remove the last remaining admin' });
      }
    }
    const result = await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2 RETURNING id, username, is_admin, created_at', [
      isAdmin,
      targetId,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('update user admin error', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/users/:id', async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account from here' });
  }
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [targetId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.status(204).end();
  } catch (err) {
    console.error('delete user error', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
