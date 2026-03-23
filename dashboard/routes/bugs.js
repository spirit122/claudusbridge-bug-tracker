const { Router } = require('express');
const db = require('../../bot/utils/database');

const router = Router();

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
  res.json(updated);
});

// Link bug to improvement
router.post('/:id/link', (req, res) => {
  const { improvement_id } = req.body;
  db.linkBugToImprovement(parseInt(req.params.id), improvement_id);
  res.json({ success: true });
});

module.exports = router;
