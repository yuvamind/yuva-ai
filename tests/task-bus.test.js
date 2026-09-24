const path = require('path');
const fs = require('fs');
const os = require('os');
const { TaskBus } = require('../lib/task-bus');

describe('TaskBus', () => {
  let tmpDir;
  let bus;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-bus-'));
    bus = new TaskBus(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('stop signal', () => {
    it('requestStop/stopRequested/clearStop round-trip', () => {
      expect(bus.stopRequested()).toBe(false);
      bus.requestStop('loop complete');
      expect(bus.stopRequested()).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'run', 'stop'))).toBe(true);
      const events = fs.readFileSync(path.join(tmpDir, '.yuva', 'run', 'events.log'), 'utf8');
      expect(events).toContain('swarm.stop');
      bus.clearStop();
      expect(bus.stopRequested()).toBe(false);
    });
  });

  describe('init()', () => {
    it('creates the bus directories', () => {
      bus.init();
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'run', 'tasks'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'run', 'workers'))).toBe(true);
      expect(bus.exists()).toBe(true);
    });
  });

  describe('addTask()', () => {
    it('creates a pending task with metadata', () => {
      const task = bus.addTask({ title: 'Build login', role: 'executor', description: 'JWT auth' });
      expect(task.id).toMatch(/^[0-9a-f]{12}$/);
      expect(task.status).toBe('pending');
      expect(task.role).toBe('executor');
      expect(task.attempts).toBe(0);
      expect(bus.getTask(task.id).title).toBe('Build login');
    });

    it('logs an event', () => {
      bus.addTask({ title: 'T1' });
      const events = fs.readFileSync(path.join(tmpDir, '.yuva', 'run', 'events.log'), 'utf8');
      expect(events).toContain('task.added');
    });

    it('rejects dependencies that do not exist', () => {
      expect(() => bus.addTask({ title: 'blocked', deps: ['missing-task'] }))
        .toThrow('Unknown task dependency: missing-task');
    });

    it('rejects self-dependencies and dependency cycles', () => {
      const first = bus.addTask({ title: 'first' });
      expect(() => bus.updateTask(first.id, { deps: [first.id] }))
        .toThrow(/cycle detected/i);

      const second = bus.addTask({ title: 'second', deps: [first.id] });
      const firstFile = path.join(tmpDir, '.yuva', 'run', 'tasks', `${first.id}.json`);
      const firstRecord = bus.getTask(first.id);
      firstRecord.deps = [second.id]; // Simulate a legacy/corrupt cycle on disk.
      fs.writeFileSync(firstFile, JSON.stringify(firstRecord));

      expect(() => bus.addTask({ title: 'third', deps: [second.id] }))
        .toThrow(/cycle detected/i);
    });
  });

  describe('listTasks()', () => {
    it('filters by status and role, sorts by priority', () => {
      bus.addTask({ title: 'low', role: 'executor', priority: 0 });
      const high = bus.addTask({ title: 'high', role: 'executor', priority: 5 });
      bus.addTask({ title: 'other role', role: 'tester' });

      const executorTasks = bus.listTasks({ role: 'executor' });
      expect(executorTasks.length).toBe(2);
      expect(executorTasks[0].id).toBe(high.id);

      const pending = bus.listTasks({ status: 'pending' });
      expect(pending.length).toBe(3);
    });
  });

  describe('updateTask()', () => {
    it('reclaims abandoned update locks and removes its lock after writing', () => {
      const task = bus.addTask({ title: 'T1' });
      const lockFile = path.join(tmpDir, '.yuva', 'run', 'tasks', `${task.id}.update.lock`);
      fs.writeFileSync(lockFile, 'dead-process');
      const stale = new Date(Date.now() - 60 * 1000);
      fs.utimesSync(lockFile, stale, stale);

      const updated = bus.updateTask(task.id, { summary: 'updated' }, 'recorded update');

      expect(updated.summary).toBe('updated');
      expect(updated.history.at(-1).note).toBe('recorded update');
      expect(fs.existsSync(lockFile)).toBe(false);
    });
  });

  describe('claimTask()', () => {
    it('claims a matching pending task atomically', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor' });

      const claimed = bus.claimTask(worker.id, 'executor');
      expect(claimed.id).toBe(task.id);
      expect(claimed.status).toBe('claimed');
      expect(claimed.claimedBy).toBe(worker.id);
      expect(claimed.attempts).toBe(1);

      // Second claim attempt finds nothing
      const other = bus.registerWorker({ role: 'executor' });
      expect(bus.claimTask(other.id, 'executor')).toBeNull();
    });

    it('does not give role-specific tasks to the wrong role', () => {
      bus.addTask({ title: 'T1', role: 'tester' });
      const worker = bus.registerWorker({ role: 'executor' });
      expect(bus.claimTask(worker.id, 'executor')).toBeNull();
    });

    it('gives "any" tasks to any role', () => {
      bus.addTask({ title: 'T1', role: 'any' });
      const worker = bus.registerWorker({ role: 'reviewer' });
      expect(bus.claimTask(worker.id, 'reviewer')).not.toBeNull();
    });

    it('respects dependencies — only claimable when deps are verified', () => {
      const dep = bus.addTask({ title: 'dep', role: 'executor' });
      const blocked = bus.addTask({ title: 'blocked', role: 'executor', deps: [dep.id] });
      const worker = bus.registerWorker({ role: 'executor' });

      // First claim gets the dep (blocked task's dep is unverified)
      const first = bus.claimTask(worker.id, 'executor');
      expect(first.id).toBe(dep.id);
      expect(bus.claimTask(worker.id, 'executor')).toBeNull();

      bus.completeTask(dep.id, { summary: 'done', workerId: worker.id });
      bus.verifyTask(dep.id);

      const second = bus.claimTask(worker.id, 'executor');
      expect(second.id).toBe(blocked.id);
    });
  });

  describe('complete / verify / reject / fail', () => {
    let task, worker;

    beforeEach(() => {
      task = bus.addTask({ title: 'T1', role: 'executor' });
      worker = bus.registerWorker({ role: 'executor' });
      bus.claimTask(worker.id, 'executor');
    });

    it('completeTask moves to done with summary', () => {
      const done = bus.completeTask(task.id, { summary: 'implemented', workerId: worker.id });
      expect(done.status).toBe('done');
      expect(done.summary).toBe('implemented');
      expect(done.completedAt).toBeTruthy();
      const workerAfter = bus.listWorkers().find(w => w.id === worker.id);
      expect(workerAfter.status).toBe('idle');
      expect(workerAfter.currentTask).toBeNull();
    });

    it('verifyTask moves to verified and releases the claim', () => {
      bus.completeTask(task.id, { workerId: worker.id });
      const verified = bus.verifyTask(task.id);
      expect(verified.status).toBe('verified');
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'run', 'tasks', `${task.id}.claim`))).toBe(false);
    });

    it('rejectTask returns the task to pending with feedback, reclaimable', () => {
      bus.completeTask(task.id, { workerId: worker.id });
      const rejected = bus.rejectTask(task.id, 'tests failing');
      expect(rejected.status).toBe('pending');
      expect(rejected.feedback).toBe('tests failing');
      expect(rejected.claimedBy).toBeNull();

      const reclaimed = bus.claimTask(worker.id, 'executor');
      expect(reclaimed.id).toBe(task.id);
      expect(reclaimed.attempts).toBe(2);
    });

    it('failTask marks failed with reason', () => {
      const failed = bus.failTask(task.id, 'blocked on API key', { workerId: worker.id });
      expect(failed.status).toBe('failed');
      expect(failed.feedback).toBe('blocked on API key');
      const workerAfter = bus.listWorkers().find(w => w.id === worker.id);
      expect(workerAfter.status).toBe('idle');
      expect(workerAfter.currentTask).toBeNull();
    });
  });

  describe('ownership checks', () => {
    it('rejects completion by a different worker', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const owner = bus.registerWorker({ role: 'executor' });
      const other = bus.registerWorker({ role: 'executor' });
      bus.claimTask(owner.id, 'executor');

      expect(bus.completeTask(task.id, { workerId: other.id })).toBeNull();
      expect(bus.getTask(task.id).status).toBe('claimed');
      expect(bus.getTask(task.id).claimedBy).toBe(owner.id);
    });

    it('rejects failure by a different worker', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const owner = bus.registerWorker({ role: 'executor' });
      const other = bus.registerWorker({ role: 'executor' });
      bus.claimTask(owner.id, 'executor');

      expect(bus.failTask(task.id, 'not mine', { workerId: other.id })).toBeNull();
      expect(bus.getTask(task.id).status).toBe('claimed');
      expect(bus.getTask(task.id).claimedBy).toBe(owner.id);
    });
  });

  describe('workers', () => {
    it('registers, heartbeats, and lists workers', () => {
      const worker = bus.registerWorker({ role: 'tester', mode: 'auto' });
      expect(worker.id).toMatch(/^w-[0-9a-f]{8}$/);

      const updated = bus.heartbeat(worker.id, { status: 'busy', currentTask: 'abc123' });
      expect(updated.status).toBe('busy');
      expect(bus.listWorkers().length).toBe(1);

      bus.removeWorker(worker.id);
      expect(bus.listWorkers().length).toBe(0);
    });
  });

  describe('releaseStale()', () => {
    const backdateWorker = (workerId, ms) => {
      const file = path.join(tmpDir, '.yuva', 'run', 'workers', `${workerId}.json`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.lastSeenAt = new Date(Date.now() - ms).toISOString();
      fs.writeFileSync(file, JSON.stringify(data));
    };

    const backdateClaim = (taskId, ms) => {
      const stamp = new Date(Date.now() - ms).toISOString();
      bus.updateTask(taskId, { claimedAt: stamp, leaseRenewedAt: stamp });
    };

    it('releases tasks claimed by loop workers that stopped heartbeating', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'auto' });
      bus.claimTask(worker.id, 'executor');

      backdateWorker(worker.id, 10 * 60 * 1000);

      const released = bus.releaseStale();
      expect(released.length).toBe(1);
      expect(bus.getTask(task.id).status).toBe('pending');
    });

    it('releases an interactive claim once its lease expires', () => {
      // Interactive workers are one-shot and can never heartbeat, so the
      // lease ceiling is the only thing that can free their tasks. Without
      // it a closed worker terminal blocks its task — and every dependent
      // task — forever.
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      bus.claimTask(worker.id, 'executor');

      // A fresh claim is left alone, even with a long-silent heartbeat.
      backdateWorker(worker.id, 10 * 60 * 1000);
      expect(bus.releaseStale().length).toBe(0);
      expect(bus.getTask(task.id).status).toBe('claimed');

      // Past the lease ceiling it is reclaimed.
      backdateClaim(task.id, 31 * 60 * 1000);
      const released = bus.releaseStale();
      expect(released.length).toBe(1);
      expect(bus.getTask(task.id).status).toBe('pending');
      expect(bus.getTask(task.id).claimedBy).toBeNull();
    });

    it('renewing a lease keeps a long-running interactive task claimed', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      bus.claimTask(worker.id, 'executor');

      backdateClaim(task.id, 31 * 60 * 1000);
      expect(bus.renewClaim(task.id, worker.id)).toBeTruthy();

      expect(bus.releaseStale().length).toBe(0);
      expect(bus.getTask(task.id).status).toBe('claimed');
    });

    it('releases orphaned claims whose worker record is gone', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      bus.claimTask(worker.id, 'executor');

      bus.removeWorker(worker.id);

      const released = bus.releaseStale();
      expect(released.length).toBe(1);
      expect(bus.getTask(task.id).status).toBe('pending');
    });

    it('marks a claimed worker as working, not idle', () => {
      bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      const task = bus.claimTask(worker.id, 'executor');

      const after = bus.listWorkers().find(w => w.id === worker.id);
      expect(after.status).toBe('working');
      expect(after.currentTask).toBe(task.id);
    });

    it('clears completed interactive workers so stale records can be pruned', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      bus.claimTask(worker.id, 'executor');
      bus.completeTask(task.id, { workerId: worker.id });

      backdateWorker(worker.id, 10 * 60 * 1000);
      bus.releaseStale();

      expect(bus.listWorkers().find(w => w.id === worker.id)).toBeUndefined();
    });
  });

  describe('releaseTask()', () => {
    it('returns a claimed task to the pending pool', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      bus.claimTask(worker.id, 'executor');

      const released = bus.releaseTask(task.id, 'manual unstick');
      expect(released.status).toBe('pending');
      expect(released.claimedBy).toBeNull();

      // The claim lock is gone, so another worker can take it
      const other = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      expect(bus.claimTask(other.id, 'executor').id).toBe(task.id);
    });

    it('ignores tasks that are not claimed', () => {
      const task = bus.addTask({ title: 'T1' });
      expect(bus.releaseTask(task.id)).toBeNull();
    });
  });

  describe('getStatusSummary()', () => {
    it('counts tasks by status', () => {
      bus.addTask({ title: 'T1' });
      bus.addTask({ title: 'T2' });
      const worker = bus.registerWorker({});
      const claimed = bus.claimTask(worker.id);
      bus.completeTask(claimed.id, { workerId: worker.id });

      const summary = bus.getStatusSummary();
      expect(summary.total).toBe(2);
      expect(summary.counts.pending + summary.counts.claimed + summary.counts.done).toBe(2);
      expect(summary.workers.length).toBe(1);
    });
  });

  describe('clear()', () => {
    it('removes the entire bus', () => {
      bus.addTask({ title: 'T1' });
      bus.clear();
      expect(bus.exists()).toBe(false);
    });
  });
});
