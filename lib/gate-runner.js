const path = require('path');
const { execSync } = require('child_process');
const { readJSON, fileExists } = require('./fs-utils');

const NPM_DEFAULT_TEST = 'echo "Error: no test specified" && exit 1';
const GATE_ORDER = ['lint', 'typecheck', 'test', 'build'];
const GATE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Detect quality gates for a project.
 * Priority: .aiautomations/config.json "gates" overrides > package.json scripts > language heuristics.
 * A config value of false disables that gate.
 * Returns: [{ name, command }]
 */
function detectGates(targetDir) {
  const overrides = (readJSON(path.join(targetDir, '.aiautomations', 'config.json')) || {}).gates || {};
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

  const gates = [];
  for (const name of GATE_ORDER) {
    const override = overrides[name];
    if (override === false) continue;
    const command = typeof override === 'string' ? override : detected[name];
    if (command) gates.push({ name, command });
  }

  // Custom gates from config not covered by the standard four
  for (const [name, command] of Object.entries(overrides)) {
    if (!GATE_ORDER.includes(name) && typeof command === 'string') {
      gates.push({ name, command });
    }
  }

  return gates;
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

module.exports = { detectGates, runGates, GATE_ORDER };
