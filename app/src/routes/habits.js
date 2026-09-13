const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

const TARGET_PERIODS = new Set(['day', 'week', 'month']);

function sanitizeHabitInput(body) {
  const out = {};
  if (typeof body.name === 'string' && body.name.trim()) out.name = body.name.trim();
  if (body.category === null || body.category === undefined) out.category = null;
  else if (typeof body.category === 'string') out.category = body.category.trim() || null;

  if (body.target_count === null || body.target_count === undefined || body.target_count === '') {
    out.target_count = null;
  } else {
    const n = Number(body.target_count);
    out.target_count = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }

  if (body.target_period === null || body.target_period === undefined || body.target_period === '') {
    out.target_period = null;
  } else if (TARGET_PERIODS.has(body.target_period)) {
    out.target_period = body.target_period;
  } else {
    out.target_period = null;
  }
  if (!out.target_count) out.target_period = null;
  if (out.target_count && !out.target_period) out.target_period = 'day';

  if (body.overdue_hours === null || body.overdue_hours === undefined || body.overdue_hours === '') {
    out.overdue_hours = null;
  } else {
    const n = Number(body.overdue_hours);
    out.overdue_hours = Number.isFinite(n) && n > 0 ? n : null;
  }

  return out;
}

async function loadHabitsWithCompletions(userId) {
  const habitsResult = await pool.query(
    'SELECT * FROM habits WHERE user_id = $1 ORDER BY sort_order ASC, id ASC',
    [userId]
  );
  const habits = habitsResult.rows;
  const habitIds = habits.map((h) => h.id);

  let completionsByHabit = {};
  if (habitIds.length > 0) {
    const completionsResult = await pool.query(
      'SELECT * FROM completions WHERE habit_id = ANY($1) ORDER BY completed_at ASC',
      [habitIds]
    );
    completionsByHabit = completionsResult.rows.reduce((acc, row) => {
      (acc[row.habit_id] = acc[row.habit_id] || []).push(row);
      return acc;
    }, {});
  }

  return habits.map((h) => ({ ...h, completions: completionsByHabit[h.id] || [] }));
}

router.get('/', async (req, res) => {
  try {
    const habits = await loadHabitsWithCompletions(req.user.id);
    res.json({ habits });
  } catch (err) {
    console.error('list habits error', err);
    res.status(500).json({ error: 'Failed to load habits' });
  }
});

router.post('/', async (req, res) => {
  const input = sanitizeHabitInput(req.body || {});
  if (!input.name) return res.status(400).json({ error: 'Habit name is required' });
  try {
    const maxOrderResult = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM habits WHERE user_id = $1',
      [req.user.id]
    );
    const nextOrder = maxOrderResult.rows[0].next_order;
    const insertResult = await pool.query(
      `INSERT INTO habits (user_id, name, category, target_count, target_period, overdue_hours, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, input.name, input.category ?? null, input.target_count, input.target_period, input.overdue_hours, nextOrder]
    );
    res.status(201).json({ habit: { ...insertResult.rows[0], completions: [] } });
  } catch (err) {
    console.error('create habit error', err);
    res.status(500).json({ error: 'Failed to create habit' });
  }
});

async function findOwnedHabit(habitId, userId) {
  const result = await pool.query('SELECT * FROM habits WHERE id = $1 AND user_id = $2', [habitId, userId]);
  return result.rows[0];
}

router.put('/:id', async (req, res) => {
  const habitId = Number(req.params.id);
  try {
    const existing = await findOwnedHabit(habitId, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Habit not found' });

    const input = sanitizeHabitInput({ ...existing, ...req.body });
    if (!input.name) return res.status(400).json({ error: 'Habit name is required' });

    const updateResult = await pool.query(
      `UPDATE habits SET name = $1, category = $2, target_count = $3, target_period = $4, overdue_hours = $5
       WHERE id = $6 AND user_id = $7 RETURNING *`,
      [input.name, input.category ?? null, input.target_count, input.target_period, input.overdue_hours, habitId, req.user.id]
    );
    res.json({ habit: updateResult.rows[0] });
  } catch (err) {
    console.error('update habit error', err);
    res.status(500).json({ error: 'Failed to update habit' });
  }
});

router.post('/:id/archive', async (req, res) => {
  const habitId = Number(req.params.id);
  const archived = Boolean(req.body && req.body.archived);
  try {
    const result = await pool.query(
      'UPDATE habits SET archived = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [archived, habitId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Habit not found' });
    res.json({ habit: result.rows[0] });
  } catch (err) {
    console.error('archive habit error', err);
    res.status(500).json({ error: 'Failed to archive habit' });
  }
});

router.delete('/:id', async (req, res) => {
  const habitId = Number(req.params.id);
  try {
    const result = await pool.query('DELETE FROM habits WHERE id = $1 AND user_id = $2 RETURNING id', [
      habitId,
      req.user.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Habit not found' });
    res.status(204).end();
  } catch (err) {
    console.error('delete habit error', err);
    res.status(500).json({ error: 'Failed to delete habit' });
  }
});

router.put('/reorder/all', async (req, res) => {
  const order = Array.isArray(req.body && req.body.order) ? req.body.order.map(Number) : null;
  if (!order) return res.status(400).json({ error: 'order must be an array of habit ids' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < order.length; i++) {
      await client.query('UPDATE habits SET sort_order = $1 WHERE id = $2 AND user_id = $3', [
        i,
        order[i],
        req.user.id,
      ]);
    }
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('reorder habits error', err);
    res.status(500).json({ error: 'Failed to reorder habits' });
  } finally {
    client.release();
  }
});

router.post('/:id/completions', async (req, res) => {
  const habitId = Number(req.params.id);
  try {
    const habit = await findOwnedHabit(habitId, req.user.id);
    if (!habit) return res.status(404).json({ error: 'Habit not found' });

    let completedAt = new Date();
    if (req.body && req.body.completed_at) {
      const parsed = new Date(req.body.completed_at);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid completed_at date' });
      }
      if (parsed.getTime() > Date.now() + 60000) {
        return res.status(400).json({ error: 'completed_at cannot be in the future' });
      }
      completedAt = parsed;
    }

    const insertResult = await pool.query(
      'INSERT INTO completions (habit_id, completed_at) VALUES ($1, $2) RETURNING *',
      [habitId, completedAt.toISOString()]
    );
    res.status(201).json({ completion: insertResult.rows[0] });
  } catch (err) {
    console.error('log completion error', err);
    res.status(500).json({ error: 'Failed to log completion' });
  }
});

router.delete('/:habitId/completions/:completionId', async (req, res) => {
  const { habitId, completionId } = req.params;
  try {
    const result = await pool.query(
      `DELETE FROM completions c USING habits h
       WHERE c.id = $1 AND c.habit_id = $2 AND h.id = c.habit_id AND h.user_id = $3
       RETURNING c.id`,
      [completionId, habitId, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Completion not found' });
    res.status(204).end();
  } catch (err) {
    console.error('delete completion error', err);
    res.status(500).json({ error: 'Failed to delete completion' });
  }
});

module.exports = router;
module.exports.loadHabitsWithCompletions = loadHabitsWithCompletions;
module.exports.sanitizeHabitInput = sanitizeHabitInput;
