const API = '';
let searchTimeout = null;
let lastEventId = 0;

// --- Navigation ---
function navigate(view) {
  document.querySelectorAll('.main > div[id^="view-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) viewEl.classList.remove('hidden');

  const navEl = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navEl) navEl.classList.add('active');

  switch (view) {
    case 'bugs': loadBugs(); break;
    case 'improvements': loadImprovements(); break;
    case 'analytics': loadAnalytics(); break;
  }
}

// --- Bugs ---
async function loadBugs() {
  const params = new URLSearchParams();
  const status = document.getElementById('filter-status').value;
  const severity = document.getElementById('filter-severity').value;
  const ue = document.getElementById('filter-ue').value;
  const search = document.getElementById('filter-search').value;

  if (status) params.set('status', status);
  if (severity) params.set('severity', severity);
  if (ue) params.set('ue_version', ue);
  if (search) params.set('search', search);

  try {
    const res = await fetch(`${API}/api/bugs?${params}`);
    const data = await res.json();

    document.getElementById('bug-count').textContent = `${data.total} total`;

    const tbody = document.getElementById('bugs-table');
    if (data.bugs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-secondary);padding:40px">No bug reports yet. They will appear here when users submit via /report-bug in Discord.</td></tr>';
      return;
    }

    tbody.innerHTML = data.bugs.map(bug => {
      const fabBadge = bug.fab_order_id
        ? (bug.fab_verified ? '<span class="fab-badge fab-verified" title="FAB Purchase Verified">&#10003; FAB</span>' : '<span class="fab-badge fab-pending" title="Pending Verification">&#9203; FAB</span>')
        : '<span class="fab-badge fab-none" title="No FAB Order ID">&#10007; FAB</span>';
      return `
      <tr>
        <td onclick="showBugDetail(${bug.id})" style="cursor:pointer"><strong style="color:var(--accent)">${bug.ticket_id}</strong></td>
        <td onclick="showBugDetail(${bug.id})" style="cursor:pointer">${escHtml(bug.title)}</td>
        <td><span class="badge badge-${bug.severity.toLowerCase()}">${bug.severity}</span></td>
        <td style="color:var(--text-secondary)">${bug.detected_module || '-'}</td>
        <td>${bug.ue_version || '-'}</td>
        <td><span class="badge badge-${bug.status}">${bug.status}</span></td>
        <td style="color:var(--text-secondary)">${bug.discord_user || '-'} ${fabBadge}</td>
        <td style="color:var(--text-secondary)">${formatDate(bug.created_at)}</td>
        <td>
          ${bug.status !== 'fixed' ? `<button class="btn btn-solve" onclick="event.stopPropagation();requestFix(${bug.id},'${escAttr(bug.ticket_id)}')">Solucionar</button>` : `<span class="badge badge-fixed">Resuelto</span>`}
        </td>
      </tr>
    `}).join('');
  } catch (err) {
    console.error('Failed to load bugs:', err);
  }
}

async function showBugDetail(id) {
  try {
    const res = await fetch(`${API}/api/bugs/${id}`);
    const data = await res.json();
    const bug = data.bug;
    const improvements = data.improvements || [];

    document.querySelectorAll('.main > div[id^="view-"]').forEach(el => el.classList.add('hidden'));
    document.getElementById('view-bug-detail').classList.remove('hidden');

    document.getElementById('bug-detail-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3><span style="color:var(--accent)">${bug.ticket_id}</span> ${escHtml(bug.title)}</h3>
          <div class="btn-group">
            <button class="btn btn-primary" onclick="showCreateImprovementFromBug(${bug.id}, '${escAttr(bug.detected_module || '')}')">Create Improvement</button>
          </div>
        </div>

        <div class="detail-section">
          <div class="detail-fields">
            <div class="detail-field">
              <label>Status</label>
              <select class="filter-select" onchange="updateBugField(${bug.id}, 'status', this.value)">
                ${['open','investigating','fixed','wont-fix'].map(s => `<option value="${s}" ${bug.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="detail-field">
              <label>Severity</label>
              <select class="filter-select" onchange="updateBugField(${bug.id}, 'severity', this.value)">
                ${['Critical','High','Medium','Low'].map(s => `<option value="${s}" ${bug.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="detail-field"><label>UE Version</label><span>${bug.ue_version || 'N/A'}</span></div>
            <div class="detail-field"><label>CB Version</label><span>${bug.cb_version || 'N/A'}</span></div>
            <div class="detail-field"><label>Detected Module</label><span style="color:var(--accent)">${bug.detected_module || 'Unknown'}</span></div>
            <div class="detail-field"><label>Domain</label><span>${bug.domain || 'Unknown'}</span></div>
            <div class="detail-field"><label>Reporter</label><span>${bug.discord_user || 'Unknown'}</span></div>
            <div class="detail-field"><label>FAB Order</label><span>${bug.fab_order_id ? `<code>${escHtml(bug.fab_order_id)}</code> ${bug.fab_verified ? '<span class="fab-badge fab-verified">Verified</span>' : '<span class="fab-badge fab-pending">Pending</span>'}` : '<span class="fab-badge fab-none">No Order ID</span>'}</span></div>
            <div class="detail-field"><label>Reported</label><span>${formatDate(bug.created_at)}</span></div>
          </div>
        </div>

        ${bug.error_log ? `
        <div class="detail-section">
          <h4>Error Log</h4>
          <div class="log-block">${escHtml(bug.error_log)}</div>
        </div>` : ''}

        ${bug.steps_to_reproduce ? `
        <div class="detail-section">
          <h4>Steps to Reproduce</h4>
          <div class="log-block" style="font-family:var(--font)">${escHtml(bug.steps_to_reproduce)}</div>
        </div>` : ''}

        ${improvements.length > 0 ? `
        <div class="detail-section">
          <h4>Linked Improvements</h4>
          ${improvements.map(imp => `
            <div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
              <strong style="color:var(--accent)">${imp.task_id}</strong>
              <span>${escHtml(imp.title)}</span>
              <span class="badge badge-${imp.status}">${imp.status}</span>
            </div>
          `).join('')}
        </div>` : ''}
      </div>
    `;
  } catch (err) {
    console.error('Failed to load bug detail:', err);
  }
}

async function updateBugField(id, field, value) {
  try {
    await fetch(`${API}/api/bugs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
  } catch (err) {
    console.error('Failed to update bug:', err);
  }
}

// --- Improvements ---
async function loadImprovements() {
  const params = new URLSearchParams();
  const status = document.getElementById('filter-imp-status').value;
  const priority = document.getElementById('filter-imp-priority').value;

  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);

  try {
    const res = await fetch(`${API}/api/improvements?${params}`);
    const data = await res.json();

    const tbody = document.getElementById('improvements-table');
    if (data.improvements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:40px">No improvement tasks yet. Create one from a bug report.</td></tr>';
      return;
    }

    tbody.innerHTML = data.improvements.map(imp => `
      <tr onclick="showImprovementDetail(${imp.id})">
        <td><strong style="color:var(--accent)">${imp.task_id}</strong></td>
        <td>${escHtml(imp.title)}</td>
        <td><span class="badge badge-${imp.priority.toLowerCase()}">${imp.priority}</span></td>
        <td style="color:var(--text-secondary)">${imp.affected_module || '-'}</td>
        <td><span class="badge badge-${imp.status}">${imp.status}</span></td>
        <td>${imp.target_version || '-'}</td>
        <td style="color:var(--text-secondary)">${formatDate(imp.created_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Failed to load improvements:', err);
  }
}

async function showImprovementDetail(id) {
  try {
    const res = await fetch(`${API}/api/improvements/${id}`);
    const data = await res.json();
    const imp = data.improvement;
    const bugs = data.bugs || [];
    const files = JSON.parse(imp.affected_files || '[]');

    const modal = `
      <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
        <div class="modal" style="min-width:560px">
          <h3><span style="color:var(--accent)">${imp.task_id}</span> ${escHtml(imp.title)}</h3>

          <div class="detail-fields" style="margin-bottom:16px">
            <div class="detail-field">
              <label>Status</label>
              <select class="filter-select" onchange="updateImprovement(${imp.id}, 'status', this.value)">
                ${['planned','in-progress','fixed','released'].map(s => `<option value="${s}" ${imp.status === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="detail-field">
              <label>Priority</label>
              <select class="filter-select" onchange="updateImprovement(${imp.id}, 'priority', this.value)">
                ${['Critical','High','Medium','Low'].map(s => `<option value="${s}" ${imp.priority === s ? 'selected' : ''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="detail-field"><label>Module</label><span>${imp.affected_module || '-'}</span></div>
            <div class="detail-field"><label>Target Version</label><span>${imp.target_version || '-'}</span></div>
          </div>

          ${imp.description ? `<div class="detail-section"><h4>Description</h4><p style="color:var(--text-secondary);font-size:14px">${escHtml(imp.description)}</p></div>` : ''}
          ${files.length > 0 ? `<div class="detail-section"><h4>Affected Files</h4><div class="log-block">${files.join('\n')}</div></div>` : ''}

          <div class="form-group">
            <label>Fix Notes</label>
            <textarea id="fix-notes-input" rows="3" placeholder="What was changed and why...">${escHtml(imp.fix_notes || '')}</textarea>
          </div>
          <button class="btn btn-primary" onclick="saveFixNotes(${imp.id})">Save Notes</button>

          ${bugs.length > 0 ? `
          <div class="detail-section" style="margin-top:16px">
            <h4>Linked Bug Reports (${bugs.length})</h4>
            ${bugs.map(b => `
              <div style="display:flex;gap:10px;align-items:center;padding:6px 0">
                <strong style="color:var(--accent)">${b.ticket_id}</strong>
                <span>${escHtml(b.title)}</span>
                <span class="badge badge-${b.severity.toLowerCase()}">${b.severity}</span>
              </div>
            `).join('')}
          </div>` : ''}

          <div style="margin-top:16px;text-align:right">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-container').innerHTML = modal;
  } catch (err) {
    console.error('Failed to load improvement:', err);
  }
}

async function updateImprovement(id, field, value) {
  try {
    await fetch(`${API}/api/improvements/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
  } catch (err) {
    console.error('Failed to update improvement:', err);
  }
}

async function saveFixNotes(id) {
  const notes = document.getElementById('fix-notes-input').value;
  await updateImprovement(id, 'fix_notes', notes);
  closeModal();
}

function showCreateImprovement() {
  showCreateImprovementFromBug(null, '');
}

function showCreateImprovementFromBug(bugId, module) {
  const modal = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal">
        <h3>New Improvement Task</h3>
        <div class="form-group"><label>Title</label><input id="imp-title" placeholder="Fix for..."></div>
        <div class="form-group"><label>Description</label><textarea id="imp-desc" rows="3" placeholder="What needs to be changed and why"></textarea></div>
        <div class="form-group"><label>Affected Module</label><input id="imp-module" value="${escAttr(module)}" placeholder="e.g., CBMeshManager"></div>
        <div class="form-group"><label>Affected Files (one per line)</label><textarea id="imp-files" rows="2" placeholder="CBMeshManager.cpp&#10;CBMeshManager.h"></textarea></div>
        <div style="display:flex;gap:10px">
          <div class="form-group" style="flex:1">
            <label>Priority</label>
            <select id="imp-priority" class="filter-select">
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium" selected>Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div class="form-group" style="flex:1">
            <label>Target Version</label>
            <input id="imp-version" placeholder="e.g., v0.3.0">
          </div>
        </div>
        ${bugId ? `<input type="hidden" id="imp-bug-id" value="${bugId}">` : ''}
        <div class="btn-group" style="justify-content:flex-end;margin-top:12px">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitImprovement()">Create</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('modal-container').innerHTML = modal;
}

async function submitImprovement() {
  const bugIdEl = document.getElementById('imp-bug-id');
  const body = {
    title: document.getElementById('imp-title').value,
    description: document.getElementById('imp-desc').value,
    affected_module: document.getElementById('imp-module').value,
    affected_files: document.getElementById('imp-files').value.split('\n').map(s => s.trim()).filter(Boolean),
    priority: document.getElementById('imp-priority').value,
    target_version: document.getElementById('imp-version').value,
    bug_ids: bugIdEl ? [parseInt(bugIdEl.value)] : [],
  };

  if (!body.title) { alert('Title is required'); return; }

  try {
    await fetch(`${API}/api/improvements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    closeModal();
    navigate('improvements');
  } catch (err) {
    console.error('Failed to create improvement:', err);
  }
}

// --- Analytics ---
async function loadAnalytics() {
  try {
    const res = await fetch(`${API}/api/analytics`);
    const data = await res.json();

    const openCount = (data.byStatus.find(s => s.status === 'open') || {}).count || 0;
    const fixedCount = (data.byStatus.find(s => s.status === 'fixed') || {}).count || 0;
    const criticalCount = (data.bySeverity.find(s => s.severity === 'Critical') || {}).count || 0;

    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card"><div class="stat-value">${data.total}</div><div class="stat-label">Total Bugs</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--critical)">${openCount}</div><div class="stat-label">Open</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--success)">${fixedCount}</div><div class="stat-label">Fixed</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--critical)">${criticalCount}</div><div class="stat-label">Critical</div></div>
      <div class="stat-card"><div class="stat-value">${data.totalImprovements}</div><div class="stat-label">Improvements</div></div>
    `;

    const maxModule = Math.max(...data.byModule.map(m => m.count), 1);
    const maxDomain = Math.max(...data.byDomain.map(d => d.count), 1);
    const colors = ['#7c3aed', '#ff4444', '#ff8800', '#ffcc00', '#00ccff', '#00ff88', '#ff66cc', '#66ccff', '#cc66ff', '#ffaa33'];

    document.getElementById('charts').innerHTML = `
      <div class="chart-card">
        <h4>Bugs by Module (Top 10)</h4>
        <div class="bar-chart">
          ${data.byModule.slice(0, 10).map((m, i) => `
            <div class="bar-row">
              <div class="bar-label">${m.detected_module}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${(m.count/maxModule)*100}%;background:${colors[i % colors.length]}"></div></div>
              <div class="bar-count">${m.count}</div>
            </div>
          `).join('')}
          ${data.byModule.length === 0 ? '<p style="color:var(--text-secondary);font-size:13px">No data yet</p>' : ''}
        </div>
      </div>

      <div class="chart-card">
        <h4>Bugs by Domain</h4>
        <div class="bar-chart">
          ${data.byDomain.slice(0, 10).map((d, i) => `
            <div class="bar-row">
              <div class="bar-label">${d.domain}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${(d.count/maxDomain)*100}%;background:${colors[i % colors.length]}"></div></div>
              <div class="bar-count">${d.count}</div>
            </div>
          `).join('')}
          ${data.byDomain.length === 0 ? '<p style="color:var(--text-secondary);font-size:13px">No data yet</p>' : ''}
        </div>
      </div>

      <div class="chart-card">
        <h4>By Severity</h4>
        <div class="bar-chart">
          ${data.bySeverity.map(s => `
            <div class="bar-row">
              <div class="bar-label">${s.severity}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${(s.count/Math.max(...data.bySeverity.map(x=>x.count),1))*100}%;background:var(--${s.severity.toLowerCase()})"></div></div>
              <div class="bar-count">${s.count}</div>
            </div>
          `).join('')}
          ${data.bySeverity.length === 0 ? '<p style="color:var(--text-secondary);font-size:13px">No data yet</p>' : ''}
        </div>
      </div>

      <div class="chart-card">
        <h4>By UE Version</h4>
        <div class="bar-chart">
          ${data.byUeVersion.map((v, i) => `
            <div class="bar-row">
              <div class="bar-label">UE ${v.ue_version}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${(v.count/Math.max(...data.byUeVersion.map(x=>x.count),1))*100}%;background:${colors[i % colors.length]}"></div></div>
              <div class="bar-count">${v.count}</div>
            </div>
          `).join('')}
          ${data.byUeVersion.length === 0 ? '<p style="color:var(--text-secondary);font-size:13px">No data yet</p>' : ''}
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}

// --- Helpers ---
function closeModal() {
  document.getElementById('modal-container').innerHTML = '';
}

function escHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadBugs, 300);
}

// --- Fix Request ---
async function requestFix(bugId, ticketId) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const res = await fetch(`${API}/api/bugs/${bugId}/fix-request`, { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      btn.textContent = 'Enviado a Claude';
      btn.classList.remove('btn-solve');
      btn.classList.add('btn-success');

      document.getElementById('modal-container').innerHTML = `
        <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
          <div class="modal" style="text-align:center;min-width:400px">
            <div style="font-size:48px;margin-bottom:16px">🔧</div>
            <h3 style="margin-bottom:8px">Fix Request Enviado</h3>
            <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px">
              <strong style="color:var(--accent)">${ticketId}</strong> ha sido enviado a Claude Code para analisis y solucion.
            </p>
            <p style="color:var(--text-secondary);font-size:13px;margin-bottom:20px">
              Claude leera el error log, analizara el codigo fuente del plugin, aplicara el fix y notificara al reporter cuando este listo.
            </p>
            <button class="btn btn-primary" onclick="closeModal()">Entendido</button>
          </div>
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to request fix:', err);
    btn.textContent = 'Error';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = 'Solucionar'; }, 2000);
  }
}

// --- Real-time Polling (replaces SSE) ---
let pollingReady = false;

async function pollEvents() {
  try {
    const res = await fetch(`${API}/api/events?since=${lastEventId}`);
    const data = await res.json();

    for (const evt of data.events) {
      lastEventId = evt.id;

      // Skip old events on first load - only notify for NEW ones
      if (!pollingReady) continue;

      const payload = JSON.parse(evt.payload || '{}');

      switch (evt.type) {
        case 'new_bug':
          showNotification(`Nuevo bug: ${payload.bug?.ticket_id}`, 'info');
          if (!document.getElementById('view-bugs').classList.contains('hidden')) loadBugs();
          break;
        case 'bug_updated':
          if (!document.getElementById('view-bugs').classList.contains('hidden')) loadBugs();
          break;
        case 'fix_requested':
          showNotification(`${payload.ticket_id} enviado a Claude`, 'accent');
          break;
      }
    }

    // After first poll, we're caught up - now show notifications for truly new events
    pollingReady = true;
  } catch (err) {
    // Silent fail — will retry on next poll
  }
}

function showNotification(message, type) {
  const notif = document.createElement('div');
  notif.className = `toast toast-${type}`;
  notif.textContent = message;
  document.body.appendChild(notif);
  requestAnimationFrame(() => notif.classList.add('toast-show'));
  setTimeout(() => {
    notif.classList.remove('toast-show');
    setTimeout(() => notif.remove(), 300);
  }, 2500);
}

// --- Bottom Panels ---
async function loadBottomPanels() {
  try {
    const [bugsRes, analyticsRes, healthRes] = await Promise.all([
      fetch(`${API}/api/bugs`),
      fetch(`${API}/api/analytics`),
      fetch(`${API}/api/health`),
    ]);
    const bugsData = await bugsRes.json();
    const analytics = await analyticsRes.json();
    const health = await healthRes.json();

    const bugs = bugsData.bugs || [];
    const total = bugsData.total || 0;
    const openCount = (analytics.byStatus || []).find(s => s.status === 'open')?.count || 0;
    const fixedCount = (analytics.byStatus || []).find(s => s.status === 'fixed')?.count || 0;
    const investigatingCount = (analytics.byStatus || []).find(s => s.status === 'investigating')?.count || 0;
    const criticalCount = (analytics.bySeverity || []).find(s => s.severity === 'Critical')?.count || 0;

    // Quick stats - 2 col grid with total spanning full width
    document.getElementById('quick-stats').innerHTML = `
      <div class="qs-card qs-card-full">
        <div class="qs-value" style="color:var(--accent)">${total}</div>
        <div class="qs-label">Total Bugs</div>
      </div>
      <div class="qs-card">
        <div class="qs-value" style="color:var(--critical)">${openCount}</div>
        <div class="qs-label">Open</div>
      </div>
      <div class="qs-card">
        <div class="qs-value" style="color:var(--high)">${investigatingCount}</div>
        <div class="qs-label">Investigating</div>
      </div>
      <div class="qs-card">
        <div class="qs-value" style="color:var(--success)">${fixedCount}</div>
        <div class="qs-label">Fixed</div>
      </div>
      <div class="qs-card">
        <div class="qs-value" style="color:var(--critical)">${criticalCount}</div>
        <div class="qs-label">Critical</div>
      </div>
    `;

    // Activity feed - show recent bugs as activity
    const activityEl = document.getElementById('activity-feed');
    if (bugs.length === 0) {
      activityEl.innerHTML = '<div class="activity-empty">No activity yet. Bugs will show here when reported via Discord.</div>';
    } else {
      activityEl.innerHTML = bugs.slice(0, 6).map(bug => {
        const dotColor = bug.status === 'fixed' ? 'var(--success)' : bug.status === 'investigating' ? 'var(--high)' : 'var(--critical)';
        const action = bug.status === 'fixed' ? 'Fixed' : bug.status === 'investigating' ? 'Investigating' : 'Reported';
        return `
          <div class="activity-item">
            <div class="activity-dot" style="background:${dotColor}"></div>
            <div>
              <div class="activity-text"><strong>${bug.ticket_id}</strong> ${action}: ${escHtml(bug.title.substring(0, 50))}${bug.title.length > 50 ? '...' : ''}</div>
              <div class="activity-time">${bug.discord_user || 'System'} &middot; ${formatDate(bug.updated_at || bug.created_at)}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    // Module bars
    const moduleEl = document.getElementById('module-bars');
    const modules = analytics.byModule || [];
    const barColors = ['#7c3aed', '#ff4444', '#ff8800', '#00ccff', '#00ff88', '#ffcc00', '#ff66cc', '#66ccff'];
    if (modules.length === 0) {
      moduleEl.innerHTML = '<div class="activity-empty">No module data yet</div>';
    } else {
      const maxCount = Math.max(...modules.map(m => m.count), 1);
      moduleEl.innerHTML = modules.slice(0, 8).map((m, i) => `
        <div class="module-bar-row">
          <div class="module-bar-name">${m.detected_module}</div>
          <div class="module-bar-track"><div class="module-bar-fill" style="width:${(m.count/maxCount)*100}%;background:${barColors[i % barColors.length]}"></div></div>
          <div class="module-bar-count">${m.count}</div>
        </div>
      `).join('');
    }

    // System status
    document.getElementById('system-info').innerHTML = `
      <div class="sys-row"><span>Worker API</span><span class="sys-badge sys-online">${health.status === 'ok' ? 'Online' : 'Error'}</span></div>
      <div class="sys-row"><span>Discord Bot</span><span class="sys-badge sys-online">Connected</span></div>
      <div class="sys-row"><span>D1 Database</span><span class="sys-badge sys-online">${total} records</span></div>
      <div class="sys-row"><span>Fix Poller</span><span class="sys-badge sys-online">Active</span></div>
      <div class="sys-row"><span>Last Check</span><span style="font-size:11px;color:var(--text-secondary)">${new Date().toLocaleTimeString()}</span></div>
    `;

  } catch (err) {
    console.error('Failed to load bottom panels:', err);
  }
}

// --- Init ---
navigate('bugs');
loadBottomPanels();
pollEvents(); // First poll catches up silently
setInterval(pollEvents, 10000);
setInterval(loadBottomPanels, 30000); // Refresh panels every 30s
