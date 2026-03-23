// D1 database helpers - port of bot/utils/database.js

export async function getNextTicketId(db) {
  const row = await db.prepare('SELECT MAX(id) as max_id FROM bug_reports').first();
  const next = (row?.max_id || 0) + 1;
  return `CB-${String(next).padStart(3, '0')}`;
}

export async function createBug(db, { title, error_log, ue_version, cb_version, domain, detected_module, steps_to_reproduce, severity, discord_user, discord_user_id, message_id }) {
  const ticket_id = await getNextTicketId(db);
  await db.prepare(`
    INSERT INTO bug_reports (ticket_id, title, error_log, ue_version, cb_version, domain, detected_module, steps_to_reproduce, severity, discord_user, discord_user_id, message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(ticket_id, title, error_log || null, ue_version || null, cb_version || null, domain || null, detected_module || null, steps_to_reproduce || null, severity || 'Medium', discord_user || null, discord_user_id || null, message_id || null).run();
  return await getBugByTicket(db, ticket_id);
}

export async function getBugByTicket(db, ticket_id) {
  return await db.prepare('SELECT * FROM bug_reports WHERE ticket_id = ?').bind(ticket_id).first();
}

export async function getBugById(db, id) {
  return await db.prepare('SELECT * FROM bug_reports WHERE id = ?').bind(id).first();
}

export async function listBugs(db, { status, severity, domain, detected_module, ue_version, search, limit = 50, offset = 0 } = {}) {
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

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return result.results;
}

export async function countBugs(db) {
  const row = await db.prepare('SELECT COUNT(*) as total FROM bug_reports').first();
  return row?.total || 0;
}

export async function updateBug(db, id, fields) {
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

  await db.prepare(`UPDATE bug_reports SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  return await getBugById(db, id);
}

// --- Improvement Tasks ---

export async function getNextTaskId(db) {
  const row = await db.prepare('SELECT MAX(id) as max_id FROM improvement_tasks').first();
  const next = (row?.max_id || 0) + 1;
  return `IMP-${String(next).padStart(3, '0')}`;
}

export async function createImprovement(db, { title, description, affected_module, affected_files, priority, target_version, bug_ids }) {
  const task_id = await getNextTaskId(db);
  await db.prepare(`
    INSERT INTO improvement_tasks (task_id, title, description, affected_module, affected_files, priority, target_version)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(task_id, title, description || null, affected_module || null, JSON.stringify(affected_files || []), priority || 'Medium', target_version || null).run();

  const imp = await db.prepare('SELECT * FROM improvement_tasks WHERE task_id = ?').bind(task_id).first();

  if (bug_ids && bug_ids.length > 0) {
    for (const bugId of bug_ids) {
      await db.prepare('INSERT OR IGNORE INTO bug_improvement_links (bug_id, improvement_id) VALUES (?, ?)').bind(bugId, imp.id).run();
    }
  }

  return imp;
}

export async function listImprovements(db, { status, priority, affected_module, limit = 50, offset = 0 } = {}) {
  let query = 'SELECT * FROM improvement_tasks WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (priority) { query += ' AND priority = ?'; params.push(priority); }
  if (affected_module) { query += ' AND affected_module = ?'; params.push(affected_module); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return result.results;
}

export async function updateImprovement(db, id, fields) {
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

  await db.prepare(`UPDATE improvement_tasks SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  return await db.prepare('SELECT * FROM improvement_tasks WHERE id = ?').bind(id).first();
}

export async function getImprovementById(db, id) {
  return await db.prepare('SELECT * FROM improvement_tasks WHERE id = ?').bind(id).first();
}

export async function getLinkedBugs(db, improvement_id) {
  const result = await db.prepare(`
    SELECT b.* FROM bug_reports b
    JOIN bug_improvement_links l ON l.bug_id = b.id
    WHERE l.improvement_id = ?
  `).bind(improvement_id).all();
  return result.results;
}

export async function getLinkedImprovements(db, bug_id) {
  const result = await db.prepare(`
    SELECT i.* FROM improvement_tasks i
    JOIN bug_improvement_links l ON l.improvement_id = i.id
    WHERE l.bug_id = ?
  `).bind(bug_id).all();
  return result.results;
}

export async function linkBugToImprovement(db, bug_id, improvement_id) {
  await db.prepare('INSERT OR IGNORE INTO bug_improvement_links (bug_id, improvement_id) VALUES (?, ?)').bind(bug_id, improvement_id).run();
}

// --- Analytics ---

export async function getAnalytics(db) {
  const byStatus = (await db.prepare('SELECT status, COUNT(*) as count FROM bug_reports GROUP BY status').all()).results;
  const bySeverity = (await db.prepare('SELECT severity, COUNT(*) as count FROM bug_reports GROUP BY severity').all()).results;
  const byModule = (await db.prepare('SELECT detected_module, COUNT(*) as count FROM bug_reports WHERE detected_module IS NOT NULL GROUP BY detected_module ORDER BY count DESC').all()).results;
  const byUeVersion = (await db.prepare('SELECT ue_version, COUNT(*) as count FROM bug_reports WHERE ue_version IS NOT NULL GROUP BY ue_version').all()).results;
  const byDomain = (await db.prepare('SELECT domain, COUNT(*) as count FROM bug_reports WHERE domain IS NOT NULL GROUP BY domain ORDER BY count DESC').all()).results;
  const recentBugs = (await db.prepare('SELECT DATE(created_at) as date, COUNT(*) as count FROM bug_reports GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30').all()).results;
  const total = await countBugs(db);
  const totalImprovements = (await db.prepare('SELECT COUNT(*) as total FROM improvement_tasks').first())?.total || 0;

  return { byStatus, bySeverity, byModule, byUeVersion, byDomain, recentBugs, total, totalImprovements };
}

// --- Events ---

export async function createEvent(db, type, payload) {
  await db.prepare('INSERT INTO events (type, payload) VALUES (?, ?)').bind(type, JSON.stringify(payload)).run();
}

export async function getEventsSince(db, sinceId) {
  const result = await db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT 50').bind(sinceId).all();
  return result.results;
}
