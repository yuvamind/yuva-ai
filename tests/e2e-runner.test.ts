import fs from 'fs';
import os from 'os';
import path from 'path';

import * as runner from '../lib/e2e-runner';
import { detectGates, GATE_ORDER, NATIVE_E2E } from '../lib/gate-runner';
import type { E2eFinding } from '../lib/e2e-runner';

const {
  SUPPORTED_SCHEMA, BENIGN_SKIPS, EXIT_MEANINGS,
  resolveConfig, detectInstall, findConfigFile, isGateEnabled,
  parseReport, toFindings, describeRun, summarize, formatFindings, buildArgs,
} = runner;

let dir: string;

const write = (rel: string, contents: unknown) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
};

/** Pretend e2e is installed, without a 4.5MB install per test. */
const fakeInstall = () => {
  const bin = process.platform === 'win32' ? 'e2e.cmd' : 'e2e';
  write(path.join('node_modules', '.bin', bin), '#!/bin/sh\n');
  write(path.join('node_modules', 'e2e', 'package.json'), { name: 'e2e', version: '0.15.1' });
};

/* ---- report fixtures, shaped to the real report-1 schema ---------- */

const result = (over = {}) => ({
  id: 'a'.repeat(64),
  testId: 'test-1',
  kind: 'test',
  declarationIndex: 0,
  titlePath: ['checkout', 'a member upgrades to Pro'],
  file: 'tests/e2e/checkout.e2e.ts',
  source: { file: 'tests/e2e/checkout.e2e.ts', line: 12, column: 3 },
  targetId: 'web',
  platform: 'chromium',
  status: 'passed',
  attempts: [],
  ...over,
});

const report = (over = {}) => ({
  schemaVersion: SUPPORTED_SCHEMA,
  run: {
    id: '0199', specVersion: 1, runner: { name: 'e2e', version: '0.15.1' },
    status: 'passed', exitCode: 0,
    startedAt: '2026-10-02T00:00:00.000Z',
    project: { id: 'app' }, environment: {}, targets: [], serialGroups: [],
    results: [], errors: [],
    summary: { discovered: 1, selected: 1, executed: 1, passed: 1, failed: 0, flaky: 0, skipped: 0 },
    limits: {}, usage: {},
    ...over,
  },
});

const rules = (f: E2eFinding[]) => f.map(x => x.rule);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-e2e-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/* ------------------------------------------------------------------ */

describe('fixtures match the vendored schema', () => {
  // Guards against testing an imagined shape. The schema ships inside the e2e
  // package; if it is not installed, this self-skips rather than failing.
  const schemaPath = path.join(__dirname, '..', 'node_modules', 'e2e', 'schema', 'report-v1.schema.json');
  const available = fs.existsSync(schemaPath);
  const maybe = available ? it : it.skip;

  maybe('the run fixture carries every required field', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const required = schema.$defs.run.required;
    const fixture = report().run;
    const missing = required.filter((k: string) => !(k in fixture));
    expect(missing, `run fixture is missing required fields: ${missing.join(', ')}`).toEqual([]);
  });

  maybe('the result fixture carries every required field', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const missing = schema.$defs.result.required.filter((k: string) => !(k in result()));
    expect(missing, `result fixture is missing: ${missing.join(', ')}`).toEqual([]);
  });

  maybe('every non-benign skip cause in the schema is treated as a failure', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const causes = schema.$defs.skip.properties.cause.enum;
    // Only "we chose not to run it" is benign. Everything else means the test
    // never ran, which reads as green if nobody looks.
    expect(causes.filter((c: string) => BENIGN_SKIPS.has(c)).sort()).toEqual(['explicit', 'filtered']);
    expect(causes.filter((c: string) => !BENIGN_SKIPS.has(c)).length).toBeGreaterThan(4);
  });

  maybe('the exit codes we map are the ones the schema allows', () => {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const codes = schema.$defs.run.properties.exitCode.enum;
    expect(codes.sort((a: number, b: number) => a - b)).toEqual(Object.keys(EXIT_MEANINGS).map(Number).sort((a: number, b: number) => a - b));
  });
});

describe('resolveConfig()', () => {
  it('is null without an e2e block — the integration is opt-in', () => {
    expect(resolveConfig(dir)).toBeNull();
    write('.yuva/config.json', { llm: 'claude' });
    expect(resolveConfig(dir)).toBeNull();
  });

  it('is null when explicitly disabled', () => {
    write('.yuva/config.json', { e2e: false });
    expect(resolveConfig(dir)).toBeNull();
  });

  it('defaults the gate OFF even once the block exists', () => {
    write('.yuva/config.json', { e2e: {} });
    expect(resolveConfig(dir)!.gate).toBe(false);
    expect(isGateEnabled(dir)).toBe(false);
  });

  it('turns the gate on only when asked', () => {
    write('.yuva/config.json', { e2e: { gate: true } });
    expect(isGateEnabled(dir)).toBe(true);
  });

  it('reads filters, limits and the cost ceiling', () => {
    write('.yuva/config.json', {
      e2e: { target: 'web', tags: ['smoke'], grep: 'checkout', workers: 2, retries: 1,
        maxFailures: 3, failOnFlaky: true, maxCostUsd: 0.5, cache: false, strictCache: true },
    });
    const cfg = resolveConfig(dir);
    expect(cfg).toMatchObject({
      target: 'web', tags: ['smoke'], grep: 'checkout', workers: 2, retries: 1,
      maxFailures: 3, failOnFlaky: true, maxCostUsd: 0.5, noCache: true, strictCache: true,
    });
  });
});

describe('detectInstall()', () => {
  it('reports a project with nothing installed', () => {
    expect(detectInstall(dir)).toMatchObject({ installed: false, version: null, configFile: null });
  });

  it('finds the local binary and version', () => {
    fakeInstall();
    expect(detectInstall(dir)).toMatchObject({ installed: true, version: '0.15.1' });
  });

  it('finds the config whichever extension it uses', () => {
    write('e2e.config.mts', 'export default {}');
    expect(findConfigFile(dir)).toBe('e2e.config.mts');
  });

  it('prefers e2e.config.ts when several exist', () => {
    write('e2e.config.mts', '');
    write('e2e.config.ts', '');
    expect(findConfigFile(dir)).toBe('e2e.config.ts');
  });
});

describe('parseReport()', () => {
  it('parses a clean document', () => {
    expect(parseReport(JSON.stringify(report()))!.schemaVersion).toBe(SUPPORTED_SCHEMA);
  });

  it('extracts the document when another reporter also wrote to stdout', () => {
    const noise = 'Running 3 tests...\n  ✓ checkout\n';
    const parsed = parseReport(`${noise}${JSON.stringify(report())}\nDone.\n`)!;
    expect(parsed).not.toBeNull();
    expect(parsed.run!.summary!.passed).toBe(1);
  });

  it('handles braces inside strings without truncating', () => {
    const doc = report({ errors: [{ category: 'test', code: 'X', message: 'got {"a":1} back', retryable: false }] });
    const parsed = parseReport(`noise\n${JSON.stringify(doc)}`)!;
    expect(parsed.run!.errors![0].message).toBe('got {"a":1} back');
  });

  it('returns null for empty or unparseable output rather than throwing', () => {
    expect(parseReport('')).toBeNull();
    expect(parseReport(null)).toBeNull();
    expect(parseReport('total nonsense')).toBeNull();
    expect(parseReport('{"schemaVersion": broken')).toBeNull();
  });
});

describe('toFindings() — a healthy run', () => {
  it('finds nothing in a clean pass', () => {
    expect(toFindings(report(), { exitCode: 0 })).toEqual([]);
  });

  it('ignores an explicitly skipped test', () => {
    const r = report({
      results: [result({ status: 'skipped', skip: { cause: 'explicit', reason: 'not ready' } })],
      summary: { discovered: 1, selected: 1, executed: 1, passed: 0, failed: 0, flaky: 0, skipped: 1 },
    });
    expect(toFindings(r, { exitCode: 0 })).toEqual([]);
  });
});

describe('toFindings() — failures', () => {
  it('reports a failed test with its message and location', () => {
    const r = report({
      status: 'failed', exitCode: 1,
      results: [result({
        status: 'failed',
        attempts: [{ id: '1', index: 0, status: 'failed', startedAt: '', durationMs: 10,
          steps: [], artifacts: [], secondaryErrors: [], cleanup: 'complete',
          error: { category: 'test', code: 'assertion-failed', message: 'expected Pro, saw Free', retryable: false },
          failure: { url: 'http://localhost:3000/billing', screenshot: '.e2e/shot.png' } }],
      })],
      summary: { discovered: 1, selected: 1, executed: 1, passed: 0, failed: 1, flaky: 0, skipped: 0 },
    });
    const [f] = toFindings(r, { exitCode: 1 });
    expect(f.rule).toBe('e2e-failed');
    expect(f.severity).toBe('error');
    expect(f.message).toContain('a member upgrades to Pro');
    expect(f.message).toContain('expected Pro, saw Free');
    expect(f.file).toBe('tests/e2e/checkout.e2e.ts');
    expect(f.line).toBe(12);
    expect(f.detail).toContain('.e2e/shot.png');       // evidence is actionable
    expect(f.detail).toContain('assertion-failed');
  });

  it('distinguishes a timeout from a failure', () => {
    const r = report({ results: [result({ status: 'timed-out' })] });
    expect(rules(toFindings(r, { exitCode: 1 }))).toContain('e2e-timed-out');
  });

  it('takes the error from the LAST attempt, not the first', () => {
    const attempt = (msg: string) => ({ id: '1', index: 0, status: 'failed', startedAt: '', durationMs: 1,
      steps: [], artifacts: [], secondaryErrors: [], cleanup: 'complete',
      error: { category: 'test', code: 'c', message: msg, retryable: true } });
    const r = report({ results: [result({ status: 'failed', attempts: [attempt('first try'), attempt('final try')] })] });
    expect(toFindings(r, { exitCode: 1 })[0].message).toContain('final try');
  });
});

describe('toFindings() — the failures that look like successes', () => {
  it('flags a skip caused by setup failing, which otherwise reads as green', () => {
    const r = report({
      results: [result({ status: 'skipped', skip: { cause: 'setup-failed', reason: 'login fixture threw' } })],
      summary: { discovered: 1, selected: 1, executed: 1, passed: 0, failed: 0, flaky: 0, skipped: 1 },
    });
    const [f] = toFindings(r, { exitCode: 0 });
    expect(f.rule).toBe('e2e-silent-skip');
    expect(f.message).toContain('never ran');
    expect(f.detail).toContain('not a passing test');
  });

  it('flags infrastructure-unavailable the same way', () => {
    const r = report({
      results: [result({ status: 'skipped', skip: { cause: 'infrastructure-unavailable', reason: 'no device' } })],
      summary: { discovered: 1, selected: 1, executed: 1, passed: 0, failed: 0, flaky: 0, skipped: 1 },
    });
    expect(rules(toFindings(r, { exitCode: 0 }))).toContain('e2e-silent-skip');
  });

  it('reports a flaky test, because flaky is not passing', () => {
    const r = report({ results: [result({ status: 'flaky' })] });
    const [f] = toFindings(r, { exitCode: 0 });
    expect(f.rule).toBe('e2e-flaky');
    expect(f.severity).toBe('warn');
  });

  it('blocks on flaky when the project asks it to', () => {
    const r = report({ results: [result({ status: 'flaky' })] });
    const [f] = toFindings(r, { exitCode: 0, failOnFlaky: true });
    expect(f.severity).toBe('error');
  });

  it('warns when the run executed nothing — a suite that runs nothing passes trivially', () => {
    const r = report({ summary: { discovered: 0, selected: 0, executed: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 } });
    const [f] = toFindings(r, { exitCode: 0 });
    expect(f.rule).toBe('e2e-no-tests');
    expect(f.detail).toMatch(/globs/);
  });
});

describe('toFindings() — run-level problems', () => {
  it('separates a configuration error from a product bug', () => {
    const r = report({
      status: 'error', exitCode: 2,
      errors: [{ category: 'configuration', code: 'bad-target', message: 'unknown target "mobile"',
        retryable: false, phase: 'config' }],
    });
    const [f] = toFindings(r, { exitCode: 2 });
    expect(f.rule).toBe('e2e-run-error');
    expect(f.message).toContain('configuration/bad-target');
    expect(f.message).toContain('during config');
    expect(f.detail).toMatch(/not a product bug/);
  });

  it('explains an infrastructure failure usefully', () => {
    const r = report({
      status: 'error', exitCode: 3,
      errors: [{ category: 'infrastructure', code: 'model-unavailable', message: '401 from provider', retryable: true }],
    });
    expect(toFindings(r, { exitCode: 3 })[0].detail).toMatch(/retryable/i);
  });

  it('reports a schema it was not written for, instead of misreading it', () => {
    const r = report();
    r.schemaVersion = 'report-2';
    const f = toFindings(r, { exitCode: 0 });
    expect(f[0].rule).toBe('e2e-schema-mismatch');
    expect(f[0].message).toContain('report-2');
  });

  it('falls back to the exit code when no report could be parsed', () => {
    const [f] = toFindings(null, { exitCode: 3 });
    expect(f.rule).toBe('e2e-run-error');
    expect(f.message).toContain('infrastructure failure');
    expect(f.detail).toMatch(/model credentials/);
  });

  it('says nothing when there is no report and nothing failed', () => {
    expect(toFindings(null, { exitCode: 0 })).toEqual([]);
  });
});

describe('toFindings() — cost', () => {
  const costly = () => report({ usage: { modelTokens: 90000, modelCachedTokens: 10000, estimatedCostUsd: 1.25 } });

  it('warns when a run goes over the ceiling', () => {
    const [f] = toFindings(costly(), { exitCode: 0, maxCostUsd: 0.5 });
    expect(f.rule).toBe('e2e-cost');
    expect(f.message).toContain('1.25');
    expect(f.detail).toMatch(/cache/);
  });

  it('says nothing when under the ceiling, or when no ceiling is set', () => {
    expect(rules(toFindings(costly(), { exitCode: 0, maxCostUsd: 5 }))).not.toContain('e2e-cost');
    expect(rules(toFindings(costly(), { exitCode: 0 }))).not.toContain('e2e-cost');
  });
});

describe('describeRun()', () => {
  it('surfaces the counts and the real spend', () => {
    const r = describeRun(report({ usage: { modelTokens: 1000, modelCachedTokens: 800, estimatedCostUsd: 0.02 } }));
    expect(r).toMatchObject({ passed: 1, failed: 0, modelTokens: 1000, cachedTokens: 800, estimatedCostUsd: 0.02 });
  });

  it('is null without a report', () => {
    expect(describeRun(null)).toBeNull();
  });
});

describe('buildArgs()', () => {
  const base = { target: null, tags: [], grep: null, workers: null, retries: null,
    maxFailures: null, noCache: false, strictCache: false };

  it('always asks for the json reporter, so the output is parseable', () => {
    expect(buildArgs(base, {})).toEqual(expect.arrayContaining(['run', '--reporter', 'json']));
  });

  it('passes --pass-with-no-tests so an empty glob is not read as a product failure', () => {
    expect(buildArgs(base, {})).toContain('--pass-with-no-tests');
  });

  it('threads filters through', () => {
    const args = buildArgs({ ...base, target: 'web', tags: ['smoke', 'a11y'], grep: 'checkout',
      workers: 3, retries: 2, maxFailures: 1, noCache: true, strictCache: true }, {});
    expect(args).toEqual(expect.arrayContaining([
      '--target', 'web', '--tag', 'smoke,a11y', '--grep', 'checkout',
      '--workers', '3', '--retries', '2', '--max-failures', '1', '--no-cache', '--strict-cache',
    ]));
  });

  it('puts positional file selectors before the flags', () => {
    const args = buildArgs(base, { files: ['tests/e2e/checkout.e2e.ts'] });
    expect(args[0]).toBe('run');
    expect(args[1]).toBe('tests/e2e/checkout.e2e.ts');
  });

  it('adds --headed and --last-failed only when asked', () => {
    expect(buildArgs(base, {})).not.toContain('--headed');
    expect(buildArgs(base, { headed: true, lastFailed: true }))
      .toEqual(expect.arrayContaining(['--headed', '--last-failed']));
  });
});

describe('runE2E() preflight', () => {
  it('explains how to install when e2e is absent, instead of a spawn error', () => {
    const result = runner.runE2E(dir);
    expect(result.status).toBe('failed');
    expect(result.findings[0].rule).toBe('e2e-not-installed');
    expect(result.findings[0].detail).toContain('npm install -D e2e');
  });

  it('explains the missing config when installed but unconfigured', () => {
    fakeInstall();
    const result = runner.runE2E(dir);
    expect(result.findings[0].rule).toBe('e2e-no-config');
    expect(result.findings[0].detail).toContain('yuva e2e init');
  });
});

describe('gate integration', () => {
  it('lists e2e last, after the visual gate', () => {
    expect(GATE_ORDER).toEqual(['lint', 'typecheck', 'test', 'build', 'visual', 'e2e']);
  });

  it('does NOT appear for a project that merely has an e2e block', () => {
    // Doubly opt-in: the block makes `yuva e2e` configurable, `gate: true`
    // makes it a gate. Agent steps cost money.
    write('package.json', { scripts: { lint: 'eslint .' } });
    write('.yuva/config.json', { e2e: {} });
    expect(detectGates(dir).map(g => g.name)).not.toContain('e2e');
  });

  it('appears once gate:true is set, marked native', () => {
    write('package.json', { scripts: { lint: 'eslint .' } });
    write('.yuva/config.json', { e2e: { gate: true } });
    const gate = detectGates(dir).find(g => g.name === 'e2e')!;
    expect(gate).toBeDefined();
    expect(gate.native).toBe('e2e');
    expect(gate.command).toBe(NATIVE_E2E);
  });

  it('can still be disabled by a gates override', () => {
    write('package.json', { scripts: { lint: 'eslint .' } });
    write('.yuva/config.json', { e2e: { gate: true }, gates: { e2e: false } });
    expect(detectGates(dir).map(g => g.name)).not.toContain('e2e');
  });
});

describe('summarize() and formatFindings()', () => {
  it('passes on warnings alone and fails on errors', () => {
    const flaky = toFindings(report({ results: [result({ status: 'flaky' })] }), { exitCode: 0 });
    expect(summarize(flaky).passed).toBe(true);
    const failed = toFindings(report({ results: [result({ status: 'failed' })] }), { exitCode: 1 });
    expect(summarize(failed).passed).toBe(false);
  });

  it('groups blocking before advisory', () => {
    const r = report({
      results: [result({ status: 'failed' }), result({ testId: 't2', status: 'flaky' })],
    });
    const text = formatFindings(toFindings(r, { exitCode: 1 }));
    expect(text.indexOf('BLOCKING')).toBeLessThan(text.indexOf('ADVISORY'));
  });

  it('reports when there is nothing to report', () => {
    expect(formatFindings([])).toMatch(/No e2e findings/);
  });
});
