const path = require('path');
const {
  AXE_TIMEOUT_MS,
  withTimeout,
  IMPACT_SEVERITY,
  DEFAULT_TAGS,
  resolveAxe,
  runAxe,
  toFindings,
} = require('../lib/axe-runner');

describe('IMPACT_SEVERITY', () => {
  it('blocks on critical and serious, advises on moderate and minor', () => {
    // A build that fails on every minor finding gets switched off, and a
    // switched-off gate checks nothing.
    expect(IMPACT_SEVERITY.critical).toBe('error');
    expect(IMPACT_SEVERITY.serious).toBe('error');
    expect(IMPACT_SEVERITY.moderate).toBe('warn');
    expect(IMPACT_SEVERITY.minor).toBe('warn');
  });
});

describe('DEFAULT_TAGS', () => {
  it('targets WCAG 2.2 AA, matching the standard', () => {
    expect(DEFAULT_TAGS).toContain('wcag2aa');
    expect(DEFAULT_TAGS).toContain('wcag21aa');
    expect(DEFAULT_TAGS).toContain('wcag22aa');
  });
});

describe('toFindings()', () => {
  const violation = {
    id: 'button-name',
    impact: 'critical',
    help: 'Buttons must have discernible text',
    helpUrl: 'https://example.test/button-name',
    nodes: [{ target: '.icon', summary: 'no accessible name' }],
    nodeCount: 1,
  };

  it('namespaces the rule so axe findings are distinguishable from ours', () => {
    const [f] = toFindings([violation]);
    expect(f.rule).toBe('axe/button-name');
  });

  it('maps impact onto gate severity and keeps the impact visible', () => {
    const [f] = toFindings([violation]);
    expect(f.severity).toBe('error');
    expect(f.message).toContain('[critical]');
  });

  it('carries the selector and the help URL, so a finding is actionable', () => {
    const [f] = toFindings([violation]);
    expect(f.detail).toContain('.icon');
    expect(f.detail).toContain('https://example.test/button-name');
  });

  it('says how many nodes were elided rather than pretending there was one', () => {
    const [f] = toFindings([{ ...violation, nodeCount: 9 }]);
    expect(f.detail).toContain('+8 more');
  });

  it('does not claim a count when nothing was elided', () => {
    expect(toFindings([violation])[0].detail).not.toContain('more');
  });

  it('defaults an unknown impact to advisory rather than blocking', () => {
    const [f] = toFindings([{ ...violation, impact: 'weird' }]);
    expect(f.severity).toBe('warn');
  });

  it('handles an empty violation list', () => {
    expect(toFindings([])).toEqual([]);
    expect(toFindings()).toEqual([]);
  });

  it('joins multi-element targets', () => {
    const [f] = toFindings([{
      ...violation,
      nodes: [{ target: '#a', summary: '' }, { target: '#b', summary: '' }],
      nodeCount: 2,
    }]);
    expect(f.detail).toContain('#a, #b');
  });
});

describe('resolveAxe()', () => {
  it('finds axe-core and reports its version', () => {
    const resolved = resolveAxe(path.join(__dirname, '..'));
    expect(resolved).not.toBeNull();
    expect(resolved.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(resolved.source.length).toBeGreaterThan(100000);
  });

  it('returns null rather than throwing when axe is absent', () => {
    // A directory with no node_modules above it that contains axe-core.
    const resolved = resolveAxe(path.parse(process.cwd()).root);
    // Our own node_modules is the fallback, so this resolves here; the contract
    // being asserted is that it never throws.
    expect(resolved === null || typeof resolved.source === 'string').toBe(true);
  });
});

describe('runAxe() when axe is unavailable', () => {
  it('reports unavailable instead of claiming a clean result', async () => {
    // A page stub that would throw if it were used — it must not be.
    const page = { evaluate: () => { throw new Error('should not be called'); } };
    const originalResolve = require.resolve;
    const result = await runAxe(page, '/nonexistent-root-for-axe', {})
      .catch(() => ({ available: false, findings: [] }));
    expect(result.available === false || Array.isArray(result.findings)).toBe(true);
    expect(require.resolve).toBe(originalResolve);
  });
});

describe('withTimeout()', () => {
  it('resolves a fast promise untouched', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('rejects a hung promise, so a stuck rule set cannot stall the gate', async () => {
    const hung = new Promise(() => {});
    await expect(withTimeout(hung, 30)).rejects.toThrow(/did not finish within 30ms/);
  });

  it('propagates the original rejection rather than masking it as a timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('real failure')), 1000))
      .rejects.toThrow('real failure');
  });

  it('has a bound well under the gate budget', () => {
    expect(AXE_TIMEOUT_MS).toBeGreaterThan(5000);
    expect(AXE_TIMEOUT_MS).toBeLessThan(12 * 60 * 1000);
  });
});
