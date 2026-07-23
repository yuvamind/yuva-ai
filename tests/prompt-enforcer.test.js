const fs = require('fs');
const path = require('path');
const os = require('os');
const { PromptEnforcer, formatEnforcementResult, PROTECTED_PATTERNS } = require('../lib/prompt-enforcer');

describe('PromptEnforcer', () => {
  let tmpDir;
  let enforcer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
    enforcer = new PromptEnforcer(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('PROTECTED_PATTERNS', () => {
    it('should protect .yuva/ directory', () => {
      expect(PROTECTED_PATTERNS.some(p => p.test('.yuva/tasks/abc.json'))).toBe(true);
    });

    it('should protect .session/ directory', () => {
      expect(PROTECTED_PATTERNS.some(p => p.test('.session/session.json'))).toBe(true);
    });

    it('should protect AGENTS.md', () => {
      expect(PROTECTED_PATTERNS.some(p => p.test('AGENTS.md'))).toBe(true);
    });

    it('should protect lock files', () => {
      expect(PROTECTED_PATTERNS.some(p => p.test('package-lock.json'))).toBe(true);
    });

    it('should NOT protect source files', () => {
      expect(PROTECTED_PATTERNS.some(p => p.test('src/auth.js'))).toBe(false);
    });
  });

  describe('buildPreFlightPrompt()', () => {
    it('should generate a verification prompt', () => {
      const task = { id: 'abc123', title: 'Build login', role: 'executor' };
      const prompt = enforcer.buildPreFlightPrompt(task, 'work package snippet');

      expect(prompt).toContain('Build login');
      expect(prompt).toContain('executor');
      expect(prompt).toContain('.yuva/');
      expect(prompt).toContain('JSON');
    });

    it('should list all protected files', () => {
      const task = { id: 'abc', title: 'Test', role: 'tester' };
      const prompt = enforcer.buildPreFlightPrompt(task, '');

      expect(prompt).toContain('.yuva/');
      expect(prompt).toContain('AGENTS.md');
      expect(prompt).toContain('package-lock.json');
    });
  });

  describe('validatePreFlight()', () => {
    it('should reject if AI does not understand', () => {
      const result = enforcer.validatePreFlight({ understood: false }, {});
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should reject null response', () => {
      const result = enforcer.validatePreFlight(null, {});
      expect(result.valid).toBe(false);
    });

    it('should pass for valid response', () => {
      const result = enforcer.validatePreFlight({
        understood: true,
        taskSummary: 'Build login endpoint',
        filesYouWillTouch: ['src/auth.js'],
        filesYouWillNOTTouch: ['.yuva/', 'AGENTS.md'],
        qualityGatesYouWillRun: ['npm test'],
        estimatedSteps: 3,
        risksOrBlockers: [],
      }, {});
      expect(result.valid).toBe(true);
    });

    it('should reject if AI plans to modify protected files', () => {
      const result = enforcer.validatePreFlight({
        understood: true,
        filesYouWillTouch: ['.yuva/tasks.json', 'src/auth.js'],
        qualityGatesYouWillRun: ['npm test'],
      }, {});
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.includes('.yuva/'))).toBe(true);
    });

    it('should warn if no files listed', () => {
      const result = enforcer.validatePreFlight({
        understood: true,
        filesYouWillTouch: [],
        qualityGatesYouWillRun: ['npm test'],
      }, {});
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('buildEnforcementSection()', () => {
    it('should generate enforcement rules', () => {
      const task = { id: 'abc', title: 'Test', role: 'executor' };
      const gates = [{ name: 'test', command: 'npm test' }];
      const section = enforcer.buildEnforcementSection(task, gates);

      expect(section).toContain('ENFORCEMENT RULES');
      expect(section).toContain('Protected Files');
      expect(section).toContain('.yuva/');
      expect(section).toContain('Scope Enforcement');
      expect(section).toContain('npm test');
    });
  });

  describe('validatePostTask()', () => {
    it('should pass when no files changed', () => {
      const task = { id: 'abc', title: 'Test', role: 'executor' };
      const result = enforcer.validatePostTask(task, null);
      expect(result.valid).toBe(true);
      expect(result.changedFiles).toEqual([]);
    });
  });

  describe('formatEnforcementResult()', () => {
    it('should format valid result', () => {
      const md = formatEnforcementResult({
        valid: true,
        violations: [],
        warnings: [],
        summary: { totalChanged: 3, protectedViolations: 0, scopeViolations: 0 },
      });
      expect(md).toContain('passed');
    });

    it('should format invalid result with violations', () => {
      const md = formatEnforcementResult({
        valid: false,
        violations: ['Protected file was modified: .yuva/tasks.json'],
        warnings: [],
        summary: { totalChanged: 1, protectedViolations: 1, scopeViolations: 0 },
      });
      expect(md).toContain('VIOLATIONS');
      expect(md).toContain('.yuva/');
    });
  });
});
