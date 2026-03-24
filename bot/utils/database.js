const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'bugs.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS bug_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    error_log TEXT,
    ue_version TEXT,
    cb_version TEXT,
    domain TEXT,
    detected_module TEXT,
    steps_to_reproduce TEXT,
    severity TEXT DEFAULT 'Medium',
    status TEXT DEFAULT 'open',
    discord_user TEXT,
    discord_user_id TEXT,
    message_id TEXT,
    fab_order_id TEXT,
    fab_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS improvement_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    affected_module TEXT,
    affected_files TEXT,
    priority TEXT DEFAULT 'Medium',
    status TEXT DEFAULT 'planned',
    target_version TEXT,
    fix_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bug_improvement_links (
    bug_id INTEGER REFERENCES bug_reports(id) ON DELETE CASCADE,
    improvement_id INTEGER REFERENCES improvement_tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (bug_id, improvement_id)
  );
`);

// Fraud log table
db.exec(`
  CREATE TABLE IF NOT EXISTS fab_fraud_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fab_order_id TEXT NOT NULL,
    discord_user TEXT,
    discord_user_id TEXT,
    original_user TEXT,
    original_user_id TEXT,
    action TEXT DEFAULT 'duplicate_attempt',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Order registry - tracks who owns each order ID
db.exec(`
  CREATE TABLE IF NOT EXISTS fab_order_registry (
    fab_order_id TEXT PRIMARY KEY,
    discord_user TEXT,
    discord_user_id TEXT,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate: add fab columns if missing
try { db.exec('ALTER TABLE bug_reports ADD COLUMN fab_order_id TEXT'); } catch (_) {}
try { db.exec('ALTER TABLE bug_reports ADD COLUMN fab_verified INTEGER DEFAULT 0'); } catch (_) {}

// --- Bug Reports ---

function getNextTicketId() {
  const row = db.prepare('SELECT MAX(id) as max_id FROM bug_reports').get();
  const next = (row.max_id || 0) + 1;
  return `CB-${String(next).padStart(3, '0')}`;
}

function createBug({ title, error_log, ue_version, cb_version, domain, detected_module, steps_to_reproduce, severity, discord_user, discord_user_id, message_id, fab_order_id, fab_verified }) {
  const ticket_id = getNextTicketId();
  const stmt = db.prepare(`
    INSERT INTO bug_reports (ticket_id, title, error_log, ue_version, cb_version, domain, detected_module, steps_to_reproduce, severity, discord_user, discord_user_id, message_id, fab_order_id, fab_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(ticket_id, title, error_log, ue_version, cb_version, domain, detected_module, steps_to_reproduce, severity || 'Medium', discord_user, discord_user_id, message_id, fab_order_id || null, fab_verified ? 1 : 0);
  return getBugByTicket(ticket_id);
}

function getBugByTicket(ticket_id) {
  return db.prepare('SELECT * FROM bug_reports WHERE ticket_id = ?').get(ticket_id);
}

function getBugById(id) {
  return db.prepare('SELECT * FROM bug_reports WHERE id = ?').get(id);
}

function listBugs({ status, severity, domain, detected_module, ue_version, search, limit = 50, offset = 0 } = {}) {
  let query = 'SELECT * FROM bug_reports WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (severity) { query += ' AND severity = ?'; params.push(severity); }
  if (domain) { query += ' AND domain = ?'; params.push(domain); }
  if (detected_module) { query += ' AND detected_module = ?'; params.push(detected_module); }
  if (ue_version) { query += ' AND ue_version = ?'; params.push(ue_version); }
  if (search) { query += ' AND (title LIKE ? OR error_log LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

function updateBug(id, fields) {
  const allowed = ['status', 'severity', 'detected_module', 'domain'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return null;

  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.prepare(`UPDATE bug_reports SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getBugById(id);
}

function countBugs() {
  return db.prepare('SELECT COUNT(*) as total FROM bug_reports').get().total;
}

// --- Improvement Tasks ---

function getNextTaskId() {
  const row = db.prepare('SELECT MAX(id) as max_id FROM improvement_tasks').get();
  const next = (row.max_id || 0) + 1;
  return `IMP-${String(next).padStart(3, '0')}`;
}

function createImprovement({ title, description, affected_module, affected_files, priority, target_version, bug_ids }) {
  const task_id = getNextTaskId();
  const stmt = db.prepare(`
    INSERT INTO improvement_tasks (task_id, title, description, affected_module, affected_files, priority, target_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(task_id, title, description, affected_module, JSON.stringify(affected_files || []), priority || 'Medium', target_version);

  const imp = db.prepare('SELECT * FROM improvement_tasks WHERE task_id = ?').get(task_id);

  // Link bugs
  if (bug_ids && bug_ids.length > 0) {
    const linkStmt = db.prepare('INSERT OR IGNORE INTO bug_improvement_links (bug_id, improvement_id) VALUES (?, ?)');
    for (const bugId of bug_ids) {
      linkStmt.run(bugId, imp.id);
    }
  }

  return imp;
}

function listImprovements({ status, priority, affected_module, limit = 50, offset = 0 } = {}) {
  let query = 'SELECT * FROM improvement_tasks WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (priority) { query += ' AND priority = ?'; params.push(priority); }
  if (affected_module) { query += ' AND affected_module = ?'; params.push(affected_module); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params);
}

function updateImprovement(id, fields) {
  const allowed = ['title', 'description', 'affected_module', 'affected_files', 'priority', 'status', 'target_version', 'fix_notes'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(key === 'affected_files' ? JSON.stringify(fields[key]) : fields[key]);
    }
  }
  if (sets.length === 0) return null;

  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.prepare(`UPDATE improvement_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return db.prepare('SELECT * FROM improvement_tasks WHERE id = ?').get(id);
}

function getImprovementById(id) {
  return db.prepare('SELECT * FROM improvement_tasks WHERE id = ?').get(id);
}

function getLinkedBugs(improvement_id) {
  return db.prepare(`
    SELECT b.* FROM bug_reports b
    JOIN bug_improvement_links l ON l.bug_id = b.id
    WHERE l.improvement_id = ?
  `).all(improvement_id);
}

function getLinkedImprovements(bug_id) {
  return db.prepare(`
    SELECT i.* FROM improvement_tasks i
    JOIN bug_improvement_links l ON l.improvement_id = i.id
    WHERE l.bug_id = ?
  `).all(bug_id);
}

function linkBugToImprovement(bug_id, improvement_id) {
  db.prepare('INSERT OR IGNORE INTO bug_improvement_links (bug_id, improvement_id) VALUES (?, ?)').run(bug_id, improvement_id);
}

// --- Analytics ---

function getAnalytics() {
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM bug_reports GROUP BY status').all();
  const bySeverity = db.prepare('SELECT severity, COUNT(*) as count FROM bug_reports GROUP BY severity').all();
  const byModule = db.prepare('SELECT detected_module, COUNT(*) as count FROM bug_reports WHERE detected_module IS NOT NULL GROUP BY detected_module ORDER BY count DESC').all();
  const byUeVersion = db.prepare('SELECT ue_version, COUNT(*) as count FROM bug_reports WHERE ue_version IS NOT NULL GROUP BY ue_version').all();
  const byDomain = db.prepare('SELECT domain, COUNT(*) as count FROM bug_reports WHERE domain IS NOT NULL GROUP BY domain ORDER BY count DESC').all();
  const recentBugs = db.prepare(`SELECT DATE(created_at) as date, COUNT(*) as count FROM bug_reports GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`).all();
  const total = countBugs();
  const totalImprovements = db.prepare('SELECT COUNT(*) as total FROM improvement_tasks').get().total;

  return { byStatus, bySeverity, byModule, byUeVersion, byDomain, recentBugs, total, totalImprovements };
}

// --- FAB Order Registry & Fraud Detection ---

function registerFabOrder(fabOrderId, discordUser, discordUserId) {
  const existing = db.prepare('SELECT * FROM fab_order_registry WHERE fab_order_id = ?').get(fabOrderId);

  if (existing) {
    // Same user = ok, different user = fraud attempt
    if (existing.discord_user_id !== discordUserId) {
      db.prepare(`
        INSERT INTO fab_fraud_log (fab_order_id, discord_user, discord_user_id, original_user, original_user_id, action)
        VALUES (?, ?, ?, ?, ?, 'duplicate_attempt')
      `).run(fabOrderId, discordUser, discordUserId, existing.discord_user, existing.discord_user_id);
      return { registered: false, fraud: true, original_user: existing.discord_user };
    }
    return { registered: true, fraud: false };
  }

  // New order - register it
  db.prepare('INSERT INTO fab_order_registry (fab_order_id, discord_user, discord_user_id) VALUES (?, ?, ?)').run(fabOrderId, discordUser, discordUserId);
  return { registered: true, fraud: false };
}

function getFraudLogs(limit = 50) {
  return db.prepare('SELECT * FROM fab_fraud_log ORDER BY created_at DESC LIMIT ?').all(limit);
}

function getOrderRegistry(limit = 100) {
  return db.prepare('SELECT * FROM fab_order_registry ORDER BY registered_at DESC LIMIT ?').all(limit);
}

function getFraudStats() {
  const totalOrders = db.prepare('SELECT COUNT(*) as count FROM fab_order_registry').get().count;
  const totalAttempts = db.prepare('SELECT COUNT(*) as count FROM fab_fraud_log').get().count;
  const recentAttempts = db.prepare('SELECT * FROM fab_fraud_log ORDER BY created_at DESC LIMIT 10').all();
  const topFraudOrders = db.prepare(`
    SELECT fab_order_id, COUNT(*) as attempts FROM fab_fraud_log
    GROUP BY fab_order_id ORDER BY attempts DESC LIMIT 10
  `).all();
  return { totalOrders, totalAttempts, recentAttempts, topFraudOrders };
}

module.exports = {
  db,
  createBug, getBugByTicket, getBugById, listBugs, updateBug, countBugs,
  createImprovement, listImprovements, updateImprovement, getImprovementById,
  getLinkedBugs, getLinkedImprovements, linkBugToImprovement,
  getAnalytics,
  registerFabOrder, getFraudLogs, getOrderRegistry, getFraudStats,
};

// Allow running directly to init DB
if (require.main === module) {
  console.log('Database initialized at:', DB_PATH);
  console.log('Tables created successfully.');
}
