/* ════════════════════════════════════════════════════════════
   TaskFlow — Task Tracker & Daily Diary Frontend Engine
   Talks to the C++ WinSock REST backend
   ════════════════════════════════════════════════════════════ */

const API = (window.location.protocol === 'file:' || !window.location.origin.startsWith('http'))
  ? 'http://localhost:8080/api'
  : '/api';

// ─── Global State ────────────────────────────────────────────
const State = {
  folders:          [],
  tasks:            [],
  analytics:        null,
  activeFolderId:   null,       // null = all folders
  activeTab:        'tasks',    // 'tasks' | 'diary' | 'analytics'
  taskFilter:       'all',      // 'all' | 'pending' | 'in_progress' | 'done'
  selectedWeekKey:  null,       // YYYY-MM-DD
  searchQuery:      '',
};

// ─── API Helpers ─────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText || 'Unknown error' }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

const api = {
  getFolders:   ()           => apiFetch('/folders'),
  addFolder:    (body)       => apiFetch('/folder',        { method: 'POST', body: JSON.stringify(body) }),
  updateFolder: (body)       => apiFetch('/folder/update', { method: 'POST', body: JSON.stringify(body) }),
  deleteFolder: (id)         => apiFetch(`/folder/${id}`,  { method: 'DELETE' }),

  getTasks:     (fid = null) => apiFetch(fid != null ? `/tasks?folder_id=${fid}` : '/tasks'),
  addTask:      (body)       => apiFetch('/task',          { method: 'POST', body: JSON.stringify(body) }),
  toggleTask:   (id)         => apiFetch('/task/toggle',   { method: 'POST', body: JSON.stringify({ id }) }),
  updateTask:   (body)       => apiFetch('/task/update',   { method: 'POST', body: JSON.stringify(body) }),
  deleteTask:   (id)         => apiFetch(`/task/${id}`,    { method: 'DELETE' }),

  getAnalytics: ()           => apiFetch('/analytics'),
};

// ─── Toast Notifications ──────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: '💡' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || '💡'}</span><span>${escHtml(msg)}</span>`;
  const container = document.getElementById('toast-container');
  if (container) container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ─── DATA LOADING ─────────────────────────────────────────────
async function loadAll() {
  try {
    const [folders, tasks, analytics] = await Promise.all([
      api.getFolders(),
      api.getTasks(), // Load all tasks for accurate folder counts and fast client filtering
      api.getAnalytics(),
    ]);

    State.folders   = folders || [];
    State.tasks     = tasks || [];
    State.analytics = analytics || null;

    // Set default selected week for analytics
    if (State.analytics && State.analytics.weekly && State.analytics.weekly.length) {
      if (!State.selectedWeekKey) {
        const curWeek = State.analytics.weekly.find(w => w.is_current) || State.analytics.weekly[State.analytics.weekly.length - 1];
        State.selectedWeekKey = curWeek ? curWeek.week : State.analytics.weekly[0].week;
      }
    }

    renderSidebar();
    renderContent();
  } catch (e) {
    console.error('API Error:', e);
    toast('C++ Backend offline. Start server.exe on port 8080.', 'error');
  }
}

async function reloadAll() {
  await loadAll();
}

// ─── SIDEBAR & N-ARY FOLDER TREE ─────────────────────────────
function renderSidebar() {
  const list = document.getElementById('folder-list');
  if (!list) return;
  list.innerHTML = '';

  // All Tasks entry
  const allCount = State.tasks.filter(t => t.type === 'task').length;
  const allEl = document.createElement('div');
  allEl.className = 'nav-item' + (State.activeFolderId === null ? ' active' : '');
  allEl.innerHTML = `
    <span class="nav-icon">🗂️</span>
    <span style="flex:1">All Tasks</span>
    <span class="nav-badge">${allCount}</span>
  `;
  allEl.addEventListener('click', () => {
    State.activeFolderId = null;
    State.activeTab = 'tasks';
    renderSidebar();
    renderContent();
  });
  list.appendChild(allEl);

  // Build N-ary hierarchy
  const folderMap = new Map();
  State.folders.forEach(f => folderMap.set(f.id, { ...f, children: [] }));
  const roots = [];

  State.folders.forEach(f => {
    const node = folderMap.get(f.id);
    if (f.parent_id !== -1 && folderMap.has(f.parent_id)) {
      folderMap.get(f.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  function renderFolderNode(node, depth = 0) {
    const item = document.createElement('div');
    item.className = 'nav-item' + (State.activeFolderId === node.id ? ' active' : '') + (depth > 0 ? ' folder-child' : '');
    item.dataset.fid = node.id;

    const taskCount = State.tasks.filter(t => t.folder_id === node.id && t.type === 'task').length;
    const colorDot = `<span class="folder-dot" style="background:${node.color || '#6366f1'}"></span>`;

    item.innerHTML = `
      ${colorDot}
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(node.name)}</span>
      <span class="nav-badge">${taskCount}</span>
      <span class="btn-icon edit" title="Edit folder" onclick="openEditFolderModal(${node.id},event)">✏️</span>
      <span class="btn-icon" title="Delete folder" onclick="confirmDeleteFolder(${node.id},event)">🗑</span>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-icon')) return;
      State.activeFolderId = node.id;
      State.activeTab = 'tasks';
      renderSidebar();
      renderContent();
    });

    list.appendChild(item);

    if (node.children && node.children.length > 0) {
      node.children.forEach(child => renderFolderNode(child, depth + 1));
    }
  }

  roots.forEach(root => renderFolderNode(root, 0));

  // Sync sidebar view highlighting
  document.querySelectorAll('#sidebar .nav-section:first-of-type .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === State.activeTab);
  });
}

// ─── CONTENT ROUTER ──────────────────────────────────────────
function renderContent() {
  renderTabs();
  if (State.activeTab === 'tasks')          renderTasks();
  else if (State.activeTab === 'diary')     renderDiary();
  else if (State.activeTab === 'analytics') renderAnalytics();
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === State.activeTab);
  });
  document.querySelectorAll('#sidebar [data-view]').forEach(v => {
    v.classList.toggle('active', v.dataset.view === State.activeTab);
  });
}

function setTab(tab) {
  State.activeTab = tab;
  renderSidebar();
  renderContent();
}

// ─── TASKS VIEW ───────────────────────────────────────────────
function renderTasks() {
  const el = document.getElementById('content');
  if (!el) return;

  // Filter tasks
  let tasks = State.tasks.filter(t => t.type === 'task');

  if (State.activeFolderId !== null) {
    tasks = tasks.filter(t => t.folder_id === State.activeFolderId);
  }

  // Filter by status pill
  if (State.taskFilter === 'pending')     tasks = tasks.filter(t => t.status === 'pending');
  else if (State.taskFilter === 'in_progress') tasks = tasks.filter(t => t.status === 'in_progress');
  else if (State.taskFilter === 'done')   tasks = tasks.filter(t => t.status === 'done');

  // Search filter
  tasks = tasks.filter(matchesSearch);

  const activeFolder = State.activeFolderId !== null ? State.folders.find(f => f.id === State.activeFolderId) : null;
  const folderTitle  = activeFolder ? activeFolder.name : 'All Tasks';

  // Counts for pills
  const totalInScope = State.tasks.filter(t => t.type === 'task' && (State.activeFolderId === null || t.folder_id === State.activeFolderId));
  const cAll         = totalInScope.length;
  const cPending     = totalInScope.filter(t => t.status === 'pending').length;
  const cInProg      = totalInScope.filter(t => t.status === 'in_progress').length;
  const cDone        = totalInScope.filter(t => t.status === 'done').length;
  const progressPct  = cAll > 0 ? Math.round((cDone / cAll) * 100) : 0;

  el.innerHTML = `
    <div class="tasks-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h2>${escHtml(folderTitle)}</h2>
        ${activeFolder ? `
          <button class="filter-pill" onclick="State.activeFolderId=null;renderSidebar();renderContent()">
            ✕ Clear folder filter
          </button>
        ` : ''}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" onclick="openAddTaskModal('diary')">
          ✍️ Diary Note
        </button>
        <button class="btn btn-primary" onclick="openAddTaskModal('task')">
          ＋ Add Task
        </button>
      </div>
    </div>

    <!-- Mini Progress Bar -->
    <div class="tasks-progress-card">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px">
        <span style="font-weight:600;color:var(--text-secondary)">Completion Progress</span>
        <span style="font-weight:700;color:var(--accent-emerald)">${cDone} / ${cAll} tasks completed (${progressPct}%)</span>
      </div>
      <div class="mini-progress-track">
        <div class="mini-progress-fill" style="width:${progressPct}%"></div>
      </div>
    </div>

    <!-- Filter Pills -->
    <div class="task-filter-pills">
      <button class="filter-pill ${State.taskFilter==='all'?'active':''}" onclick="setTaskFilter('all')">
        All (${cAll})
      </button>
      <button class="filter-pill ${State.taskFilter==='pending'?'active':''}" onclick="setTaskFilter('pending')">
        Pending (${cPending})
      </button>
      <button class="filter-pill ${State.taskFilter==='in_progress'?'active':''}" onclick="setTaskFilter('in_progress')">
        In Progress (${cInProg})
      </button>
      <button class="filter-pill ${State.taskFilter==='done'?'active':''}" onclick="setTaskFilter('done')">
        Completed (${cDone})
      </button>
    </div>

    <div id="task-list"></div>
  `;

  const list = document.getElementById('task-list');

  if (!tasks.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📋</div>
        <h3>No tasks found</h3>
        <p>${State.searchQuery ? 'No tasks match your search' : 'Click "+ Add Task" to create your first task in this view'}</p>
      </div>`;
    return;
  }

  // Sort: pending & in_progress first, then high priority
  const prioWeight = { high: 3, medium: 2, low: 1 };
  tasks.sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    return (prioWeight[b.priority] || 0) - (prioWeight[a.priority] || 0);
  });

  tasks.forEach(t => list.appendChild(makeTaskItem(t)));
}

function setTaskFilter(filter) {
  State.taskFilter = filter;
  renderTasks();
}

function makeTaskItem(t) {
  const el = document.createElement('div');
  el.className = 'task-item' + (t.status === 'done' ? ' done' : '');
  el.dataset.priority = t.priority;
  el.dataset.type = t.type;

  const folder = State.folders.find(f => f.id === t.folder_id);
  const folderBadge = folder
    ? `<span class="badge badge-folder" style="color:${folder.color};border-color:${folder.color}55;background:${folder.color}18">📁 ${escHtml(folder.name)}</span>`
    : '';

  const statusClass = t.status === 'done'
    ? 'badge-done'
    : (t.status === 'in_progress' ? 'badge-in_progress' : 'badge-pending');

  const statusLabel = t.status === 'in_progress' ? 'in progress' : t.status;

  el.innerHTML = `
    <div class="task-check ${t.status === 'done' ? 'checked' : ''}"
         title="Click to toggle status"
         onclick="handleToggle(${t.id},event)"></div>
    <div class="task-body" onclick="openEditTaskModal(${t.id})">
      <div class="task-title">${escHtml(t.title)}</div>
      ${t.description ? `<div class="task-desc">${escHtml(t.description)}</div>` : ''}
      <div class="task-meta">
        ${folderBadge}
        <span class="badge badge-priority-${t.priority}">${t.priority}</span>
        <span class="badge ${statusClass}">${statusLabel}</span>
        <span class="task-date">📅 ${t.date}</span>
      </div>
    </div>
    <div class="task-actions">
      <button class="btn-icon edit" title="Edit Task" onclick="openEditTaskModal(${t.id},event)">✏️</button>
      <button class="btn-icon" title="Delete Task" onclick="handleDeleteTask(${t.id},event)">🗑</button>
    </div>
  `;
  return el;
}

// ─── DIARY VIEW ───────────────────────────────────────────────
function renderDiary() {
  const el = document.getElementById('content');
  if (!el) return;

  let entries = State.tasks.filter(t => t.type === 'diary');

  if (State.activeFolderId !== null) {
    entries = entries.filter(t => t.folder_id === State.activeFolderId);
  }

  entries = entries.filter(matchesSearch);

  // Sort chronologically descending
  entries.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.created_at - a.created_at;
  });

  const activeFolder = State.activeFolderId !== null ? State.folders.find(f => f.id === State.activeFolderId) : null;
  const folderTitle  = activeFolder ? `${activeFolder.name} Diary` : 'Daily Diary & Journal';

  el.innerHTML = `
    <div class="tasks-header">
      <div style="display:flex;align-items:center;gap:12px">
        <h2>📓 ${escHtml(folderTitle)}</h2>
        ${activeFolder ? `
          <button class="filter-pill" onclick="State.activeFolderId=null;renderSidebar();renderContent()">
            ✕ All diary entries
          </button>
        ` : ''}
      </div>
      <button class="btn btn-primary" style="background:linear-gradient(135deg,#ec4899,#8b5cf6)"
              onclick="openAddTaskModal('diary')">
        ✍️ New Entry
      </button>
    </div>
    <div id="diary-list"></div>
  `;

  const list = document.getElementById('diary-list');

  if (!entries.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <h3>No diary entries found</h3>
        <p>${State.searchQuery ? 'No journal entries match your search' : 'Start documenting your thoughts, learnings, and reflections'}</p>
      </div>`;
    return;
  }

  entries.forEach(t => list.appendChild(makeDiaryItem(t)));
}

function makeDiaryItem(t) {
  const el = document.createElement('div');
  el.className = 'task-item diary-item';
  el.dataset.type = 'diary';

  const folder = State.folders.find(f => f.id === t.folder_id);
  const folderBadge = folder
    ? `<span class="badge badge-folder" style="color:${folder.color};border-color:${folder.color}55;background:${folder.color}18">📁 ${escHtml(folder.name)}</span>`
    : '';

  el.innerHTML = `
    <span class="diary-icon">📝</span>
    <div class="task-body" onclick="openEditTaskModal(${t.id})">
      <div class="task-title" style="font-size:15px">${escHtml(t.title)}</div>
      <div class="task-desc" style="white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:6px;color:var(--text-secondary)">${escHtml(t.description || '')}</div>
      <div class="task-meta" style="margin-top:12px">
        <span class="badge badge-diary">Diary Entry</span>
        ${folderBadge}
        <span class="task-date">📅 ${t.date}</span>
      </div>
    </div>
    <div class="task-actions">
      <button class="btn-icon edit" title="Edit Entry" onclick="openEditTaskModal(${t.id},event)">✏️</button>
      <button class="btn-icon" title="Delete Entry" onclick="handleDeleteTask(${t.id},event)">🗑</button>
    </div>
  `;
  return el;
}

// ─── ANALYTICS VIEW ───────────────────────────────────────────
function renderAnalytics() {
  const a = State.analytics;
  const el = document.getElementById('content');
  if (!a || !el) return;

  const pct = a.completion_rate_pct != null
    ? a.completion_rate_pct
    : (a.total_tasks > 0 ? Math.round(100 * a.done / a.total_tasks) : 0);

  const weeks = a.weekly || [];
  const selectedWeek = weeks.find(w => w.week === State.selectedWeekKey) || weeks[weeks.length - 1] || null;

  el.innerHTML = `
    <h2 style="margin-bottom:20px">📊 Executive Analytics & Weekly Tracker</h2>

    <div class="stats-grid">
      <div class="stat-card purple">
        <div class="stat-label">Total Tasks</div>
        <div class="stat-value">${a.total_tasks}</div>
      </div>
      <div class="stat-card emerald">
        <div class="stat-label">Completed</div>
        <div class="stat-value">${a.done}</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-label">Pending</div>
        <div class="stat-value">${a.pending}</div>
      </div>
      <div class="stat-card rose">
        <div class="stat-label">In Progress</div>
        <div class="stat-value">${a.in_progress}</div>
      </div>
      <div class="stat-card pink">
        <div class="stat-label">Diary Entries</div>
        <div class="stat-value">${a.diary_entries}</div>
      </div>
    </div>

    <!-- Overall Completion Rate -->
    <div class="card" style="margin-bottom:20px">
      <div class="section-title">Overall Task Completion Rate</div>
      <div style="display:flex;align-items:center;gap:16px">
        <div style="flex:1;height:12px;background:var(--bg-glass);border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent-purple),var(--accent-emerald));border-radius:6px;transition:width 0.8s cubic-bezier(.34,1.56,.64,1)"></div>
        </div>
        <span style="font-weight:800;font-size:18px;color:var(--accent-emerald);min-width:55px">${pct}%</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:8px">
        ${a.done} completed out of ${a.total_tasks} total tasks
      </div>
    </div>

    <!-- By Priority Distribution -->
    <div class="card" style="margin-bottom:20px">
      <div class="section-title">Tasks by Priority</div>
      <div class="priority-row">
        <div class="priority-cell">
          <div class="num" style="color:var(--accent-rose)">${a.by_priority?.high || 0}</div>
          <div class="lbl">High Priority</div>
        </div>
        <div class="priority-cell">
          <div class="num" style="color:var(--accent-amber)">${a.by_priority?.medium || 0}</div>
          <div class="lbl">Medium Priority</div>
        </div>
        <div class="priority-cell">
          <div class="num" style="color:var(--accent-emerald)">${a.by_priority?.low || 0}</div>
          <div class="lbl">Low Priority</div>
        </div>
      </div>
    </div>

    <!-- Weekly Completion Engine -->
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <div class="section-title" style="margin-bottom:0">📅 Weekly Performance Tracker (Mon – Sun)</div>
        ${weeks.length > 1 ? `
          <select id="week-select" class="form-select" style="width:auto;padding:6px 12px;font-size:12px" onchange="changeAnalyticsWeek(this.value)">
            ${weeks.map(w => `<option value="${w.week}" ${w.week === selectedWeek?.week ? 'selected' : ''}>${escHtml(w.label)}${w.is_current ? ' (Current)' : ''}</option>`).join('')}
          </select>
        ` : ''}
      </div>

      <div id="weekly-chart-area"></div>
    </div>
  `;

  renderWeeklyModule(selectedWeek);
}

function changeAnalyticsWeek(weekKey) {
  State.selectedWeekKey = weekKey;
  renderAnalytics();
}

function renderWeeklyModule(week) {
  const container = document.getElementById('weekly-chart-area');
  if (!container) return;

  if (!week) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:20px 0">No weekly data available yet.</p>';
    return;
  }

  const days = week.days || [];
  const weekPct = week.pct != null ? week.pct : 0;

  // Header summary
  let html = `
    <div style="background:var(--bg-glass);border-radius:var(--radius-sm);padding:14px 18px;margin-bottom:16px;border:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:700;font-size:14px">${escHtml(week.label)}</span>
        <span style="font-weight:800;color:var(--accent-emerald)">${weekPct}% Completed</span>
      </div>
      <div style="height:8px;background:var(--bg-secondary);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${weekPct}%;background:linear-gradient(90deg,var(--accent-purple),var(--accent-emerald));border-radius:4px;transition:width 0.6s ease"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px;display:flex;justify-content:space-between">
        <span>${week.done} of ${week.total} tasks completed</span>
        <span>${week.total - week.done} tasks pending</span>
      </div>
    </div>

    <!-- 7-Day Visual Bar Chart -->
    <div class="week-chart">
  `;

  days.forEach(d => {
    // Fill height is proportional to the daily completion percentage (min 4px if tasks exist, up to 80px)
    const fillHeight = d.total > 0 ? Math.max(6, Math.round((d.pct / 100) * 80)) : 0;
    const pctLabel = d.total > 0 ? `${d.pct}%` : '—';
    const shortDate = d.date ? d.date.slice(5) : '';

    html += `
      <div class="week-bar-wrap">
        <span class="week-bar-pct">${pctLabel}</span>
        <div class="week-bar-outer" title="${d.day} (${d.date}): ${d.done}/${d.total} done (${d.pct}%)">
          <div class="week-bar-fill" style="height:${fillHeight}px;background:${d.pct===100?'var(--accent-emerald)':'linear-gradient(to top, var(--accent-purple), var(--accent-blue))'}"></div>
        </div>
        <span class="week-bar-label">${d.day}</span>
        <span class="week-bar-date">${shortDate}</span>
      </div>
    `;
  });

  html += `
    </div>

    <!-- Daily Breakdown Detailed Rows -->
    <div style="margin-top:24px">
      <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px">
        Daily Breakdown (Mon - Sun)
      </div>
  `;

  days.forEach(d => {
    const badgeColor = d.total === 0 ? 'var(--text-muted)' : (d.pct === 100 ? 'var(--accent-emerald)' : 'var(--accent-amber)');
    html += `
      <div class="daily-breakdown-card">
        <div class="daily-breakdown-day">${d.day} <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(${d.date || ''})</span></div>
        <div class="daily-breakdown-bar">
          <div class="daily-breakdown-fill" style="width:${d.pct}%"></div>
        </div>
        <div class="daily-breakdown-stats">
          <span style="font-weight:700;color:${badgeColor}">${d.done}/${d.total}</span>
          <span style="margin-left:6px;font-weight:600">(${d.pct}%)</span>
        </div>
      </div>
    `;
  });

  html += `</div>`;
  container.innerHTML = html;
}

// ─── EVENT HANDLERS ───────────────────────────────────────────
async function handleToggle(id, e) {
  if (e) e.stopPropagation();
  try {
    await api.toggleTask(id);
    await reloadAll();
    toast('Task status updated!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleDeleteTask(id, e) {
  if (e) e.stopPropagation();
  if (!confirm('Are you sure you want to permanently delete this entry?')) return;
  try {
    await api.deleteTask(id);
    await reloadAll();
    toast('Entry permanently deleted', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function confirmDeleteFolder(id, e) {
  if (e) e.stopPropagation();
  const folder = State.folders.find(f => f.id === id);
  const name = folder ? folder.name : 'this folder';
  if (!confirm(`Delete "${name}" and ALL its subfolders and entries?`)) return;
  try {
    await api.deleteFolder(id);
    if (State.activeFolderId === id) State.activeFolderId = null;
    await reloadAll();
    toast('Folder and contents deleted', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── SEARCH HELPER ────────────────────────────────────────────
function matchesSearch(t) {
  if (!State.searchQuery) return true;
  const q = State.searchQuery.toLowerCase();
  return (t.title || '').toLowerCase().includes(q) ||
         (t.description || '').toLowerCase().includes(q);
}

// ─── TASK / DIARY MODALS ──────────────────────────────────────
function openAddTaskModal(type = 'task') {
  const isTask = (type === 'task');
  const today = new Date().toISOString().slice(0, 10);

  const folderOptions = State.folders
    .map(f => `<option value="${f.id}" ${f.id === State.activeFolderId ? 'selected' : ''}>${escHtml(f.name)}</option>`)
    .join('');

  showModal(`
    <div class="modal-header">
      <span class="modal-title">${isTask ? '＋ New Task' : '✍️ New Diary Entry'}</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>

    <div class="form-group">
      <label class="form-label">${isTask ? 'Task Title' : 'Entry Title'} *</label>
      <input id="f-title" class="form-input" placeholder="${isTask ? 'e.g. Solve LeetCode Tree Problems' : 'e.g. Reflections on today\'s achievements'}" autofocus>
    </div>

    <div class="form-group">
      <label class="form-label">${isTask ? 'Task Description / Notes' : 'Journal Content'} </label>
      <textarea id="f-desc" class="form-textarea" placeholder="${isTask ? 'Add subtasks, links or details...' : 'Write your thoughts and learnings here...'}"></textarea>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Date</label>
        <input id="f-date" type="date" class="form-input" value="${today}">
      </div>
      ${isTask ? `
      <div class="form-group">
        <label class="form-label">Priority</label>
        <select id="f-prio" class="form-select">
          <option value="high">🔴 High Priority</option>
          <option value="medium" selected>🟡 Medium Priority</option>
          <option value="low">🟢 Low Priority</option>
        </select>
      </div>` : `
      <div class="form-group">
        <label class="form-label">Mood / Tag</label>
        <select id="f-prio" class="form-select">
          <option value="medium" selected>📝 Standard Note</option>
          <option value="high">⭐ Key Milestone</option>
          <option value="low">💡 Idea / Scratchpad</option>
        </select>
      </div>`}
    </div>

    <div class="form-group">
      <label class="form-label">Folder</label>
      <select id="f-folder" class="form-select">
        <option value="-1">— General (No Folder) —</option>
        ${folderOptions}
      </select>
    </div>

    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="submitTask('${type}')">
        ${isTask ? '＋ Create Task' : '✍️ Save Entry'}
      </button>
    </div>
  `);
}

async function submitTask(type) {
  const title = document.getElementById('f-title')?.value?.trim();
  if (!title) {
    toast('Title is required', 'error');
    return;
  }

  const body = {
    title,
    description: document.getElementById('f-desc')?.value?.trim() || '',
    date:        document.getElementById('f-date')?.value || '',
    type:        type,
    priority:    document.getElementById('f-prio')?.value || 'medium',
    folder_id:   parseInt(document.getElementById('f-folder')?.value ?? '-1'),
    status:      'pending',
  };

  try {
    await api.addTask(body);
    closeModal();
    await reloadAll();
    toast(`${type === 'task' ? 'Task' : 'Diary entry'} successfully created!`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditTaskModal(id, e) {
  if (e) e.stopPropagation();
  const task = State.tasks.find(t => t.id === id);
  if (!task) return;

  const isTask = (task.type === 'task');

  const folderOptions = State.folders
    .map(f => `<option value="${f.id}" ${f.id === task.folder_id ? 'selected' : ''}>${escHtml(f.name)}</option>`)
    .join('');

  showModal(`
    <div class="modal-header">
      <span class="modal-title">✏️ Edit ${isTask ? 'Task' : 'Diary Entry'}</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>

    <div class="form-group">
      <label class="form-label">Title *</label>
      <input id="fe-title" class="form-input" value="${escHtml(task.title)}" autofocus>
    </div>

    <div class="form-group">
      <label class="form-label">${isTask ? 'Description' : 'Journal Content'}</label>
      <textarea id="fe-desc" class="form-textarea">${escHtml(task.description || '')}</textarea>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Date</label>
        <input id="fe-date" type="date" class="form-input" value="${task.date}">
      </div>

      <div class="form-group">
        <label class="form-label">Status</label>
        <select id="fe-status" class="form-select">
          <option value="pending" ${task.status==='pending'?'selected':''}>⏳ Pending</option>
          <option value="in_progress" ${task.status==='in_progress'?'selected':''}>⚡ In Progress</option>
          <option value="done" ${task.status==='done'?'selected':''}>✅ Completed</option>
        </select>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Priority</label>
        <select id="fe-prio" class="form-select">
          <option value="high" ${task.priority==='high'?'selected':''}>🔴 High</option>
          <option value="medium" ${task.priority==='medium'?'selected':''}>🟡 Medium</option>
          <option value="low" ${task.priority==='low'?'selected':''}>🟢 Low</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Folder</label>
        <select id="fe-folder" class="form-select">
          <option value="-1" ${task.folder_id===-1?'selected':''}>— General (No Folder) —</option>
          ${folderOptions}
        </select>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="submitEditTask(${task.id})">
        Save Changes
      </button>
    </div>
  `);
}

async function submitEditTask(id) {
  const title = document.getElementById('fe-title')?.value?.trim();
  if (!title) {
    toast('Title is required', 'error');
    return;
  }

  const body = {
    id:          id,
    title:       title,
    description: document.getElementById('fe-desc')?.value?.trim() || '',
    date:        document.getElementById('fe-date')?.value || '',
    priority:    document.getElementById('fe-prio')?.value || 'medium',
    status:      document.getElementById('fe-status')?.value || 'pending',
    folder_id:   parseInt(document.getElementById('fe-folder')?.value ?? '-1'),
  };

  try {
    await api.updateTask(body);
    closeModal();
    await reloadAll();
    toast('Changes saved successfully!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── FOLDER MODALS ────────────────────────────────────────────
function openAddFolderModal() {
  const palette = ['#6366f1','#f59e0b','#10b981','#ec4899','#3b82f6','#8b5cf6','#06b6d4','#f43f5e'];

  const parentOptions = State.folders
    .map(f => `<option value="${f.id}">📁 ${escHtml(f.name)}</option>`)
    .join('');

  showModal(`
    <div class="modal-header">
      <span class="modal-title">📁 Create Custom Folder</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>

    <div class="form-group">
      <label class="form-label">Folder Name *</label>
      <input id="f-fname" class="form-input" placeholder="e.g. 💻 Dynamic Programming" autofocus>
    </div>

    <div class="form-group">
      <label class="form-label">Visual Color Badge</label>
      <div class="color-row" id="color-row" style="margin-bottom:8px">
        ${palette.map((c, i) => `
          <div class="color-dot ${i===0?'selected':''}"
               style="background:${c}"
               data-color="${c}"
               onclick="selectColor(this)"></div>
        `).join('')}
      </div>
      <input id="f-fcolor" class="form-input" value="${palette[0]}" placeholder="#6366f1">
    </div>

    <div class="form-group">
      <label class="form-label">Parent Folder (Tree Hierarchy)</label>
      <select id="f-fparent" class="form-select">
        <option value="-1">— Root (Top Level) —</option>
        ${parentOptions}
      </select>
    </div>

    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="submitFolder()">
        Create Folder
      </button>
    </div>
  `);
}

function selectColor(el) {
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('selected'));
  el.classList.add('selected');
  const input = document.getElementById('f-fcolor');
  if (input) input.value = el.dataset.color;
}

async function submitFolder() {
  const name  = document.getElementById('f-fname')?.value?.trim();
  const color = document.getElementById('f-fcolor')?.value?.trim() || '#6366f1';
  const parent_id = parseInt(document.getElementById('f-fparent')?.value ?? '-1');

  if (!name) {
    toast('Folder name is required', 'error');
    return;
  }

  try {
    await api.addFolder({ name, color, parent_id });
    closeModal();
    await reloadAll();
    toast('Folder created successfully!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function openEditFolderModal(id, e) {
  if (e) e.stopPropagation();
  const folder = State.folders.find(f => f.id === id);
  if (!folder) return;

  const palette = ['#6366f1','#f59e0b','#10b981','#ec4899','#3b82f6','#8b5cf6','#06b6d4','#f43f5e'];

  const parentOptions = State.folders
    .filter(f => f.id !== id) // Can't be own parent
    .map(f => `<option value="${f.id}" ${f.id === folder.parent_id ? 'selected' : ''}>📁 ${escHtml(f.name)}</option>`)
    .join('');

  showModal(`
    <div class="modal-header">
      <span class="modal-title">✏️ Edit Folder</span>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>

    <div class="form-group">
      <label class="form-label">Folder Name *</label>
      <input id="fe-fname" class="form-input" value="${escHtml(folder.name)}" autofocus>
    </div>

    <div class="form-group">
      <label class="form-label">Visual Color Badge</label>
      <div class="color-row" id="color-row" style="margin-bottom:8px">
        ${palette.map(c => `
          <div class="color-dot ${c.toLowerCase() === folder.color.toLowerCase() ? 'selected' : ''}"
               style="background:${c}"
               data-color="${c}"
               onclick="selectColor(this)"></div>
        `).join('')}
      </div>
      <input id="f-fcolor" class="form-input" value="${folder.color}" placeholder="#6366f1">
    </div>

    <div class="form-group">
      <label class="form-label">Parent Folder (Tree Hierarchy)</label>
      <select id="fe-fparent" class="form-select">
        <option value="-1" ${folder.parent_id===-1?'selected':''}>— Root (Top Level) —</option>
        ${parentOptions}
      </select>
    </div>

    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn btn-secondary" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:2" onclick="submitEditFolder(${folder.id})">
        Save Folder
      </button>
    </div>
  `);
}

async function submitEditFolder(id) {
  const name  = document.getElementById('fe-fname')?.value?.trim();
  const color = document.getElementById('f-fcolor')?.value?.trim() || '#6366f1';
  const parent_id = parseInt(document.getElementById('fe-fparent')?.value ?? '-1');

  if (!name) {
    toast('Folder name is required', 'error');
    return;
  }

  try {
    await api.updateFolder({ id, name, color, parent_id });
    closeModal();
    await reloadAll();
    toast('Folder updated!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── MODAL ENGINE ─────────────────────────────────────────────
function showModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
  overlay.querySelector('input, textarea')?.focus();
}

function closeModal() {
  document.getElementById('modal-overlay')?.remove();
}

// ─── UTILITY HELPERS ──────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── INITIALIZATION ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Search input binding
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      State.searchQuery = e.target.value;
      renderContent();
    });
  }

  // Top tab buttons
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
  });

  // Initial data load
  loadAll();
});
