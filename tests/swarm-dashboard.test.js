const fs = require('fs');
const os = require('os');
const path = require('path');
const { TaskBus } = require('../lib/task-bus');
const { stateFingerprint } = require('../lib/commands/swarm');

let tmpDir;
let bus;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-dash-'));
  bus = new TaskBus(tmpDir);
  bus.init();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('swarm dashboard', () => {
  describe('stateFingerprint()', () => {
    it('ignores relative timestamps, which change every tick', async () => {
      bus.addTask({ title: 'T1', role: 'executor' });
      const worker = bus.registerWorker({ role: 'executor', mode: 'auto' });
      bus.claimTask(worker.id, 'executor');

      const before = stateFingerprint(bus.getStatusSummary());

      // Only lastSeenAt moves — the displayed "Ns ago" changes, nothing else.
      await new Promise(r => setTimeout(r, 15));
      bus.heartbeat(worker.id, {});

      expect(stateFingerprint(bus.getStatusSummary())).toBe(before);
    });

    it('changes when a task changes status', () => {
      const task = bus.addTask({ title: 'T1', role: 'executor' });
      const before = stateFingerprint(bus.getStatusSummary());

      const worker = bus.registerWorker({ role: 'executor', mode: 'auto' });
      bus.claimTask(worker.id, 'executor');

      expect(stateFingerprint(bus.getStatusSummary())).not.toBe(before);
      expect(bus.getTask(task.id).status).toBe('claimed');
    });

    it('changes when a worker changes status', () => {
      const worker = bus.registerWorker({ role: 'executor', mode: 'auto' });
      const before = stateFingerprint(bus.getStatusSummary());

      bus.heartbeat(worker.id, { status: 'offline' });

      expect(stateFingerprint(bus.getStatusSummary())).not.toBe(before);
    });

    it('changes when a new task is added', () => {
      bus.addTask({ title: 'T1' });
      const before = stateFingerprint(bus.getStatusSummary());
      bus.addTask({ title: 'T2' });
      expect(stateFingerprint(bus.getStatusSummary())).not.toBe(before);
    });
  });

  describe('worker pruning', () => {
    it('removes spent interactive workers so the table stops growing', () => {
      // `yuva worker next` registers a fresh worker per call and exits, so
      // finished ones must be swept or the worker list grows without bound.
      for (let i = 0; i < 3; i++) {
        const w = bus.registerWorker({ role: 'executor', mode: 'interactive' });
        const file = path.join(tmpDir, '.yuva', 'run', 'workers', `${w.id}.json`);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        data.lastSeenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        fs.writeFileSync(file, JSON.stringify(data));
      }
      expect(bus.listWorkers().length).toBe(3);

      bus.releaseStale();

      expect(bus.listWorkers().length).toBe(0);
    });

    it('keeps a worker that still holds a task', () => {
      bus.addTask({ title: 'T1', role: 'executor' });
      const w = bus.registerWorker({ role: 'executor', mode: 'interactive' });
      bus.claimTask(w.id, 'executor');

      bus.releaseStale();

      expect(bus.listWorkers().map(x => x.id)).toContain(w.id);
    });
  });
});
