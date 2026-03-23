const express = require('express');
const path = require('path');
const cors = require('cors');
const bugsRouter = require('./routes/bugs');
const improvementsRouter = require('./routes/improvements');
const analyticsRouter = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3000;

// SSE clients
const sseClients = new Set();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('data: {"type":"connected"}\n\n');

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Broadcast function - available to routes
app.broadcast = function(eventType, data) {
  const payload = JSON.stringify({ type: eventType, ...data });
  for (const client of sseClients) {
    client.write(`data: ${payload}\n\n`);
  }
};

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
  console.log(`SSE endpoint: http://localhost:${PORT}/api/events`);
});

module.exports = app;
