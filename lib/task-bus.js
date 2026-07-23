const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TASK_STATUSES = ['pending', 'claimed', 'done', 'verified', 'failed'];
const STALE_WORKER_MS = 2 * 60 * 1000;

/**
 * File-based message bus for the swarm (orchestrator + worker terminals).
 * Zero dependencies, crash-resumable. Layout:
 *   .yuva/tasks/<id>.json    task records
 *   .yuva/tasks/<id>.claim   claim locks (created with wx flag → atomic first-wins)
 *   .yuva/workers/<id>.json  worker registrations + heartbeats
 *   .yuva/events.log         append-only JSONL event stream
 */
class TaskBus {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.busDir = path.join(projectDir, '.yuva');
    this.tasksDir = path.join(this.busDir, 'tasks');
    this.workersDir = path.join(this.busDir, 'workers');
    this.eventsFile = path.join(this.busDir, 'events.log');
    this.stopFile = path.join(this.busDir, 'stop');
  }

  init() {
    fs.mkdirSync(this.tasksDir, { recursive: true });
    fs.mkdirSync(this.workersDir, { recursive: true });
    return this.busDir;
  }

  exists() {
    return fs.existsSync(this.tasksDir);
  }

  _taskFile(id) {
    return path.join(this.tasksDir, `${id}.json`);
  }

  _claimFile(id) {
    return path.join(this.tasksDir, `${id}.claim`);
  }

  _readJSON(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  _writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  }

  logEvent(type, data = {}) {
    this.init();
    const line = JSON.stringify({ timestamp: new Date().toISOString(), type, ...data }) + '\n';
    fs.appendFileSync(this.eventsFile, line);
  }

  // ── Tasks ──────────────────────────────────────────────────────

  addTask({ title, description = '', role = 'any', deps = [], priority = 0 }) {
    this.init();
    const task = {
      id: crypto.randomBytes(3).toString('hex'),
      title,
      description,
      role,
      deps,
      priority: Number(priority) || 0,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
      claimedBy: null,
      claimedAt: null,
      completedAt: null,
      summary: null,
      feedback: null,
      gate: null,
      history: [],
    };
    this._writeJSON(this._taskFile(task.id), task);
    this.logEvent('task.added', { taskId: task.id, title, role });
    return task;
  }

  getTask(id) {
    return this._readJSON(this._taskFile(id));
  }

  listTasks({ status, role } = {}) {
    if (!this.exists()) return [];
    const files = fs.readdirSync(this.tasksDir).filter(f => f.endsWith('.json'));
    let tasks = files.map(f => this._readJSON(path.join(this.tasksDir, f))).filter(Boolean);
    if (status) tasks = tasks.filter(t => t.status === status);
    if (role) tasks = tasks.filter(t => t.role === role || t.role === 'any');
    tasks.sort((a, b) => (b.priority - a.priority) || a.createdAt.localeCompare(b.createdAt));
    return tasks;
  }

  updateTask(id, patch, historyNote = null) {
    const task = this.getTask(id);
    if (!task) return null;
    Object.assign(task, patch);
    if (historyNote) {
      task.history.push({ timestamp: new Date().toISOString(), note: historyNote });
    }
    this._writeJSON(this._taskFile(id), task);
    return task;
  }

  _depsSatisfied(task) {
    return (task.deps || []).every(depId => {
      const dep = this.getTask(depId);
      return dep && dep.status === 'verified';
    });
  }

  /**
   * Atomically claim the next available task for a worker.
   * Roles match when the task role equals the worker role, the task role
   * is 'any', or the worker has no role. First terminal to create the
   * .claim file (wx flag) wins — safe across concurrent terminals.
   */
  claimTask(workerId, role = null) {
    const candidates = this.listTasks({ status: 'pending' }).filter(t =>
      (!role || t.role === role || t.role === 'any') && this._depsSatisfied(t)
    );

    for (const task of candidates) {
      try {
        fs.writeFileSync(this._claimFile(task.id), workerId, { flag: 'wx' });
      } catch {
        continue; // another worker got it first
      }
      const claimed = this.updateTask(task.id, {
        status: 'claimed',
        claimedBy: workerId,
        claimedAt: new Date().toISOString(),
        attempts: task.attempts + 1,
      }, `claimed by ${workerId}`);
      this.heartbeat(workerId, { currentTask: task.id });
      this.logEvent('task.claimed', { taskId: task.id, workerId });
      return claimed;
    }
    return null;
  }

  /** Worker finished — moves to 'done', awaiting orchestrator verification. */
  completeTask(id, { summary = null, gate = null } = {}) {
    const task = this.updateTask(id, {
      status: 'done',
      summary,
      gate,
      completedAt: new Date().toISOString(),
    }, `completed: ${summary || 'no summary'}`);
    if (task) this.logEvent('task.done', { taskId: id, summary });
    return task;
  }

  /** Orchestrator accepts the result after gates pass. */
  verifyTask(id, { gate = null } = {}) {
    const task = this.updateTask(id, { status: 'verified', gate: gate || undefined }, 'verified by orchestrator');
    if (task) {
      this._releaseClaim(id);
      this.logEvent('task.verified', { taskId: id });
    }
    return task;
  }

  /** Orchestrator bounces the result — back to pending with feedback. */
  rejectTask(id, feedback) {
    const task = this.updateTask(id, {
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      feedback,
    }, `rejected: ${feedback ? feedback.slice(0, 200) : 'no feedback'}`);
    if (task) {
      this._releaseClaim(id);
      this.logEvent('task.rejected', { taskId: id });
    }
    return task;
  }

  failTask(id, reason) {
    const task = this.updateTask(id, { status: 'failed', feedback: reason }, `failed: ${reason}`);
    if (task) {
      this._releaseClaim(id);
      this.logEvent('task.failed', { taskId: id, reason });
    }
    return task;
  }

  _releaseClaim(id) {
    try {
      fs.unlinkSync(this._claimFile(id));
    } catch {}
  }

  // ── Workers ────────────────────────────────────────────────────

  registerWorker({ role = null, mode = 'interactive' } = {}) {
    this.init();
    const worker = {
      id: `w-${crypto.randomBytes(2).toString('hex')}`,
      role,
      mode,
      pid: process.pid,
      status: 'idle',
      currentTask: null,
      startedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    this._writeJSON(path.join(this.workersDir, `${worker.id}.json`), worker);
    this.logEvent('worker.registered', { workerId: worker.id, role, mode });
    return worker;
  }

  heartbeat(workerId, patch = {}) {
    const file = path.join(this.workersDir, `${workerId}.json`);
    const worker = this._readJSON(file);
    if (!worker) return null;
    Object.assign(worker, patch, { lastSeenAt: new Date().toISOString() });
    this._writeJSON(file, worker);
    return worker;
  }

  listWorkers() {
    if (!fs.existsSync(this.workersDir)) return [];
    return fs.readdirSync(this.workersDir)
      .filter(f => f.endsWith('.json'))
      .map(f => this._readJSON(path.join(this.workersDir, f)))
      .filter(Boolean);
  }

  removeWorker(workerId) {
    try {
      fs.unlinkSync(path.join(this.workersDir, `${workerId}.json`));
      this.logEvent('worker.removed', { workerId });
    } catch {}
  }

  /**
   * Release tasks claimed by loop/auto workers that stopped heartbeating.
   * Interactive workers (one-shot `yuva worker next`) don't heartbeat while
   * working, so they are exempt — the orchestrator only shows their task age.
   * Returns the released tasks.
   */
  releaseStale(staleMs = STALE_WORKER_MS) {
    const now = Date.now();
    const released = [];
    const staleWorkers = this.listWorkers().filter(w =>
      w.mode !== 'interactive' && w.status !== 'offline' && now - Date.parse(w.lastSeenAt) > staleMs
    );

    for (const worker of staleWorkers) {
      this.heartbeat(worker.id, { status: 'offline', currentTask: null });
      for (const task of this.listTasks({ status: 'claimed' })) {
        if (task.claimedBy === worker.id) {
          this._releaseClaim(task.id);
          released.push(this.updateTask(task.id, {
            status: 'pending',
            claimedBy: null,
            claimedAt: null,
          }, `released — worker ${worker.id} went offline`));
          this.logEvent('task.released', { taskId: task.id, workerId: worker.id });
        }
      }
    }
    return released;
  }

  // ── Stop signal ────────────────────────────────────────────────
  // A `.yuva/stop` file tells every auto/headless worker to exit its loop
  // gracefully at the next poll. Interactive workers see it via
  // `yuva worker next`, which refuses to hand out new tasks.

  requestStop(reason = '') {
    this.init();
    fs.writeFileSync(this.stopFile, JSON.stringify({ reason, at: new Date().toISOString() }) + '\n');
    this.logEvent('swarm.stop', { reason });
  }

  stopRequested() {
    return fs.existsSync(this.stopFile);
  }

  clearStop() {
    try {
      fs.unlinkSync(this.stopFile);
    } catch {}
  }

  // ── Summary ────────────────────────────────────────────────────

  getStatusSummary() {
    const tasks = this.listTasks();
    const counts = {};
    for (const status of TASK_STATUSES) {
      counts[status] = tasks.filter(t => t.status === status).length;
    }
    return { tasks, counts, workers: this.listWorkers(), total: tasks.length };
  }

  clear() {
    if (fs.existsSync(this.busDir)) {
      fs.rmSync(this.busDir, { recursive: true, force: true });
    }
  }
}

module.exports = { TaskBus, TASK_STATUSES, STALE_WORKER_MS };
