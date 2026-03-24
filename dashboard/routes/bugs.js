const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../../bot/utils/database');

const router = Router();
const FIX_REQUESTS_DIR = path.join(__dirname, '..', '..', 'data', 'fix-requests');

// List bugs with filters
router.get('/', (req, res) => {
  const { status, severity, domain, detected_module, ue_version, search, limit, offset } = req.query;
  const bugs = db.listBugs({
    status, severity, domain, detected_module, ue_version, search,
    limit: parseInt(limit) || 50,
    offset: parseInt(offset) || 0,
  });
  res.json({ bugs, total: db.countBugs() });
});

// Get single bug
router.get('/:id', (req, res) => {
  const bug = db.getBugById(parseInt(req.params.id));
  if (!bug) return res.status(404).json({ error: 'Bug not found' });

  const improvements = db.getLinkedImprovements(bug.id);
  res.json({ bug, improvements });
});

// Update bug status/fields
router.patch('/:id', (req, res) => {
  const updated = db.updateBug(parseInt(req.params.id), req.body);
  if (!updated) return res.status(400).json({ error: 'No valid fields to update' });

  // Broadcast status change
  if (req.app.broadcast) {
    req.app.broadcast('bug_updated', { bug: updated });
  }

  res.json(updated);
});

// Link bug to improvement
router.post('/:id/link', (req, res) => {
  const { improvement_id } = req.body;
  db.linkBugToImprovement(parseInt(req.params.id), improvement_id);
  res.json({ success: true });
});

// Receive new bug from Discord bot
router.post('/', (req, res) => {
  const { title, error_log, ue_version, cb_version, domain, detected_module, steps_to_reproduce, severity, discord_user, discord_user_id } = req.body;

  const bug = db.createBug({
    title, error_log, ue_version, cb_version, domain, detected_module,
    steps_to_reproduce, severity, discord_user, discord_user_id, message_id: null,
  });

  // Broadcast new bug to all connected dashboards
  if (req.app.broadcast) {
    req.app.broadcast('new_bug', { bug });
  }

  res.status(201).json(bug);
});

// Request fix - sends to Worker API (fix-poller picks it up)
router.post('/:id/fix-request', async (req, res) => {
  const bug = db.getBugById(parseInt(req.params.id));
  if (!bug) return res.status(404).json({ error: 'Bug not found' });

  // Send fix request to Worker so fix-poller can process it
  const workerUrl = process.env.WORKER_URL || 'https://claudusbridge-bugs.eosspirit.workers.dev';
  try {
    await fetch(`${workerUrl}/api/bugs/${bug.id}/fix-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_) {
    // Fallback: save locally
    fs.mkdirSync(FIX_REQUESTS_DIR, { recursive: true });
    const request = {
      ticket_id: bug.ticket_id, bug_id: bug.id, title: bug.title,
      error_log: bug.error_log, detected_module: bug.detected_module,
      domain: bug.domain, ue_version: bug.ue_version, cb_version: bug.cb_version,
      steps_to_reproduce: bug.steps_to_reproduce, severity: bug.severity,
      discord_user: bug.discord_user, discord_user_id: bug.discord_user_id,
      requested_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(FIX_REQUESTS_DIR, `${bug.ticket_id}.json`), JSON.stringify(request, null, 2));
  }

  // Update bug status to investigating
  const updated = db.updateBug(bug.id, { status: 'investigating' });

  if (req.app.broadcast) {
    req.app.broadcast('fix_requested', { bug: updated, ticket_id: bug.ticket_id });
  }

  res.json({ success: true, ticket_id: bug.ticket_id });
});

module.exports = router;
