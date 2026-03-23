import { Hono } from 'hono';
import * as db from '../db.js';

export const improvementsRoutes = new Hono();

// List improvements
improvementsRoutes.get('/', async (c) => {
  const { status, priority, affected_module, limit, offset } = c.req.query();
  const improvements = await db.listImprovements(c.env.DB, {
    status, priority, affected_module,
    limit: parseInt(limit) || 50,
    offset: parseInt(offset) || 0,
  });
  return c.json({ improvements });
});

// Get single improvement with linked bugs
improvementsRoutes.get('/:id', async (c) => {
  const imp = await db.getImprovementById(c.env.DB, parseInt(c.req.param('id')));
  if (!imp) return c.json({ error: 'Improvement not found' }, 404);
  const bugs = await db.getLinkedBugs(c.env.DB, imp.id);
  return c.json({ improvement: imp, bugs });
});

// Create improvement
improvementsRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const imp = await db.createImprovement(c.env.DB, body);
  return c.json(imp, 201);
});

// Update improvement
improvementsRoutes.patch('/:id', async (c) => {
  const body = await c.req.json();
  const updated = await db.updateImprovement(c.env.DB, parseInt(c.req.param('id')), body);
  if (!updated) return c.json({ error: 'No valid fields to update' }, 400);
  return c.json(updated);
});
