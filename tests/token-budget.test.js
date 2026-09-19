const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  estimateTokens, findCacheBreakers, zoneForHeading,
  profileWorkPackage, isOrderedForCaching, projectRunCost, costOf,
} = require('../lib/token-budget');
const { buildWorkPackage } = require('../lib/work-package');

describe('token-budget', () => {
  describe('estimateTokens()', () => {
    it('approximates at ~4 chars per token', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens(null)).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('a'.repeat(400))).toBe(100);
    });
  });

  describe('zoneForHeading()', () => {
    it('treats the role banner as frozen, not per-task', () => {
      // The banner names the role, never the task id.
      expect(zoneForHeading('Yuva Work Package - executor worker')).toBe('frozen');
    });

    it('classifies standing instruction as frozen', () => {
      expect(zoneForHeading('Your Agent Instructions (executor)')).toBe('frozen');
      expect(zoneForHeading('ENFORCEMENT RULES (machine-verified)')).toBe('frozen');
      expect(zoneForHeading('Completion Protocol (MANDATORY)')).toBe('frozen');
    });

    it('classifies moving project state as volatile', () => {
      expect(zoneForHeading('Project Context (auto-detected)')).toBe('volatile');
      expect(zoneForHeading('Codebase Analysis')).toBe('volatile');
    });

    it('defaults unknown headings to task scope', () => {
      expect(zoneForHeading('YOUR TASK - abc123')).toBe('task');
      expect(zoneForHeading('Something Else')).toBe('task');
    });
  });

  describe('findCacheBreakers()', () => {
    it('flags a task id in the prefix', () => {
      const found = findCacheBreakers('# Work Package — Task 88f51a66c14b');
      expect(found.map(f => f.id)).toContain('task-id');
    });

    it('flags timestamps and git isolation branches', () => {
      expect(findCacheBreakers('built 2026-09-19T08:42:54').map(f => f.id)).toContain('timestamp');
      expect(findCacheBreakers('on yuva/worker-w1a2-task-x').map(f => f.id)).toContain('git-branch');
    });

    it('flags an attempt counter', () => {
      expect(findCacheBreakers('- **Attempt:** 3').map(f => f.id)).toContain('attempt-counter');
    });

    it('returns nothing for genuinely stable text', () => {
      expect(findCacheBreakers('You are an executor. Follow the plan.')).toEqual([]);
    });
  });

  describe('isOrderedForCaching()', () => {
    it('is true when every frozen section precedes the task', () => {
      expect(isOrderedForCaching([
        { zone: 'frozen' }, { zone: 'volatile' }, { zone: 'task' },
      ])).toBe(true);
    });

    it('is false when task content comes first', () => {
      // The pre-2.3 layout: leading with the task id kills the whole prefix.
      expect(isOrderedForCaching([
        { zone: 'task' }, { zone: 'frozen' },
      ])).toBe(false);
    });
  });

  describe('projectRunCost()', () => {
    const profile = { total: 1000, cacheableTokens: 800 };

    it('charges one cold write per distinct prefix and reads thereafter', () => {
      const r = projectRunCost(profile, { tasks: 10, roles: 1, attempts: 1 });
      expect(r.invocations).toBe(10);
      expect(r.distinctPrefixes).toBe(1);
      // 1 write @1.25x + 9 reads @0.1x + 10 x 200 variable
      expect(r.cachedTotal).toBe(Math.round(800 * 1.25 + 9 * 800 * 0.1 + 10 * 200));
      expect(r.uncachedTotal).toBe(10000);
      expect(r.savedRatio).toBeGreaterThan(0.6);
    });

    it('saves nothing on a single invocation — the write costs more than the send', () => {
      const r = projectRunCost(profile, { tasks: 1, roles: 1, attempts: 1 });
      expect(r.savedTokens).toBeLessThan(0);
    });

    it('scales cold writes with the number of roles', () => {
      const one = projectRunCost(profile, { tasks: 12, roles: 1, attempts: 1 });
      const three = projectRunCost(profile, { tasks: 12, roles: 3, attempts: 1 });
      expect(three.cachedTotal).toBeGreaterThan(one.cachedTotal);
    });

    it('counts retries as extra invocations', () => {
      const once = projectRunCost(profile, { tasks: 5, roles: 1, attempts: 1 });
      const twice = projectRunCost(profile, { tasks: 5, roles: 1, attempts: 2 });
      expect(twice.invocations).toBe(10);
      expect(twice.uncachedTotal).toBe(once.uncachedTotal * 2);
    });
  });

  describe('costOf()', () => {
    it('prices tokens against a per-million rate', () => {
      expect(costOf(1_000_000, 5)).toBeCloseTo(5);
      expect(costOf(40_000, 5)).toBeCloseTo(0.2);
    });
  });
});

describe('work package cache layout', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-wp-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const task = (over = {}) => ({
    id: 'abc123def456',
    title: 'Build the thing',
    description: 'Details here',
    role: 'executor',
    attempts: 1,
    feedback: null,
    ...over,
  });

  it('emits frozen standing instruction before per-task content', () => {
    const pkg = buildWorkPackage(task(), tmpDir);
    const profile = profileWorkPackage(pkg);
    expect(profile.orderedForCaching).toBe(true);
  });

  it('keeps the task id out of the cacheable prefix', () => {
    const pkg = buildWorkPackage(task(), tmpDir);
    const profile = profileWorkPackage(pkg);
    expect(profile.breakers).toEqual([]);
    // The id still has to reach the worker — just not before the prefix.
    expect(pkg).toContain('abc123def456');
    expect(pkg.indexOf('abc123def456')).toBeGreaterThan(pkg.indexOf('ENFORCEMENT'));
  });

  it('produces a byte-identical prefix for two different tasks in a role', () => {
    const a = buildWorkPackage(task({ id: 'aaa111', title: 'First' }), tmpDir);
    const b = buildWorkPackage(task({ id: 'bbb222', title: 'Second' }), tmpDir);
    const prefixOf = s => s.slice(0, s.indexOf('## YOUR TASK'));
    expect(prefixOf(a)).toBe(prefixOf(b));
    expect(prefixOf(a).length).toBeGreaterThan(0);
  });

  it('a retry reuses the same prefix as the first attempt', () => {
    const first = buildWorkPackage(task({ attempts: 1 }), tmpDir);
    const retry = buildWorkPackage(task({ attempts: 2, feedback: 'gates failed' }), tmpDir);
    const prefixOf = s => s.slice(0, s.indexOf('## YOUR TASK'));
    expect(prefixOf(retry)).toBe(prefixOf(first));
    expect(retry).toContain('gates failed');
  });

  it('most of the package is cacheable', () => {
    const profile = profileWorkPackage(buildWorkPackage(task(), tmpDir));
    expect(profile.cacheableRatio).toBeGreaterThan(0.5);
  });
});
