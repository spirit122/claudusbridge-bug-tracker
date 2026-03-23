const express = require('express');
const path = require('path');
const cors = require('cors');
const bugsRouter = require('./routes/bugs');
const improvementsRouter = require('./routes/improvements');
const analyticsRouter = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/bugs', bugsRouter);
app.use('/api/improvements', improvementsRouter);
app.use('/api/analytics', analyticsRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ClaudusBridge Dashboard running at http://localhost:${PORT}`);
});
