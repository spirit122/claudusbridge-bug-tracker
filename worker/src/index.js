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

export default app;
