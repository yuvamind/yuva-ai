const path = require('path');
const fs = require('fs');
const os = require('os');
const { SessionManager } = require('../lib/session-manager');

describe('SessionManager', () => {
  let tmpDir;
  let sm;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-session-'));
    sm = new SessionManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('start()', () => {
    it('should create .session directory and files', () => {
      sm.start({ goal: 'Build feature X' });

      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session', 'session.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session', 'state.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session', 'log.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session', 'context.md'))).toBe(true);
    });

    it('should store goal and metadata in session.json', () => {
      const session = sm.start({ goal: 'Build feature X' });

      expect(session.goal).toBe('Build feature X');
      expect(session.status).toBe('active');
      expect(session.phase).toBe('starting');
      expect(session.id).toMatch(/^[0-9a-f]{16}$/);
      expect(session.startedAt).toBeTruthy();
      expect(session.endedAt).toBeNull();
      expect(session.entries).toEqual([]);
      expect(session.filesChanged).toEqual([]);
      expect(session.decisions).toEqual([]);
      expect(session.summary).toBeNull();
    });

    it('should not overwrite an active session', () => {
      const first = sm.start({ goal: 'First goal' });
      const second = sm.start({ goal: 'Second goal' });

      expect(second.id).toBe(first.id);
      expect(second.goal).toBe('First goal');
    });

    it('should start a new session after end()', () => {
      const first = sm.start({ goal: 'First goal' });
      sm.end();
      const second = sm.start({ goal: 'Second goal' });

      expect(second.id).not.toBe(first.id);
      expect(second.goal).toBe('Second goal');
      expect(second.status).toBe('active');
    });
  });

  describe('log()', () => {
    it('should append a timestamped entry', () => {
      sm.start({ goal: 'Test logging' });
      sm.log('Did something');

      const session = sm.getSession();
      expect(session.entries).toHaveLength(1);
      expect(session.entries[0].message).toBe('Did something');
      expect(session.entries[0].timestamp).toBeTruthy();
    });

    it('should default type to note', () => {
      sm.start({ goal: 'Test logging' });
      sm.log('A note');

      const session = sm.getSession();
      expect(session.entries[0].type).toBe('note');
    });

    it('should support type tags', () => {
      sm.start({ goal: 'Test types' });
      sm.log('Found a bug', { type: 'issue' });
      sm.log('Write tests', { type: 'todo' });
      sm.log('Changed approach', { type: 'decision' });

      const session = sm.getSession();
      expect(session.entries[0].type).toBe('issue');
      expect(session.entries[1].type).toBe('todo');
      expect(session.entries[2].type).toBe('decision');
    });

    it('should auto-start a session if none exists', () => {
      expect(sm.hasActiveSession()).toBe(false);

      sm.log('Auto-started entry');

      expect(sm.hasActiveSession()).toBe(true);
      const session = sm.getSession();
      expect(session.goal).toBe('Auto-started session');
      expect(session.entries).toHaveLength(1);
      expect(session.entries[0].message).toBe('Auto-started entry');
    });

    it('should append to log.md', () => {
      sm.start({ goal: 'Test log file' });
      sm.log('Entry one', { type: 'note' });
      sm.log('Entry two', { type: 'code' });

      const logContent = fs.readFileSync(path.join(tmpDir, '.yuva', 'session', 'log.md'), 'utf8');
      expect(logContent).toContain('**note**: Entry one');
      expect(logContent).toContain('**code**: Entry two');
    });
  });

  describe('save()', () => {
    it('should capture filesChanged', () => {
      sm.start({ goal: 'Save test' });
      sm.save({ filesChanged: ['src/index.js', 'lib/utils.js'] });

      const session = sm.getSession();
      expect(session.filesChanged).toEqual(['src/index.js', 'lib/utils.js']);
    });

    it('should write state.md with goal, summary, and phase', () => {
      sm.start({ goal: 'Save test' });
      sm.save({ summary: 'Did great work', phase: 'implementation', filesChanged: [] });

      const state = fs.readFileSync(path.join(tmpDir, '.yuva', 'session', 'state.md'), 'utf8');
      expect(state).toContain('Save test');
      expect(state).toContain('Did great work');
      expect(state).toContain('implementation');
    });

    it('should set lastSavedAt timestamp', () => {
      sm.start({ goal: 'Save test' });
      sm.save({ summary: 'checkpoint' });

      const session = sm.getSession();
      expect(session.lastSavedAt).toBeTruthy();
    });
  });

  describe('resume()', () => {
    it('should return context string containing goal', () => {
      sm.start({ goal: 'Resume test' });
      const context = sm.resume();

      expect(context).toContain('Resume test');
    });

    it('should include entries in context', () => {
      sm.start({ goal: 'Resume test' });
      sm.log('Did thing one');
      sm.log('Did thing two');

      const context = sm.resume();
      expect(context).toContain('Did thing one');
      expect(context).toContain('Did thing two');
    });

    it('should include decisions in context', () => {
      sm.start({ goal: 'Resume test' });
      sm.decision('Use vitest', 'It is fast');

      const context = sm.resume();
      expect(context).toContain('Use vitest');
      expect(context).toContain('It is fast');
    });

    it('should include files changed in context', () => {
      sm.start({ goal: 'Resume test' });
      sm.save({ filesChanged: ['src/app.js'] });

      const context = sm.resume();
      expect(context).toContain('src/app.js');
    });

    it('should return "No active session" when none exists', () => {
      const result = sm.resume();
      expect(result).toBe('No active session');
    });

    it('should write context.md', () => {
      sm.start({ goal: 'Resume test' });
      sm.resume();

      const content = fs.readFileSync(path.join(tmpDir, '.yuva', 'session', 'context.md'), 'utf8');
      expect(content).toContain('Resume test');
    });
  });

  describe('end()', () => {
    it('should mark session as completed', () => {
      sm.start({ goal: 'End test' });
      sm.end();

      const session = sm.getSession();
      expect(session.status).toBe('completed');
    });

    it('should set endedAt timestamp', () => {
      sm.start({ goal: 'End test' });
      sm.end();

      const session = sm.getSession();
      expect(session.endedAt).toBeTruthy();
    });

    it('should no longer be active after end', () => {
      sm.start({ goal: 'End test' });
      expect(sm.hasActiveSession()).toBe(true);

      sm.end();
      expect(sm.hasActiveSession()).toBe(false);
    });
  });

  describe('decision()', () => {
    it('should record what and why', () => {
      sm.start({ goal: 'Decision test' });
      sm.decision('Use CommonJS', 'Project standard');

      const session = sm.getSession();
      expect(session.decisions).toHaveLength(1);
      expect(session.decisions[0].what).toBe('Use CommonJS');
      expect(session.decisions[0].why).toBe('Project standard');
      expect(session.decisions[0].timestamp).toBeTruthy();
    });

    it('should also add an entry to the log', () => {
      sm.start({ goal: 'Decision test' });
      sm.decision('Use CommonJS', 'Project standard');

      const session = sm.getSession();
      const decisionEntry = session.entries.find(e => e.type === 'decision');
      expect(decisionEntry).toBeTruthy();
      expect(decisionEntry.message).toContain('Use CommonJS');
    });

    it('should auto-start session if none exists', () => {
      sm.decision('Pick framework', 'Best option');

      expect(sm.hasActiveSession()).toBe(true);
      const session = sm.getSession();
      expect(session.decisions).toHaveLength(1);
    });
  });

  describe('hasActiveSession()', () => {
    it('should return false when no session exists', () => {
      expect(sm.hasActiveSession()).toBe(false);
    });

    it('should return true after start()', () => {
      sm.start({ goal: 'Test' });
      expect(sm.hasActiveSession()).toBe(true);
    });

    it('should return false after end()', () => {
      sm.start({ goal: 'Test' });
      sm.end();
      expect(sm.hasActiveSession()).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should remove .session directory', () => {
      sm.start({ goal: 'Clear test' });
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session'))).toBe(true);

      sm.clear();
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session'))).toBe(false);
    });

    it('should not throw if no session exists', () => {
      expect(() => sm.clear()).not.toThrow();
    });
  });

  describe('getSession()', () => {
    it('should return null when no session exists', () => {
      expect(sm.getSession()).toBeNull();
    });

    it('should return the session object', () => {
      sm.start({ goal: 'Get test' });
      const session = sm.getSession();
      expect(session.goal).toBe('Get test');
    });
  });

  describe('autoSave()', () => {
    it('should update lastSavedAt and write all files', () => {
      sm.start({ goal: 'Auto-save test' });
      sm.log('Did something');

      const before = sm.getSession();
      expect(before.lastSavedAt).toBeNull();

      sm.autoSave();

      const after = sm.getSession();
      expect(after.lastSavedAt).toBeTruthy();
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session', 'state.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session', 'context.md'))).toBe(true);
    });

    it('should do nothing when no session exists', () => {
      expect(() => sm.autoSave()).not.toThrow();
    });

    it('should do nothing when session is completed', () => {
      sm.start({ goal: 'Test' });
      sm.end();

      const endedAt = sm.getSession().endedAt;
      sm.autoSave();

      // Should not have changed anything
      expect(sm.getSession().endedAt).toBe(endedAt);
    });
  });
});

describe('SessionManager legacy migration', () => {
  it('moves an old .session/ directory into .yuva/session/', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-legacy-'));
    try {
      fs.mkdirSync(path.join(tmpDir, '.session'));
      fs.writeFileSync(path.join(tmpDir, '.session', 'session.json'), JSON.stringify({
        id: 'abc', goal: 'old goal', status: 'active', phase: 'work',
        entries: [], decisions: [], filesChanged: [],
      }));

      const sm = new SessionManager(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'session', 'session.json'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.session'))).toBe(false);
      expect(sm.getSession().goal).toBe('old goal');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
