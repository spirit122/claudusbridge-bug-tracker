const { Router } = require('express');
const db = require('../../bot/utils/database');

const router = Router();

router.get('/', (req, res) => {
  const analytics = db.getAnalytics();
  res.json(analytics);
});

module.exports = router;
