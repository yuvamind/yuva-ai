const path = require('path');
const fs = require('fs');
const os = require('os');
const { TaskBus } = require('../lib/task-bus');
const {
  LoopEngine,
  extractJSON,
  normalizePlannedTasks,
  normalizeReview,
  buildPlanPrompt,
  buildReviewPrompt,
  ensurePrintMode,
  verifyDoneTasks,
} = require('../lib/loop-engine');

describe('extractJSON()', () => {
  it('parses a bare JSON object', () => {
    expect(extractJSON('{"tasks":[]}')).toEqual({ tasks: [] });
  });

  it('parses JSON inside a markdown fence', () => {
    const text = 'Here is the plan:\n```json\n{"tasks":[{"title":"T1"}]}\n```\nDone.';
    expect(extractJSON(text)).toEqual({ tasks: [{ title: 'T1' }] });
  });

  it('parses JSON surrounded by prose', () => {
    const text = 'Sure! {"goalAchieved":true,"reason":"all good"} Hope that helps.';
    expect(extractJSON(text)).toEqual({ goalAchieved: true, reason: 'all good' });
  });

  it('returns null for garbage or empty input', () => {
    expect(extractJSON('no json here')).toBeNull();
    expect(extractJSON('')).toBeNull();
    expect(extractJSON(null)).toBeNull();
    expect(extractJSON('{broken')).toBeNull();
  });
});

describe('normalizePlannedTasks()', () => {
  it('accepts {tasks:[...]} and bare arrays', () => {
    const fromObject = normalizePlannedTasks({ tasks: [{ title: 'A' }] });
    const fromArray = normalizePlannedTasks([{ title: 'A' }]);
    expect(fromObject.length).toBe(1);
    expect(fromArray.length).toBe(1);
  });

  it('drops entries without a title and coerces unknown roles to any', () => {
    const tasks = normalizePlannedTasks({
      tasks: [{ title: 'ok', role: 'executor' }, { role: 'tester' }, { title: 'weird', role: 'astronaut' }],
    });
    expect(tasks.length).toBe(2);
    expect(tasks[0].role).toBe('executor');
    expect(tasks[1].role).toBe('any');
  });

  it('keeps only backward deps and remaps indices after dropped entries', () => {
    const tasks = normalizePlannedTasks({
      tasks: [
        { title: 'build', role: 'executor' },
        { role: 'invalid — dropped' },
        { title: 'test', role: 'tester', deps: [0, 2, 5] }, // 2 = itself after remap, 5 = out of range
      ],
    });
    expect(tasks.length).toBe(2);
    expect(tasks[1].deps).toEqual([0]);
  });

  it('returns [] for garbage', () => {
    expect(normalizePlannedTasks(null)).toEqual([]);
    expect(normalizePlannedTasks({ nope: true })).toEqual([]);
  });
});

describe('normalizeReview()', () => {
  it('normalizes a valid review with follow-up tasks', () => {
    const review = normalizeReview({
      goalAchieved: false,
      reason: 'missing tests',
      tasks: [{ title: 'add tests', role: 'tester' }],
    });
    expect(review.goalAchieved).toBe(false);
    expect(review.reason).toBe('missing tests');
    expect(review.tasks.length).toBe(1);
  });

  it('treats anything but literal true as not achieved', () => {
    expect(normalizeReview({ goalAchieved: 'yes' }).goalAchieved).toBe(false);
    expect(normalizeReview({ goalAchieved: true }).goalAchieved).toBe(true);
  });

  it('returns null for unusable output', () => {
    expect(normalizeReview(null)).toBeNull();
    expect(normalizeReview([1, 2])).toBeNull();
  });
});

describe('ensurePrintMode()', () => {
  it('appends -p when missing', () => {
    expect(ensurePrintMode('claude')).toBe('claude -p');
  });

  it('leaves commands that already have -p untouched', () => {
    expect(ensurePrintMode('claude -p')).toBe('claude -p');
    expect(ensurePrintMode('claude -p --model sonnet')).toBe('claude -p --model sonnet');
  });
});

describe('prompt builders', () => {
  it('plan prompt contains the goal, roles, and the JSON contract', () => {
    const prompt = buildPlanPrompt('build a REST API', os.tmpdir());
    expect(prompt).toContain('build a REST API');
    expect(prompt).toContain('executor');
    expect(prompt).toContain('"tasks"');
    expect(prompt).toContain('ONLY a JSON object');
  });

  it('review prompt lists verified and failed tasks', () => {
    const prompt = buildReviewPrompt('goal X', 2, 5, [
      { id: 'aa1', title: 'done thing', status: 'verified', summary: 'shipped' },
      { id: 'bb2', title: 'broken thing', status: 'failed', feedback: 'gates failed' },
    ]);
    expect(prompt).toContain('goal X');
    expect(prompt).toContain('Iteration 2 of 5');
    expect(prompt).toContain('done thing');
    expect(prompt).toContain('broken thing');
    expect(prompt).toContain('goalAchieved');
  });
});

describe('LoopEngine', () => {
  let tmpDir;
  let bus;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-loop-'));
    bus = new TaskBus(tmpDir);
    bus.init();
    engine = new LoopEngine(bus, tmpDir, { maxAttempts: 3 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('addPlannedTasks()', () => {
    it('maps index-based deps to real task ids', () => {
      const created = engine.addPlannedTasks([
        { title: 'build', role: 'executor', deps: [], priority: 0, description: '' },
        { title: 'test', role: 'tester', deps: [0], priority: 0, description: '' },
      ]);
      expect(created.length).toBe(2);
      expect(created[1].deps).toEqual([created[0].id]);
      expect(bus.getTask(created[1].id).deps).toEqual([created[0].id]);
    });
  });

  describe('ask() retry on unparseable output', () => {
    it('re-asks once with a strict reminder and returns the repaired JSON', async () => {
      const calls = [];
      engine.options.runPrompt = async (cli, prompt) => {
        calls.push(prompt);
        return calls.length === 1
          ? { code: 0, stdout: 'Sure, here is a friendly answer without JSON!', stderr: '', error: null }
          : { code: 0, stdout: '{"pong":true}', stderr: '', error: null };
      };

      const parsed = await engine.ask('give me json');

      expect(parsed).toEqual({ pong: true });
      expect(calls.length).toBe(2);
      expect(calls[1]).toContain('REMINDER');
      expect(calls[1]).toContain('give me json');
    });

    it('returns null and logs events when every attempt fails', async () => {
      engine.options.runPrompt = async () => ({ code: 1, stdout: 'nope', stderr: '', error: 'exit code 1' });

      const parsed = await engine.ask('give me json');

      expect(parsed).toBeNull();
      const events = fs.readFileSync(path.join(tmpDir, '.yuva', 'events.log'), 'utf8');
      expect(events).toContain('loop.ai_error');
    });
  });

  describe('state persistence', () => {
    it('saves and merges loop state in .yuva/loop.json', () => {
      engine.saveState({ goal: 'g', iteration: 1 });
      engine.saveState({ iteration: 2 });
      const state = engine.loadState();
      expect(state.goal).toBe('g');
      expect(state.iteration).toBe(2);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'loop.json'))).toBe(true);
    });
  });

  describe('escalate()', () => {
    it('fails a task at the attempt limit and creates a debugger task', () => {
      const task = bus.addTask({ title: 'flaky', role: 'executor' });
      bus.updateTask(task.id, { attempts: 3, feedback: 'lint failed' });

      const messages = engine.escalate();

      expect(bus.getTask(task.id).status).toBe('failed');
      const debugTasks = bus.listTasks().filter(t => t.role === 'debugger');
      expect(debugTasks.length).toBe(1);
      expect(debugTasks[0].title).toContain('flaky');
      expect(debugTasks[0].description).toContain('lint failed');
      expect(debugTasks[0].priority).toBe(10);
      expect(messages.length).toBe(2);
    });

    it('does not create a debugger task for a failing debugger task', () => {
      const task = bus.addTask({ title: 'debug me', role: 'debugger' });
      bus.updateTask(task.id, { attempts: 3 });

      engine.escalate();

      expect(bus.getTask(task.id).status).toBe('failed');
      expect(bus.listTasks().filter(t => t.status === 'pending').length).toBe(0);
    });

    it('leaves tasks under the attempt limit alone', () => {
      const task = bus.addTask({ title: 'young', role: 'executor' });
      bus.updateTask(task.id, { attempts: 2 });

      const messages = engine.escalate();

      expect(messages).toEqual([]);
      expect(bus.getTask(task.id).status).toBe('pending');
    });
  });

  describe('writeReport()', () => {
    it('writes .yuva/report.md and marks the loop state terminal', () => {
      const task = bus.addTask({ title: 'shipped', role: 'executor' });
      bus.updateTask(task.id, { status: 'verified', summary: 'done well' });

      const file = engine.writeReport('my goal', { done: true, reason: 'AI review: goal achieved', iterations: 2 });

      const report = fs.readFileSync(file, 'utf8');
      expect(report).toContain('my goal');
      expect(report).toContain('GOAL ACHIEVED');
      expect(report).toContain('shipped');
      expect(engine.loadState().status).toBe('complete');
    });
  });
});

describe('verifyDoneTasks()', () => {
  it('verifies all done tasks when no gates are detected (vacuous pass)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-verify-'));
    try {
      const bus = new TaskBus(tmpDir);
      bus.init();
      const task = bus.addTask({ title: 'T', role: 'executor' });
      bus.updateTask(task.id, { status: 'done', completedAt: new Date().toISOString() });

      const messages = verifyDoneTasks(bus, tmpDir);

      expect(messages.length).toBe(1);
      expect(messages[0].passed).toBe(true);
      expect(bus.getTask(task.id).status).toBe('verified');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
