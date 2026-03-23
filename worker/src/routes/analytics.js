import { Hono } from 'hono';
import * as db from '../db.js';

export const analyticsRoutes = new Hono();

analyticsRoutes.get('/', async (c) => {
  const analytics = await db.getAnalytics(c.env.DB);
  return c.json(analytics);
});
