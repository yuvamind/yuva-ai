import path from 'path';
import { execSync, execFileSync } from 'child_process';
import { readJSON, fileExists } from './fs-utils';
import { RESULT_PREFIX } from './visual-gate';
import { debug } from './debug';
import * as P from './paths';
import { runPluginGates } from './plugin-gates';
import * as _e2e_runner from './e2e-runner';
import * as _visual_gate from './visual-gate';

const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';
const GATE_ORDER = ['lint', 'typecheck', 'test', 'build', 'visual', 'e2e'];
const GATE_TIMEOUT_MS = 5 * 60 * 1000;
// The visual gate boots a dev server and drives a browser over N routes x
// N viewports, so it needs a far longer budget than a text-only check.
const VISUAL_TIMEOUT_MS = 12 * 60 * 1000;

/**
 * Detect quality gates for a project.
 * Priority: .yuva/config.json "gates" overrides > package.json scripts > language heuristics.
 * A config value of false disables that gate.
 * Returns: [{ name, command }]
 */
/** A quality gate: a shell command, or a native in-process runner. */
export interface Gate {
  name: string;
  command: string | null;
  /** Set for gates that run in-process rather than as a shell command. */
  native?: 'visual' | 'e2e' | null;
  [key: string]: unknown;
}

/** One failed gate as runAllGates() reports it, from either source. */
export interface GateFailure {
  name: string;
  source: 'project' | 'plugin';
  output?: string | null;
  id?: string;
  findings?: unknown;
}

/** A gate plus how its run went. */
export interface GateResult extends Gate {
  status: string;
  output: string | null;
  durationMs: number;
  [key: string]: unknown;
}

function detectGates(targetDir: string): Gate[] {
  // Both come from user-editable JSON; the shapes are asserted, not trusted.
  const overrides: Record<string, unknown> = (readJSON(P.configFile(targetDir)) || {}).gates || {};
  const detected: Record<string, string> = {};

  const pkg = readJSON(path.join(targetDir, 'package.json'));
  if (pkg && pkg.scripts) {
    const s = pkg.scripts as Record<string, string>;
    if (s.lint) detected.lint = 'npm run lint';
    if (s.typecheck) detected.typecheck = 'npm run typecheck';
    else if (s['type-check']) detected.typecheck = 'npm run type-check';
    else if (fileExists(path.join(targetDir, 'tsconfig.json'))) detected.typecheck = 'npx tsc --noEmit';
    if (s.test && s.test !== NPM_DEFAULT_TEST) detected.test = 'npm test';
    if (s.build) detected.build = 'npm run build';
  } else if (fileExists(path.join(targetDir, 'Cargo.toml'))) {
    detected.typecheck = 'cargo check';
    detected.test = 'cargo test';
  } else if (fileExists(path.join(targetDir, 'go.mod'))) {
    detected.build = 'go build ./...';
    detected.test = 'go test ./...';
  } else if (fileExists(path.join(targetDir, 'pyproject.toml')) || fileExists(path.join(targetDir, 'requirements.txt'))) {
    if (fileExists(path.join(targetDir, 'tests')) || fileExists(path.join(targetDir, 'test'))) {
      detected.test = 'python -m pytest';
    }
  }

  // `visual` is native (in-process, not a shell command) and strictly opt-in:
  // it appears only once "visual" is configured, so existing projects are
  // unaffected by the new gate.
  if (overrides.visual !== false && isVisualConfigured(targetDir)) {
    detected.visual = NATIVE_VISUAL;
  }

  // The e2e suite is doubly opt-in: it needs an `e2e` block AND `gate: true`.
  // Agent steps cost money whenever the app changed, and a gate that quietly
  // spends on every run is a gate people turn off.
  if (overrides.e2e !== false && isE2EGateEnabled(targetDir)) {
    detected.e2e = NATIVE_E2E;
  }

  const gates: Gate[] = [];
  for (const name of GATE_ORDER) {
    const override = overrides[name];
    if (override === false) continue;
    const command = typeof override === 'string' ? override : detected[name];
    if (!command) continue;
    const native: Gate['native'] = command === NATIVE_VISUAL ? 'visual'
      : command === NATIVE_E2E ? 'e2e'
        : undefined;
    gates.push({ name, command, native });
  }

  // Custom gates from config not covered by the standard four
  for (const [name, command] of Object.entries(overrides)) {
    if (!GATE_ORDER.includes(name) && typeof command === 'string') {
      gates.push({ name, command });
    }
  }

  return gates;
}

/** Sentinel commands for gates that run in-process rather than via a shell. */
const NATIVE_VISUAL = '<native:visual>';
const NATIVE_E2E = '<native:e2e>';

/** Has this project opted the behaviour suite in as a gate? Never throws. */
function isE2EGateEnabled(targetDir: string): boolean {
  try {
    // Required lazily, as in the original: e2e-runner pulls in a heavy
    // dependency chain that most gate runs never touch.
    return _e2e_runner.isGateEnabled(targetDir);
  } catch (err) {
    debug('gate-runner', 'e2e gate detection failed', err);
    return false;
  }
}

/** Does this project opt into the visual gate? Never throws. */
function isVisualConfigured(targetDir: string): boolean {
  try {
    return _visual_gate.isConfigured(targetDir);
  } catch (err) {
    debug('gate-runner', 'visual gate detection failed', err);
    return false;
  }
}

/**
 * Run the visual gate in a child process.
 *
 * It is inherently async (spawn a server, drive a browser) while runGates and
 * all of its callers are synchronous, so the async half is isolated behind
 * execFileSync on `visual-runner.js`. argv array, no shell.
 */
function runVisualNative(targetDir: string) {
  const runner = require.resolve('./visual-runner.js');
  const parse = (stdout: string) => {
    const marker = (stdout || '').lastIndexOf(RESULT_PREFIX);
    if (marker === -1) return null;
    try {
      return JSON.parse(stdout.slice(marker + RESULT_PREFIX.length).trim());
    } catch (err) {
      debug('gate-runner', 'could not parse visual verdict', err);
      return null;
    }
  };

  try {
    const stdout = execFileSync(process.execPath, [runner, targetDir], {
      cwd: targetDir,
      encoding: 'utf8',
      timeout: VISUAL_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const verdict = parse(stdout);
    // 'skipped' means the gate was configured away mid-run; treat as a pass.
    return { status: 'passed', output: verdict && verdict.status === 'skipped' ? null : (verdict && verdict.output) || null };
  } catch (caught) {
    // execFileSync attaches the child's streams to the error it throws.
    const err = caught as { stdout?: string; stderr?: string; message?: string };
    const verdict = parse(err.stdout || '');
    const output = (verdict && verdict.output) ||
      [err.stdout, err.stderr].filter(Boolean).join('\n').trim() ||
      err.message;
    return { status: 'failed', output: String(output).slice(-8000) };
  }
}

/** Run the behaviour suite and reduce it to a gate outcome. */
function runE2ENative(targetDir: string) {
  try {
    const result = _e2e_runner.runE2E(targetDir);
    return { status: result.status, output: result.output || null };
  } catch (err) {
    debug('gate-runner', 'e2e gate crashed', err);
    return { status: 'failed', output: `e2e gate crashed: ${(err as Error).message}` };
  }
}

/**
 * Run quality gates. Options: { only: ['lint', ...] } to run a subset.
 * Returns: { passed, gates: [{ name, command, status, durationMs, output }] }
 * status is 'passed' or 'failed'; output is captured only on failure.
 */
function runGates(targetDir: string, { only }: { only?: string[] } = {}) {
  let gates = detectGates(targetDir);
  if (only && only.length > 0) {
    gates = gates.filter(g => only.includes(g.name));
  }

  const results: GateResult[] = [];
  let passed = true;

  for (const gate of gates) {
    const startedAt = Date.now();

    if (gate.native === 'visual') {
      const outcome = runVisualNative(targetDir);
      if (outcome.status === 'failed') passed = false;
      results.push({ ...gate, ...outcome, durationMs: Date.now() - startedAt });
      continue;
    }

    if (gate.native === 'e2e') {
      // Synchronous: `e2e` is a subprocess, so unlike the browser-driving
      // visual gate this needs no async bridge.
      const outcome = runE2ENative(targetDir);
      if (outcome.status === 'failed') passed = false;
      results.push({ ...gate, ...outcome, durationMs: Date.now() - startedAt });
      continue;
    }

    try {
      // Non-null: command is null only for native gates, which `continue`d above.
      execSync(gate.command!, {
        cwd: targetDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: GATE_TIMEOUT_MS,
        windowsHide: true,
      });
      results.push({ ...gate, status: 'passed', durationMs: Date.now() - startedAt, output: null });
    } catch (caught) {
      passed = false;
      const err = caught as { stdout?: string; stderr?: string; message?: string };
      const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message || '';
      results.push({ ...gate, status: 'failed', durationMs: Date.now() - startedAt, output: output.slice(-4000) });
    }
  }

  return { passed, gates: results };
}

/**
 * Run ALL gates — project gates (lint/test/build) + plugin gates (code rules).
 * Returns a unified result with both types.
 */
function runAllGates(targetDir: string, { only }: { only?: string[] } = {}) {

  // Project gates
  const projectResult = runGates(targetDir, { only });
  const failures: GateFailure[] = [];

  for (const gate of projectResult.gates) {
    if (gate.status === 'failed') {
      failures.push({ name: gate.name, output: gate.output, source: 'project' });
    }
  }

  // Plugin gates
  // Only `passed` and `gates` are read below, so the fallback need not fake the
  // rest of runPluginGates()'s result shape.
  let pluginResult: Pick<ReturnType<typeof runPluginGates>, 'passed' | 'gates'> = { passed: true, gates: [] };
  try {
    pluginResult = runPluginGates(targetDir);
    if (!pluginResult.passed) {
      for (const gate of pluginResult.gates) {
        if (gate.blocking) {
          failures.push({
            id: gate.id,
            name: gate.name,
            findings: gate.findings,
            source: 'plugin',
          });
        }
      }
    }
  } catch (err) { debug('gate-runner', 'plugin gates failed', err); }

  const passed = projectResult.passed && pluginResult.passed;

  return {
    passed,
    projectGates: projectResult,
    pluginGates: pluginResult,
    failures,
    summary: {
      projectPassed: projectResult.passed,
      pluginPassed: pluginResult.passed,
      totalFailures: failures.length,
    },
  };
}

export { detectGates, runGates, GATE_ORDER, runAllGates, NATIVE_VISUAL, NATIVE_E2E };