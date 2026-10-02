const { log, box, success, error, warn, info } = require('../colors');
const { detectGates, runGates, runAllGates } = require('../gate-runner');
const { formatPluginGates } = require('../plugin-gates');
const { parseFlags } = require('../arg-utils');

function showGateHelp() {
  box('Yuva AI - Quality Gates');
  log('Usage:', 'bright');
  log('  yuva gate                Run ALL quality gates (lint, typecheck, test, build, visual)');
  log('  yuva gate <name>         Run a single gate (e.g. yuva gate lint)');
  log('  yuva gate list           Show detected gates without running them\n');
  log('Gates are auto-detected from package.json scripts (or Cargo/Go/Python).', 'dim');
  log('Override in .yuva/config.json:', 'dim');
  log('  { "gates": { "test": "npm run test:ci", "build": false } }\n', 'dim');
  log('The "visual" gate is opt-in — it appears once "visual" is configured.', 'dim');
  log('It boots the app, renders every route at every viewport, and audits the', 'dim');
  log('RENDERED result (computed styles, not source text):', 'dim');
  log('  { "visual": { "url": "http://localhost:5173", "routes": ["/"] } }', 'dim');
  log('', 'dim');
  log('Without fixtures it renders whatever the app happens to show, so a', 'dim');
  log('screenshot of an empty shell passes. For a reproducible render add:', 'dim');
  log('  "fixtures": {', 'dim');
  log('    "seedCommand":  "npm run seed:visual",', 'dim');
  log('    "storageState": ".yuva/visual-auth.json",', 'dim');
  log('    "mocks":        [{ "url": "**/api/**", "file": "fixtures/api.json" }],', 'dim');
  log('    "freezeTime":   "2026-01-01T12:00:00Z",', 'dim');
  log('    "waitFor":      "[data-testid=ready]",', 'dim');
  log('    "mask":         [".timestamp", ".avatar"]', 'dim');
  log('  }', 'dim');
  log('', 'dim');
  log('For regression detection: "baseline": { "threshold": 0.001 }.', 'dim');
  log('The FIRST run WRITES the baseline rather than verifying anything.', 'dim');
  log('Needs Playwright:  npm i -D playwright && npx playwright install chromium', 'dim');
  log('Optional:          npm i -D axe-core   (adds WCAG conformance rules;', 'dim');
  log('                   without it the report says "axe-core: NOT RUN")\n', 'dim');
  log('`yuva gates` additionally runs "design-contract", which validates', 'dim');
  log('docs/design-contract.json and lints the UI source it declares.\n', 'dim');
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
      warn('No gates detected. Add scripts to package.json or configure "gates" in .yuva/config.json');
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
    info('Add scripts (lint/test/build) to package.json, or set "gates" in .yuva/config.json');
    return;
  }

  if (only && !gates.some(g => g.name === sub)) {
    // The visual gate is opt-in, so "not detected" is almost always "not
    // configured yet" rather than a typo. Say the useful thing.
    if (sub === 'visual') {
      error('The visual gate is not configured for this project.');
      log('');
      info('Add a "visual" block to .yuva/config.json, then re-run:');
      log('  {');
      log('    "visual": {');
      log('      "url": "http://localhost:5173",');
      log('      "routes": ["/"],');
      log('      "viewports": [');
      log('        { "name": "mobile",  "width": 375,  "height": 812 },');
      log('        { "name": "desktop", "width": 1440, "height": 900 }');
      log('      ]');
      log('    }');
      log('  }');
      log('');
      info('It also needs a browser:');
      log('  npm install -D playwright && npx playwright install chromium');
      log('');
      process.exitCode = 1;
      return;
    }
    error(`Unknown gate: ${sub}. Run "yuva gate list" to see detected gates.`);
    process.exitCode = 1;
    return;
  }

  box('Yuva AI - Running Quality Gates');
  const result = runAllGates(targetDir, { only });
  printResults(result.projectGates);

  // Also run plugin gates
  if (!only) {
    log('');
    log('Plugin Gates:', 'bright');
    log(formatPluginGates(result.pluginGates));
  }

  log('');
  if (result.passed) {
    success('All gates passed.');
  } else {
    const failed = result.projectGates.gates.filter(g => g.status === 'failed');
    const pluginFailed = result.pluginGates.gates.filter(g => !g.passed);
    if (failed.length) error(`${failed.length} project gate(s) FAILED.`);
    if (pluginFailed.length) error(`${pluginFailed.length} plugin gate(s) FAILED.`);
    error('Quality gates FAILED. Work is NOT complete until all gates pass.');
    process.exitCode = 1;
  }
  log('');
}

module.exports = gateCommand;
