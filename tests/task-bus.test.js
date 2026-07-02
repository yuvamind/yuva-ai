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

  describe('init()', () => {
    it('creates the bus directories', () => {
      bus.init();
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'tasks'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'workers'))).toBe(true);
      expect(bus.exists()).toBe(true);
    });
  });

  describe('addTask()', () => {
    it('creates a pending task with metadata', () => {
      const task = bus.addTask({ title: 'Build login', role: 'executor', description: 'JWT auth' });
      expect(task.id).toMatch(/^[0-9a-f]{6}$/);
      expect(task.status).toBe('pending');
      expect(task.role).toBe('executor');
      expect(task.attempts).toBe(0);
      expect(bus.getTask(task.id).title).toBe('Build login');
    });

    it('logs an event', () => {
      bus.addTask({ title: 'T1' });
      const events = fs.readFileSync(path.join(tmpDir, '.yuva', 'events.log'), 'utf8');
      expect(events).toContain('task.added');
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

      bus.completeTask(dep.id, { summary: 'done' });
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
      const done = bus.completeTask(task.id, { summary: 'implemented' });
      expect(done.status).toBe('done');
      expect(done.summary).toBe('implemented');
      expect(done.completedAt).toBeTruthy();
    });

    it('verifyTask moves to verified and releases the claim', () => {
      bus.completeTask(task.id, {});
      const verified = bus.verifyTask(task.id);
      expect(verified.status).toBe('verified');
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'tasks', `${task.id}.claim`))).toBe(false);
    });

    it('rejectTask returns the task to pending with feedback, reclaimable', () => {
      bus.completeTask(task.id, {});
      const rejected = bus.rejectTask(task.id, 'tests failing');
      expect(rejected.status).toBe('pending');
      expect(rejected.feedback).toBe('tests failing');
      expect(rejected.claimedBy).toBeNull();

      const reclaimed = bus.claimTask(worker.id, 'executor');
      expect(reclaimed.id).toBe(task.id);
      expect(reclaimed.attempts).toBe(2);
    });

    it('failTask marks failed with reason', () => {
      const failed = bus.failTask(task.id, 'blocked on API key');
      expect(failed.status).toBe('failed');
      expect(failed.feedback).toBe('blocked on API key');
    });
  });

  describe('workers', () => {
    it('registers, heartbeats, and lists workers', () => {
      const worker = bus.registerWorker({ role: 'tester', mode: 'auto' });
      expect(worker.id).toMatch(/^w-[0-9a-f]{4}$/);

      const updated = bus.heartbeat(worker.id, { status: 'busy', currentTask: 'abc123' });
      expect(updated.status).toBe('busy');
      expect(bus.listWorkers().length).toBe(1);

      bus.removeWorker(worker.id);
      expect(bus.listWorkers().length).toBe(0);
    });
  });

  describe('releaseStale()', () => {
    it('releases tasks claimed by silent loop workers, but not interactive ones', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'auto' });
      bus.claimTask(worker.id, 'executor');

      // Backdate the worker heartbeat past the stale threshold
      const file = path.join(tmpDir, '.yuva', 'workers', `${worker.id}.json`);
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      data.lastSeenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      fs.writeFileSync(file, JSON.stringify(data));

      const released = bus.releaseStale();
      expect(released.length).toBe(1);
      expect(bus.getTask(task.id).status).toBe('pending');

      // Interactive worker with an old heartbeat is left alone
      const interactive = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      const claimed = bus.claimTask(interactive.id, 'executor');
      const file2 = path.join(tmpDir, '.yuva', 'workers', `${interactive.id}.json`);
      const data2 = JSON.parse(fs.readFileSync(file2, 'utf8'));
      data2.lastSeenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      fs.writeFileSync(file2, JSON.stringify(data2));

      expect(bus.releaseStale().length).toBe(0);
      expect(bus.getTask(claimed.id).status).toBe('claimed');
    });
  });

  describe('getStatusSummary()', () => {
    it('counts tasks by status', () => {
      bus.addTask({ title: 'T1' });
      const t2 = bus.addTask({ title: 'T2' });
      const worker = bus.registerWorker({});
      bus.claimTask(worker.id);
      bus.completeTask(t2.id === bus.listTasks({ status: 'claimed' })[0].id ? t2.id : bus.listTasks({ status: 'claimed' })[0].id, {});

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
