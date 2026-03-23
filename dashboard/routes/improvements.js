const { Router } = require('express');
const db = require('../../bot/utils/database');

const router = Router();

// List improvements
router.get('/', (req, res) => {
  const { status, priority, affected_module, limit, offset } = req.query;
  const improvements = db.listImprovements({
    status, priority, affected_module,
    limit: parseInt(limit) || 50,
    offset: parseInt(offset) || 0,
  });
  res.json({ improvements });
});

// Get single improvement with linked bugs
router.get('/:id', (req, res) => {
  const imp = db.getImprovementById(parseInt(req.params.id));
  if (!imp) return res.status(404).json({ error: 'Improvement not found' });

  const bugs = db.getLinkedBugs(imp.id);
  res.json({ improvement: imp, bugs });
});

// Create improvement (from dashboard)
router.post('/', (req, res) => {
  const { title, description, affected_module, affected_files, priority, target_version, bug_ids } = req.body;
  const imp = db.createImprovement({ title, description, affected_module, affected_files, priority, target_version, bug_ids });
  res.status(201).json(imp);
});

// Update improvement
router.patch('/:id', (req, res) => {
  const updated = db.updateImprovement(parseInt(req.params.id), req.body);
  if (!updated) return res.status(400).json({ error: 'No valid fields to update' });
  res.json(updated);
});

module.exports = router;
