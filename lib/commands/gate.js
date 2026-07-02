const { log, box, success, error, warn, info } = require('../colors');
const { detectGates, runGates } = require('../gate-runner');
const { parseFlags } = require('../arg-utils');

function showGateHelp() {
  box('Yuva AI - Quality Gates');
  log('Usage:', 'bright');
  log('  yuva gate                Run ALL quality gates (lint, typecheck, test, build)');
  log('  yuva gate <name>         Run a single gate (e.g. yuva gate lint)');
  log('  yuva gate list           Show detected gates without running them\n');
  log('Gates are auto-detected from package.json scripts (or Cargo/Go/Python).', 'dim');
  log('Override in .aiautomations/config.json:', 'dim');
  log('  { "gates": { "test": "npm run test:ci", "build": false } }\n', 'dim');
  log('Exit code is non-zero when any gate fails — safe for hooks and CI.\n', 'dim');
}

function printResults(result) {
  for (const gate of result.gates) {
    const seconds = (gate.durationMs / 1000).toFixed(1);
    if (gate.status === 'passed') {
      success(`${gate.name.padEnd(10)} passed  (${seconds}s)  ${gate.command}`);
    } else {
      error(`${gate.name.padEnd(10)} FAILED  (${seconds}s)  ${gate.command}`);
      if (gate.output) {
        log('');
        log(gate.output.split('\n').map(l => `    ${l}`).join('\n'), 'dim');
        log('');
      }
    }
  }
}

function gateCommand(args = []) {
  const { positional } = parseFlags(args);
  const targetDir = process.cwd();
  const sub = positional[0];

  if (sub === 'help') {
    showGateHelp();
    return;
  }

  if (sub === 'list') {
    const gates = detectGates(targetDir);
    box('Yuva AI - Detected Quality Gates');
    if (gates.length === 0) {
      warn('No gates detected. Add scripts to package.json or configure "gates" in .aiautomations/config.json');
      return;
    }
    for (const gate of gates) {
      log(`  ${gate.name.padEnd(10)} ${gate.command}`);
    }
    log('');
    return;
  }

  const only = sub ? [sub] : undefined;
  const gates = detectGates(targetDir);

  if (gates.length === 0) {
    warn('No quality gates detected — nothing to verify.');
    info('Add scripts (lint/test/build) to package.json, or set "gates" in .aiautomations/config.json');
    return;
  }

  if (only && !gates.some(g => g.name === sub)) {
    error(`Unknown gate: ${sub}. Run "yuva gate list" to see detected gates.`);
    process.exitCode = 1;
    return;
  }

  box('Yuva AI - Running Quality Gates');
  const result = runGates(targetDir, { only });
  printResults(result);

  log('');
  if (result.passed) {
    success('All gates passed.');
  } else {
    error('Quality gates FAILED. Work is NOT complete until all gates pass.');
    process.exitCode = 1;
  }
  log('');
}

module.exports = gateCommand;
