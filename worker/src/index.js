import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bugsRoutes } from './routes/bugs.js';
import { improvementsRoutes } from './routes/improvements.js';
import { analyticsRoutes } from './routes/analytics.js';
import { fixRequestsRoutes } from './routes/fix-requests.js';
import { notificationsRoutes } from './routes/notifications.js';
import { eventsRoutes } from './routes/events.js';

const app = new Hono();

// CORS
app.use('/api/*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type', 'Authorization'] }));

// Auth middleware for write operations
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'OPTIONS') return next();

  const apiKey = c.env.API_KEY;
  if (!apiKey) return next(); // No key configured = no auth required

  const auth = c.req.header('Authorization');
  if (!auth || auth !== `Bearer ${apiKey}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

// Routes
app.route('/api/bugs', bugsRoutes);
app.route('/api/improvements', improvementsRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/api/fix-requests', fixRequestsRoutes);
app.route('/api/notifications', notificationsRoutes);
app.route('/api/events', eventsRoutes);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// --- Fraud API (private - for team only) ---
app.get('/api/fraud/logs', async (c) => {
  const D1 = c.env.DB;
  const limit = parseInt(c.req.query('limit')) || 50;
  const logs = (await D1.prepare('SELECT * FROM fab_fraud_log ORDER BY created_at DESC LIMIT ?').bind(limit).all()).results;
  return c.json({ logs });
});

app.get('/api/fraud/registry', async (c) => {
  const D1 = c.env.DB;
  const limit = parseInt(c.req.query('limit')) || 100;
  const orders = (await D1.prepare('SELECT * FROM fab_order_registry ORDER BY registered_at DESC LIMIT ?').bind(limit).all()).results;
  return c.json({ orders });
});

app.get('/api/fraud/stats', async (c) => {
  const D1 = c.env.DB;
  const totalOrders = (await D1.prepare('SELECT COUNT(*) as count FROM fab_order_registry').first())?.count || 0;
  const totalAttempts = (await D1.prepare('SELECT COUNT(*) as count FROM fab_fraud_log').first())?.count || 0;
  const recentAttempts = (await D1.prepare('SELECT * FROM fab_fraud_log ORDER BY created_at DESC LIMIT 10').all()).results;
  const topFraudOrders = (await D1.prepare('SELECT fab_order_id, COUNT(*) as attempts FROM fab_fraud_log GROUP BY fab_order_id ORDER BY attempts DESC LIMIT 10').all()).results;
  return c.json({ totalOrders, totalAttempts, recentAttempts, topFraudOrders });
});

// Register order + detect fraud (called by bot on each report)
app.post('/api/fraud/register', async (c) => {
  const D1 = c.env.DB;
  const { fab_order_id, discord_user, discord_user_id } = await c.req.json();
  if (!fab_order_id) return c.json({ error: 'Missing fab_order_id' }, 400);

  const existing = await D1.prepare('SELECT * FROM fab_order_registry WHERE fab_order_id = ?').bind(fab_order_id).first();

  if (existing && existing.discord_user_id !== discord_user_id) {
    // Fraud: log it silently
    await D1.prepare(
      'INSERT INTO fab_fraud_log (fab_order_id, discord_user, discord_user_id, original_user, original_user_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(fab_order_id, discord_user, discord_user_id, existing.discord_user, existing.discord_user_id).run();
    return c.json({ registered: false, fraud: true });
  }

  if (!existing) {
    await D1.prepare('INSERT INTO fab_order_registry (fab_order_id, discord_user, discord_user_id) VALUES (?, ?, ?)').bind(fab_order_id, discord_user, discord_user_id).run();
  }

  return c.json({ registered: true, fraud: false });
});

// Run migrations
app.post('/api/migrate', async (c) => {
  const D1 = c.env.DB;
  const results = [];
  const migrations = [
    'ALTER TABLE bug_reports ADD COLUMN fab_order_id TEXT',
    'ALTER TABLE bug_reports ADD COLUMN fab_verified INTEGER DEFAULT 0',
    `CREATE TABLE IF NOT EXISTS fab_fraud_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fab_order_id TEXT NOT NULL,
      discord_user TEXT,
      discord_user_id TEXT,
      original_user TEXT,
      original_user_id TEXT,
      action TEXT DEFAULT 'duplicate_attempt',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS fab_order_registry (
      fab_order_id TEXT PRIMARY KEY,
      discord_user TEXT,
      discord_user_id TEXT,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const sql of migrations) {
    try { await D1.prepare(sql).run(); results.push({ sql, status: 'ok' }); }
    catch (e) { results.push({ sql, status: 'skipped', reason: e.message }); }
  }
  return c.json({ results });
});

export default app;
