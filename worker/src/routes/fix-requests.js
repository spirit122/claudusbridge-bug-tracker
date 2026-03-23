import { Hono } from 'hono';

export const fixRequestsRoutes = new Hono();

// List pending fix requests (MCP polls this)
fixRequestsRoutes.get('/', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM fix_requests ORDER BY requested_at DESC').all();
  return c.json({ fix_requests: result.results });
});

// Delete fix request after resolution
fixRequestsRoutes.delete('/:ticket_id', async (c) => {
  const ticket_id = c.req.param('ticket_id');
  await c.env.DB.prepare('DELETE FROM fix_requests WHERE ticket_id = ?').bind(ticket_id).run();
  return c.json({ success: true });
});
