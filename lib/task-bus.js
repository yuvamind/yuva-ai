const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { FileConflictManager } = require('./file-conflict');
const P = require('./paths');

const TASK_STATUSES = ['pending', 'claimed', 'done', 'verified', 'failed'];
const STALE_WORKER_MS = 2 * 60 * 1000;
/**
 * Hard ceiling on how long ANY worker may hold a claim, heartbeat or not.
 * Interactive workers (`yuva worker next`) are one-shot processes that exit
 * immediately after claiming, so they can never heartbeat — without this
 * ceiling a crashed or closed worker terminal would block its task, and every
 * task depending on it, forever.
 */
const CLAIM_LEASE_MS = 30 * 60 * 1000;
const TASK_UPDATE_LOCK_WAIT_MS = 5;
const TASK_UPDATE_LOCK_RETRIES = 1000;
const TASK_UPDATE_LOCK_STALE_MS = 30 * 1000;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 10000;
const MAX_HISTORY_ENTRIES = 200;
const MAX_EVENT_LOG_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * File-based message bus for the swarm (orchestrator + worker terminals).
 * Zero dependencies, crash-resumable. Layout:
 *   .yuva/run/tasks/<id>.json    task records
 *   .yuva/run/tasks/<id>.claim   claim locks (wx flag → atomic first-wins)
 *   .yuva/run/workers/<id>.json  worker registrations + heartbeats
 *   .yuva/run/events.log         append-only JSONL event stream
 */
class TaskBus {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.busDir = P.runDir(projectDir);
    this.tasksDir = P.tasksDir(projectDir);
    this.workersDir = P.workersDir(projectDir);
    this.eventsFile = P.eventsFile(projectDir);
    this.stopFile = P.stopFile(projectDir);
    this.fileConflictMgr = new FileConflictManager(projectDir);
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

  _taskUpdateLockFile(id) {
    return path.join(this.tasksDir, `${id}.update.lock`);
  }

  _workerUpdateLockFile(id) {
    return path.join(this.workersDir, `${id}.update.lock`);
  }

  _sleepSync(ms) {
    // Task-bus writes are synchronous by design. Atomics.wait provides a
    // portable short sleep while another process owns the update lock.
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, ms);
  }

  _withUpdateLock(lockFile, resourceLabel, fn) {
    this.init();
    const token = `${process.pid}:${Date.now()}:${crypto.randomBytes(6).toString('hex')}`;

    for (let attempt = 0; attempt < TASK_UPDATE_LOCK_RETRIES; attempt++) {
      try {
        fs.writeFileSync(lockFile, token, { flag: 'wx' });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;

        // A killed process can leave the lock behind. Task updates are short;
        // reclaim only locks that are clearly abandoned.
        try {
          const stat = fs.statSync(lockFile);
          if (Date.now() - stat.mtimeMs > TASK_UPDATE_LOCK_STALE_MS) {
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch {}

        this._sleepSync(TASK_UPDATE_LOCK_WAIT_MS);
        continue;
      }

      try {
        return fn();
      } finally {
        try {
          if (fs.readFileSync(lockFile, 'utf8') === token) fs.unlinkSync(lockFile);
        } catch {}
      }
    }

    throw new Error(`Timed out waiting for update lock: ${resourceLabel}`);
  }

  _withTaskUpdateLock(id, fn) {
    return this._withUpdateLock(this._taskUpdateLockFile(id), `task ${id}`, fn);
  }

  _readJSON(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  _writeJSON(file, data) {
    const tmp = file + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmp, file);
  }

  logEvent(type, data = {}) {
    this.init();
    // Rotate event log if it exceeds the cap
    try {
      if (fs.existsSync(this.eventsFile)) {
        const stat = fs.statSync(this.eventsFile);
        if (stat.size > MAX_EVENT_LOG_BYTES) {
          const backup = this.eventsFile + '.old';
          fs.renameSync(this.eventsFile, backup);
        }
      }
    } catch {}
    const line = JSON.stringify({ timestamp: new Date().toISOString(), type, ...data }) + '\n';
    fs.appendFileSync(this.eventsFile, line);
  }

  // ── Tasks ──────────────────────────────────────────────────────

  _normalizeDependencies(deps) {
    if (deps === null || deps === undefined) return [];
    if (!Array.isArray(deps)) throw new Error('Task dependencies must be an array');
    return [...new Set(deps.map(dep => String(dep).trim()).filter(Boolean))];
  }

  _validateDependencies(taskId, deps) {
    const tasks = new Map(this.listTasks().map(task => [task.id, task]));
    const graph = new Map([...tasks.entries()].map(([id, task]) => [id, task.deps || []]));
    graph.set(taskId, deps);

    const visiting = [];
    const visited = new Set();
    const visit = (id) => {
      if (visiting.includes(id)) {
        const cycleStart = visiting.indexOf(id);
        const cycle = [...visiting.slice(cycleStart), id];
        throw new Error(`Task dependency cycle detected: ${cycle.join(' -> ')}`);
      }
      if (visited.has(id)) return;

      const taskDeps = graph.get(id);
      if (!taskDeps) {
        throw new Error(`Unknown task dependency: ${id}`);
      }

      visiting.push(id);
      for (const depId of taskDeps) visit(depId);
      visiting.pop();
      visited.add(id);
    };

    visit(taskId);
  }

  addTask({ title, description = '', role = 'any', deps = [], priority = 0 }) {
    this.init();
    // Validate and cap input lengths
    title = String(title || '').trim().slice(0, MAX_TITLE_LENGTH);
    description = String(description || '').slice(0, MAX_DESCRIPTION_LENGTH);
    if (!title) throw new Error('Task title is required');
    const id = crypto.randomBytes(6).toString('hex');
    const normalizedDeps = this._normalizeDependencies(deps);
    this._validateDependencies(id, normalizedDeps);
    const task = {
      id,
      title,
      description,
      role,
      deps: normalizedDeps,
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

  updateTask(id, patch, historyNote = null, guard = null) {
    return this._withTaskUpdateLock(id, () => {
      const task = this.getTask(id);
      if (!task || (guard && !guard(task))) return null;
      const nextPatch = { ...patch };
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'deps')) {
        nextPatch.deps = this._normalizeDependencies(nextPatch.deps);
        this._validateDependencies(id, nextPatch.deps);
      }
      Object.assign(task, nextPatch);
      if (historyNote) {
        task.history.push({ timestamp: new Date().toISOString(), note: historyNote });
        // Cap history to prevent unbounded growth
        if (task.history.length > MAX_HISTORY_ENTRIES) {
          task.history = task.history.slice(-MAX_HISTORY_ENTRIES);
        }
      }
      this._writeJSON(this._taskFile(id), task);
      return task;
    });
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
   * Also checks file-level conflicts to prevent two workers from editing
   * the same files simultaneously.
   */
  claimTask(workerId, role = null) {
    const candidates = this.listTasks({ status: 'pending' }).filter(t =>
      (!role || t.role === role || t.role === 'any') && this._depsSatisfied(t)
    );

    for (const task of candidates) {
      // Check file conflicts — skip tasks whose files are locked by other workers
      const predictedFiles = this.fileConflictMgr.predictFiles(
        `${task.title} ${task.description || ''}`, this.projectDir
      );
      if (predictedFiles.length > 0) {
        const locked = this.fileConflictMgr.checkFiles(predictedFiles);
        const conflicting = locked.filter(l => l.taskId !== task.id);
        if (conflicting.length > 0) {
          this.logEvent('task.conflict', {
            taskId: task.id,
            conflictingFiles: conflicting.map(c => c.file),
            lockedBy: conflicting.map(c => c.taskId),
          });
          continue; // skip this task, try the next candidate
        }
      }

      try {
        fs.writeFileSync(this._claimFile(task.id), workerId, { flag: 'wx' });
      } catch {
        continue; // another worker got it first
      }

      // Acquire file locks for this task
      if (predictedFiles.length > 0) {
        this.fileConflictMgr.acquireFiles(predictedFiles, task.id, workerId);
      }

      const claimed = this.updateTask(task.id, {
        status: 'claimed',
        claimedBy: workerId,
        claimedAt: new Date().toISOString(),
        // Lease renewal clock — distinct from claimedAt so `renewClaim` can
        // extend a long-running task without losing when work actually began.
        leaseRenewedAt: new Date().toISOString(),
        attempts: task.attempts + 1,
        lockedFiles: predictedFiles,
      }, `claimed by ${workerId}`);
      // Mark the worker busy, not merely "holding a task" — a worker showing
      // idle while holding a claim is the symptom that hid this deadlock.
      this.heartbeat(workerId, { status: 'working', currentTask: task.id });
      this.logEvent('task.claimed', { taskId: task.id, workerId, lockedFiles: predictedFiles.length });
      return claimed;
    }
    return null;
  }

  /** Worker finished — moves to 'done', awaiting orchestrator verification. */
  completeTask(id, { summary = null, gate = null, workerId = null } = {}) {
    const task = this.updateTask(id, {
      status: 'done',
      summary,
      gate,
      completedAt: new Date().toISOString(),
    }, `completed: ${summary || 'no summary'}`, current => (
      current.status === 'claimed' && current.claimedBy === workerId
    ));
    if (task) {
      this._clearWorkerTask(workerId, id);
      this.logEvent('task.done', { taskId: id, summary });
    }
    return task;
  }

  /** Orchestrator accepts the result after gates pass. */
  verifyTask(id, { gate = null } = {}) {
    const task = this.getTask(id);
    if (task && task.lockedFiles) {
      this.fileConflictMgr.releaseFiles(task.lockedFiles);
    }
    const updated = this.updateTask(id, { status: 'verified', gate: gate || undefined }, 'verified by orchestrator');
    if (updated) {
      this._clearWorkerTask(task && task.claimedBy, id);
      this._releaseClaim(id);
      this.logEvent('task.verified', { taskId: id });
    }
    return updated;
  }

  /** Orchestrator bounces the result — back to pending with feedback. */
  rejectTask(id, feedback) {
    const task = this.getTask(id);
    if (task && task.lockedFiles) {
      this.fileConflictMgr.releaseFiles(task.lockedFiles);
    }
    const updated = this.updateTask(id, {
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      lockedFiles: null,
      feedback,
    }, `rejected: ${feedback ? feedback.slice(0, 200) : 'no feedback'}`);
    if (updated) {
      this._clearWorkerTask(task && task.claimedBy, id);
      this._releaseClaim(id);
      this.logEvent('task.rejected', { taskId: id });
    }
    return updated;
  }

  failTask(id, reason, { workerId = null, actor = 'worker' } = {}) {
    const task = this.getTask(id);
    if (!task) return null;
    if (task.status === 'claimed' && task.claimedBy !== workerId) return null;
    if (task.status !== 'claimed' && actor !== 'orchestrator') return null;

    if (task && task.lockedFiles) {
      this.fileConflictMgr.releaseFiles(task.lockedFiles);
    }
    const updated = this.updateTask(
      id,
      { status: 'failed', feedback: reason, lockedFiles: null },
      `failed: ${reason}`,
      current => (
        (current.status === 'claimed' && current.claimedBy === workerId)
        || (current.status !== 'claimed' && actor === 'orchestrator')
      )
    );
    if (updated) {
      this._clearWorkerTask(workerId, id);
      this._releaseClaim(id);
      this.logEvent('task.failed', { taskId: id, reason });
    }
    return updated;
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
      id: `w-${crypto.randomBytes(4).toString('hex')}`,
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
    return this._withUpdateLock(this._workerUpdateLockFile(workerId), `worker ${workerId}`, () => {
      const worker = this._readJSON(file);
      if (!worker) return null;
      Object.assign(worker, patch, { lastSeenAt: new Date().toISOString() });
      this._writeJSON(file, worker);
      return worker;
    });
  }

  /** Clear a worker's completed/released task without clobbering a newer claim. */
  _clearWorkerTask(workerId, taskId) {
    if (!workerId) return null;
    const file = path.join(this.workersDir, `${workerId}.json`);
    return this._withUpdateLock(this._workerUpdateLockFile(workerId), `worker ${workerId}`, () => {
      const worker = this._readJSON(file);
      if (!worker || worker.currentTask !== taskId) return worker;
      worker.currentTask = null;
      if (worker.status === 'working' || worker.status === 'busy') worker.status = 'idle';
      worker.lastSeenAt = new Date().toISOString();
      this._writeJSON(file, worker);
      return worker;
    });
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
   * Return a claimed task to the pending pool so another worker can pick it up.
   * Drops the claim lock and any file locks it held.
   */
  releaseTask(id, reason = 'released') {
    const task = this.getTask(id);
    if (!task || task.status !== 'claimed') return null;
    if (task.lockedFiles) {
      this.fileConflictMgr.releaseFiles(task.lockedFiles);
    }
    this._releaseClaim(id);
    const updated = this.updateTask(id, {
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      leaseRenewedAt: null,
      lockedFiles: null,
    }, `released — ${reason}`);
    if (updated) this._clearWorkerTask(task.claimedBy, id);
    this.logEvent('task.released', { taskId: id, reason, workerId: task.claimedBy });
    return updated;
  }

  /**
   * Extend the lease on a claim so long-running work is not reclaimed
   * mid-flight. Only the owning worker may renew.
   */
  renewClaim(taskId, workerId) {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'claimed' || task.claimedBy !== workerId) return null;
    this.heartbeat(workerId, { status: 'working', currentTask: taskId });
    return this.updateTask(taskId, { leaseRenewedAt: new Date().toISOString() });
  }

  /**
   * Reclaim tasks whose claims are no longer being worked on.
   *
   * Three independent conditions, because no single one covers every worker:
   *   1. LEASE EXPIRY  — any claim held past `leaseMs`, regardless of worker
   *      mode. This is the backstop that makes interactive workers safe:
   *      `yuva worker next` exits right after claiming and can never
   *      heartbeat, so worker liveness alone would hold its task forever.
   *   2. DEAD WORKER   — a heartbeating worker (auto/headless) that stopped
   *      reporting within `staleMs`. Reclaims fast without waiting a lease.
   *   3. ORPHAN CLAIM  — the worker record is gone entirely (cleared bus,
   *      deleted file), so nothing will ever expire the claim on its own.
   *
   * Returns the released tasks.
   */
  releaseStale(staleMs = STALE_WORKER_MS, leaseMs = CLAIM_LEASE_MS) {
    const now = Date.now();
    const released = [];
    const workers = new Map(this.listWorkers().map(w => [w.id, w]));

    // 1. Mark heartbeating workers offline once they go quiet.
    for (const worker of workers.values()) {
      const heartbeats = worker.mode !== 'interactive';
      if (heartbeats && worker.status !== 'offline' &&
          now - Date.parse(worker.lastSeenAt) > staleMs) {
        this.heartbeat(worker.id, { status: 'offline', currentTask: null });
        worker.status = 'offline';
      }
    }

    // 2. Sweep every claimed task against all three conditions.
    for (const task of this.listTasks({ status: 'claimed' })) {
      const worker = task.claimedBy ? workers.get(task.claimedBy) : null;
      const heldSince = Date.parse(task.leaseRenewedAt || task.claimedAt || 0);
      const heldMs = Number.isNaN(heldSince) ? Infinity : now - heldSince;

      let reason = null;
      if (!task.claimedBy || !worker) {
        reason = `orphaned claim (worker ${task.claimedBy || 'unknown'} no longer registered)`;
      } else if (worker.status === 'offline') {
        reason = `worker ${worker.id} went offline`;
      } else if (heldMs > leaseMs) {
        reason = `claim lease expired after ${Math.round(heldMs / 60000)}m (worker ${worker.id})`;
      }

      if (reason) {
        const updated = this.releaseTask(task.id, reason);
        if (updated) released.push(updated);
      }
    }

    // 3. Prune spent interactive workers. `yuva worker next` registers a fresh
    // worker on every call and exits, so without this the worker table grows
    // by one dead row per task ever claimed.
    for (const worker of workers.values()) {
      if (worker.mode !== 'interactive' || worker.currentTask) continue;
      if (now - Date.parse(worker.lastSeenAt) > staleMs) {
        this.removeWorker(worker.id);
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

  /**
   * Wipe runtime state. Only the run directory and the bus files actually in
   * use are removed — committed config under `.yuva/` is never touched, and a
   * project still on the legacy flat layout gets its real directories cleared
   * rather than an empty `.yuva/run/`.
   */
  clear() {
    const targets = [this.busDir, this.tasksDir, this.workersDir, this.eventsFile, this.stopFile];
    for (const target of targets) {
      try {
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      } catch { /* already gone or locked */ }
    }
  }
}

module.exports = {
  TaskBus, TASK_STATUSES, STALE_WORKER_MS, CLAIM_LEASE_MS,
  MAX_TITLE_LENGTH, MAX_DESCRIPTION_LENGTH,
};
