const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { readJSON, fileExists } = require('./fs-utils');
const { RESULT_PREFIX } = require('./visual-gate');
const { debug } = require('./debug');
const P = require('./paths');

const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';
const GATE_ORDER = ['lint', 'typecheck', 'test', 'build', 'visual'];
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
function detectGates(targetDir) {
  const overrides = (readJSON(P.configFile(targetDir)) || {}).gates || {};
  const detected = {};

  const pkg = readJSON(path.join(targetDir, 'package.json'));
  if (pkg && pkg.scripts) {
    const s = pkg.scripts;
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

  const gates = [];
  for (const name of GATE_ORDER) {
    const override = overrides[name];
    if (override === false) continue;
    const command = typeof override === 'string' ? override : detected[name];
    if (!command) continue;
    gates.push({ name, command, native: command === NATIVE_VISUAL ? 'visual' : undefined });
  }

  // Custom gates from config not covered by the standard four
  for (const [name, command] of Object.entries(overrides)) {
    if (!GATE_ORDER.includes(name) && typeof command === 'string') {
      gates.push({ name, command });
    }
  }

  return gates;
}

/** Sentinel command for a gate that runs in-process rather than via a shell. */
const NATIVE_VISUAL = '<native:visual>';

/** Does this project opt into the visual gate? Never throws. */
function isVisualConfigured(targetDir) {
  try {
    return require('./visual-gate').isConfigured(targetDir);
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
function runVisualNative(targetDir) {
  const runner = require.resolve('./visual-runner.js');
  const parse = (stdout) => {
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
  } catch (err) {
    const verdict = parse(err.stdout);
    const output = (verdict && verdict.output) ||
      [err.stdout, err.stderr].filter(Boolean).join('\n').trim() ||
      err.message;
    return { status: 'failed', output: String(output).slice(-8000) };
  }
}

/**
 * Run quality gates. Options: { only: ['lint', ...] } to run a subset.
 * Returns: { passed, gates: [{ name, command, status, durationMs, output }] }
 * status is 'passed' or 'failed'; output is captured only on failure.
 */
function runGates(targetDir, { only } = {}) {
  let gates = detectGates(targetDir);
  if (only && only.length > 0) {
    gates = gates.filter(g => only.includes(g.name));
  }

  const results = [];
  let passed = true;

  for (const gate of gates) {
    const startedAt = Date.now();

    if (gate.native === 'visual') {
      const outcome = runVisualNative(targetDir);
      if (outcome.status === 'failed') passed = false;
      results.push({ ...gate, ...outcome, durationMs: Date.now() - startedAt });
      continue;
    }

    try {
      execSync(gate.command, {
        cwd: targetDir,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: GATE_TIMEOUT_MS,
        windowsHide: true,
      });
      results.push({ ...gate, status: 'passed', durationMs: Date.now() - startedAt, output: null });
    } catch (err) {
      passed = false;
      const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim() || err.message;
      results.push({ ...gate, status: 'failed', durationMs: Date.now() - startedAt, output: output.slice(-4000) });
    }
  }

  return { passed, gates: results };
}

/**
 * Run ALL gates — project gates (lint/test/build) + plugin gates (code rules).
 * Returns a unified result with both types.
 */
function runAllGates(targetDir, { only } = {}) {
  const { runPluginGates } = require('./plugin-gates');

  // Project gates
  const projectResult = runGates(targetDir, { only });
  const failures = [];

  for (const gate of projectResult.gates) {
    if (gate.status === 'failed') {
      failures.push({ name: gate.name, output: gate.output, source: 'project' });
    }
  }

  // Plugin gates
  let pluginResult = { passed: true, gates: [] };
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

module.exports = { detectGates, runGates, GATE_ORDER, runAllGates, NATIVE_VISUAL };
