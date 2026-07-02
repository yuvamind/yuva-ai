const path = require('path');
const fs = require('fs');
const os = require('os');
const { TaskBus } = require('../lib/task-bus');

function runOrchestrate(dir) {
  const origCwd = process.cwd();
  process.chdir(dir);
  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(msg);
  try {
    const agentCommand = require('../lib/commands/agent');
    agentCommand(['orchestrate']);
    return JSON.parse(logs.join('\n'));
  } finally {
    console.log = origLog;
    process.chdir(origCwd);
  }
}

describe('orchestrate swarm context', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-orch-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('recommends the swarm flow by default when no bus exists', () => {
    const result = runOrchestrate(tmpDir);
    expect(result.mode).toBe('swarm');
    expect(result.swarm.active).toBe(false);
    expect(result.swarm.isDefault).toBe(true);
    expect(result.swarm.instruction).toContain('yuva swarm spawn');
  });

  it('reports live swarm state when a bus exists', () => {
    const bus = new TaskBus(tmpDir);
    bus.addTask({ title: 'T1', role: 'executor' });
    bus.registerWorker({ role: 'executor' });

    const result = runOrchestrate(tmpDir);
    expect(result.swarm.active).toBe(true);
    expect(result.swarm.tasks.pending).toBe(1);
    expect(result.swarm.workers.length).toBe(1);
  });

  it('respects mode: solo in config', () => {
    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.aiautomations', 'config.json'),
      JSON.stringify({ tool: 'claude', mode: 'solo' })
    );

    const result = runOrchestrate(tmpDir);
    expect(result.mode).toBe('solo');
    expect(result.swarm.isDefault).toBe(false);
  });
});
