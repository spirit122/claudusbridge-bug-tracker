import { Hono } from 'hono';
import * as db from '../db.js';

export const bugsRoutes = new Hono();

// List bugs with filters
bugsRoutes.get('/', async (c) => {
  const { status, severity, domain, detected_module, ue_version, search, limit, offset } = c.req.query();
  const bugs = await db.listBugs(c.env.DB, {
    status, severity, domain, detected_module, ue_version, search,
    limit: parseInt(limit) || 50,
    offset: parseInt(offset) || 0,
  });
  const total = await db.countBugs(c.env.DB);
  return c.json({ bugs, total });
});

// Get single bug
bugsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  // Support both numeric ID and ticket_id (CB-xxx)
  let bug;
  if (id.startsWith('CB-')) {
    bug = await db.getBugByTicket(c.env.DB, id);
  } else {
    bug = await db.getBugById(c.env.DB, parseInt(id));
  }
  if (!bug) return c.json({ error: 'Bug not found' }, 404);

  const improvements = await db.getLinkedImprovements(c.env.DB, bug.id);
  return c.json({ bug, improvements });
});

// Create new bug (from Discord bot)
bugsRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const bug = await db.createBug(c.env.DB, body);
  await db.createEvent(c.env.DB, 'new_bug', { bug });
  return c.json(bug, 201);
});

// Update bug
bugsRoutes.patch('/:id', async (c) => {
  const body = await c.req.json();
  const updated = await db.updateBug(c.env.DB, parseInt(c.req.param('id')), body);
  if (!updated) return c.json({ error: 'No valid fields to update' }, 400);
  await db.createEvent(c.env.DB, 'bug_updated', { bug: updated });
  return c.json(updated);
});

// Link bug to improvement
bugsRoutes.post('/:id/link', async (c) => {
  const { improvement_id } = await c.req.json();
  await db.linkBugToImprovement(c.env.DB, parseInt(c.req.param('id')), improvement_id);
  return c.json({ success: true });
});

// Fix request
bugsRoutes.post('/:id/fix-request', async (c) => {
  const D1 = c.env.DB;
  const bug = await db.getBugById(D1, parseInt(c.req.param('id')));
  if (!bug) return c.json({ error: 'Bug not found' }, 404);

  // Insert fix request into D1
  await D1.prepare(`
    INSERT INTO fix_requests (ticket_id, bug_id, title, error_log, detected_module, domain, ue_version, cb_version, steps_to_reproduce, severity, discord_user, discord_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(bug.ticket_id, bug.id, bug.title, bug.error_log, bug.detected_module, bug.domain, bug.ue_version, bug.cb_version, bug.steps_to_reproduce, bug.severity, bug.discord_user, bug.discord_user_id).run();

  // Update status to investigating
  const updated = await db.updateBug(D1, bug.id, { status: 'investigating' });
  await db.createEvent(D1, 'fix_requested', { bug: updated, ticket_id: bug.ticket_id });

  return c.json({ success: true, ticket_id: bug.ticket_id });
});

// Resolve bug (from MCP)
bugsRoutes.post('/:id/resolve', async (c) => {
  const D1 = c.env.DB;
  const { fix_notes } = await c.req.json();
  const id = c.req.param('id');

  let bug;
  if (id.startsWith('CB-')) {
    bug = await db.getBugByTicket(D1, id);
  } else {
    bug = await db.getBugById(D1, parseInt(id));
  }
  if (!bug) return c.json({ error: 'Bug not found' }, 404);

  // Update bug status to fixed
  const updated = await db.updateBug(D1, bug.id, { status: 'fixed' });

  // Create notification for Discord bot
  await D1.prepare(`
    INSERT INTO notifications (type, ticket_id, title, discord_user_id, discord_user, fix_notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind('bug_resolved', bug.ticket_id, bug.title, bug.discord_user_id, bug.discord_user, fix_notes || '').run();

  await db.createEvent(D1, 'bug_updated', { bug: updated });

  return c.json({ success: true, bug: updated });
});
