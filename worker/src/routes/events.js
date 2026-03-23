import { Hono } from 'hono';
import * as db from '../db.js';

export const eventsRoutes = new Hono();

// Poll-based events (replaces SSE)
eventsRoutes.get('/', async (c) => {
  const since = parseInt(c.req.query('since') || '0');
  const events = await db.getEventsSince(c.env.DB, since);
  return c.json({ events });
});
