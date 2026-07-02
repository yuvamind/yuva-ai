const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildWorkPackage, ROLES } = require('../lib/work-package');
const { TaskBus } = require('../lib/task-bus');

describe('work-package', () => {
  let tmpDir;
  let bus;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-wp-'));
    bus = new TaskBus(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defines the core roles', () => {
    expect(Object.keys(ROLES)).toEqual(
      expect.arrayContaining(['executor', 'tester', 'reviewer', 'security', 'debugger'])
    );
  });

  it('includes task details, agent prompt, checklists, and completion protocol', () => {
    const task = bus.addTask({
      title: 'Build login',
      role: 'executor',
      description: 'JWT-based auth',
    });

    const pkg = buildWorkPackage(task, tmpDir);
    expect(pkg).toContain(`Work Package — Task ${task.id}`);
    expect(pkg).toContain('Build login');
    expect(pkg).toContain('JWT-based auth');
    // Agent prompt + checklists come from the package template dir
    expect(pkg).toContain('Your Agent Instructions (executor)');
    expect(pkg).toContain('Required Checklist: beforecode.md');
    expect(pkg).toContain('Completion Protocol (MANDATORY)');
    expect(pkg).toContain(`yuva task done ${task.id}`);
    expect(pkg).toContain(`yuva task fail ${task.id}`);
  });

  it('includes rejection feedback so the next attempt must address it', () => {
    const task = bus.addTask({ title: 'T1', role: 'tester' });
    const worker = bus.registerWorker({ role: 'tester' });
    bus.claimTask(worker.id, 'tester');
    bus.completeTask(task.id, {});
    bus.rejectTask(task.id, 'tests do not cover the error path');

    const pkg = buildWorkPackage(bus.getTask(task.id), tmpDir);
    expect(pkg).toContain('Feedback from previous attempt');
    expect(pkg).toContain('tests do not cover the error path');
  });

  it('prefers local .aiautomations prompt overrides', () => {
    const promptsDir = path.join(tmpDir, '.aiautomations', 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    fs.writeFileSync(path.join(promptsDir, 'execution.md'), 'LOCAL OVERRIDE PROMPT');

    const task = bus.addTask({ title: 'T1', role: 'executor' });
    const pkg = buildWorkPackage(task, tmpDir);
    expect(pkg).toContain('LOCAL OVERRIDE PROMPT');
  });

  it('lists detected quality gates in the completion protocol', () => {
    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.aiautomations', 'config.json'),
      JSON.stringify({ gates: { lint: 'my-lint-cmd' } })
    );

    const task = bus.addTask({ title: 'T1', role: 'executor' });
    const pkg = buildWorkPackage(task, tmpDir);
    expect(pkg).toContain('my-lint-cmd');
  });
});
