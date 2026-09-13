const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { loadHabitsWithCompletions, sanitizeHabitInput } = require('./habits');

const router = express.Router();
router.use(requireAuth);

router.get('/export', async (req, res) => {
  try {
    const habits = await loadHabitsWithCompletions(req.user.id);
    res.json({
      exportedAt: new Date().toISOString(),
      username: req.user.username,
      habits: habits.map((h) => ({
        name: h.name,
        category: h.category,
        target_count: h.target_count,
        target_period: h.target_period,
        overdue_hours: h.overdue_hours,
        archived: h.archived,
        sort_order: h.sort_order,
        completions: h.completions.map((c) => ({ completed_at: c.completed_at })),
      })),
    });
  } catch (err) {
    console.error('export error', err);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

router.post('/import', async (req, res) => {
  const habits = req.body && Array.isArray(req.body.habits) ? req.body.habits : null;
  if (!habits) return res.status(400).json({ error: 'Import payload must include a habits array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM habits WHERE user_id = $1', [req.user.id]);

    for (let i = 0; i < habits.length; i++) {
      const raw = habits[i] || {};
      const input = sanitizeHabitInput(raw);
      if (!input.name) continue;

      const habitResult = await client.query(
        `INSERT INTO habits (user_id, name, category, target_count, target_period, overdue_hours, archived, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          req.user.id,
          input.name,
          input.category ?? null,
          input.target_count,
          input.target_period,
          input.overdue_hours,
          Boolean(raw.archived),
          Number.isFinite(Number(raw.sort_order)) ? Number(raw.sort_order) : i,
        ]
      );
      const habitId = habitResult.rows[0].id;

      const completions = Array.isArray(raw.completions) ? raw.completions : [];
      for (const c of completions) {
        const parsed = new Date(c.completed_at);
        if (!Number.isNaN(parsed.getTime())) {
          await client.query('INSERT INTO completions (habit_id, completed_at) VALUES ($1, $2)', [
            habitId,
            parsed.toISOString(),
          ]);
        }
      }
    }

    await client.query('COMMIT');
    const freshHabits = await loadHabitsWithCompletions(req.user.id);
    res.json({ habits: freshHabits });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('import error', err);
    res.status(500).json({ error: 'Failed to import data' });
  } finally {
    client.release();
  }
});

module.exports = router;
