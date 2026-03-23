import { Hono } from 'hono';

export const notificationsRoutes = new Hono();

// List unconsumed notifications (bot polls this)
notificationsRoutes.get('/', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM notifications WHERE consumed = 0 ORDER BY created_at ASC').all();
  return c.json({ notifications: result.results });
});

// Mark notification as consumed
notificationsRoutes.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});
