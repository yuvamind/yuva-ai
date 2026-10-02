/**
 * Integration with `e2e` (https://github.com/tester-army/e2e) — an agent-driven
 * end-to-end testing framework.
 *
 * Why this belongs in Yuva: the `visual` gate checks what the UI *looks* like,
 * and stops there. Keyboard operability, focus restoration after a dialog
 * closes, and forcing a data surface through its five states are *behaviour*,
 * and `componentcontracts.md` section 13 has had them sitting in "review only"
 * because nothing could check them. `e2e` drives a real app toward a
 * natural-language goal, so it can.
 *
 * Both are Playwright underneath, so this adds a tool rather than a stack.
 *
 * Strictly opt-in, and separate from `yuva gate` by default: an agent step costs
 * a model call the first time and whenever the app changes (verified steps are
 * cached and replayed otherwise). A gate that silently spends money on every run
 * is a gate people disable.
 *
 * Parsing targets the report-1 schema shipped in `e2e/schema/report-v1.schema.json`,
 * read rather than guessed. `e2e` is pre-1.0, so `schemaVersion` is checked and a
 * mismatch is reported loudly instead of being silently misread.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { readJSON } = require('./fs-utils');
const { debug } = require('./debug');
const P = require('./paths');

/** The report shape this integration was written against. */
const SUPPORTED_SCHEMA = 'report-1';

const CONFIG_FILES = ['e2e.config.ts', 'e2e.config.mts', 'e2e.config.js', 'e2e.config.mjs'];

const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

/** Used by `yuva e2e run` when the project has no `e2e` block configured. */
const DEFAULT_RUN_CONFIG = {
  target: null, tags: [], grep: null, workers: null, retries: null, maxFailures: null,
  timeoutMs: DEFAULT_TIMEOUT_MS, failOnFlaky: false, maxCostUsd: null,
  noCache: false, strictCache: false, gate: false,
};

/**
 * What each exit code means. Taken from the CLI reference, not inferred — the
 * difference between "a test failed" and "your model provider is down" is the
 * difference between a useful finding and a wild goose chase.
 */
const EXIT_MEANINGS = {
  0: { label: 'passed', severity: null, hint: 'all tests passed, were flaky, or were explicitly skipped' },
  1: { label: 'test failure', severity: 'error', hint: 'a test or setup failed or timed out' },
  2: { label: 'configuration error', severity: 'error', hint: 'CLI, config, collection, credential or policy error — not a product bug' },
  3: { label: 'infrastructure failure', severity: 'error', hint: 'engine, app, model provider, artifact or cleanup failure — check the app is running and the model credentials are set' },
  4: { label: 'internal runner error', severity: 'error', hint: 'a bug in the e2e runner itself' },
  130: { label: 'interrupted', severity: 'warn', hint: 'interrupted by a signal' },
};

/**
 * A skip is not always benign. Only `explicit` and `filtered` mean "we chose not
 * to run this"; the rest mean something broke and the test never got a chance.
 */
const BENIGN_SKIPS = new Set(['explicit', 'filtered']);

const RULE_SEVERITY = {
  'e2e-failed': 'error',
  'e2e-timed-out': 'error',
  'e2e-run-error': 'error',
  'e2e-not-installed': 'error',
  'e2e-no-config': 'error',
  'e2e-schema-mismatch': 'error',
  'e2e-silent-skip': 'warn',
  'e2e-flaky': 'warn',
  'e2e-interrupted': 'warn',
  'e2e-no-tests': 'warn',
  'e2e-cost': 'warn',
};

/* ------------------------------------------------------------------ *
 * Detection and config
 * ------------------------------------------------------------------ */

/**
 * Resolve how to invoke the project's own `e2e`, as an argv pair.
 *
 * Deliberately NOT the `.bin` shim. Since Node 18.20 / 20.12, spawning a
 * `.cmd` or `.bat` without `shell: true` throws EINVAL (the CVE-2024-27980
 * mitigation) — and execFileSync reports that with `stdout` and `stderr` both
 * `undefined`, so the failure is completely silent. Running the package's own
 * JS entry with `process.execPath` sidesteps the shim, behaves identically on
 * every platform, and keeps us off `shell: true` (no quoting, no injection
 * surface).
 *
 * Never falls back to `npx`: that can reach the network and install something
 * the project did not pin.
 *
 * @returns {{ command: string, prefixArgs: string[] }|null}
 */
function resolveCli(targetDir) {
  const pkgDir = path.join(targetDir, 'node_modules', 'e2e');
  const pkg = readJSON(path.join(pkgDir, 'package.json'));
  if (pkg && pkg.bin) {
    const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.e2e;
    if (entry) {
      const full = path.join(pkgDir, entry);
      if (fs.existsSync(full)) return { command: process.execPath, prefixArgs: [full] };
    }
  }

  // Last resort: the shim, with the shell Windows requires for a .cmd.
  const shim = path.join(targetDir, 'node_modules', '.bin',
    process.platform === 'win32' ? 'e2e.cmd' : 'e2e');
  if (fs.existsSync(shim)) return { command: shim, prefixArgs: [], needsShell: process.platform === 'win32' };
  return null;
}

/** Locate the e2e config file, whichever extension it uses. */
function findConfigFile(targetDir) {
  for (const name of CONFIG_FILES) {
    if (fs.existsSync(path.join(targetDir, name))) return name;
  }
  return null;
}

/**
 * Is the project set up for e2e?
 * @returns {{ installed:boolean, version:string|null, binary:string|null, configFile:string|null }}
 */
function detectInstall(targetDir) {
  const cli = resolveCli(targetDir);
  let version = null;
  try {
    const pkg = readJSON(path.join(targetDir, 'node_modules', 'e2e', 'package.json'));
    if (pkg) version = pkg.version;
  } catch (err) {
    debug('e2e-runner', 'could not read e2e version', err);
  }
  return {
    installed: Boolean(cli),
    version,
    cli,
    configFile: findConfigFile(targetDir),
  };
}

/**
 * Resolve the `e2e` block from `.yuva/config.json`.
 * Returns null when absent — the whole integration is opt-in.
 */
function resolveConfig(targetDir) {
  const cfg = (readJSON(P.configFile(targetDir)) || {}).e2e;
  if (cfg === false || !cfg) return null;

  return {
    target: typeof cfg.target === 'string' ? cfg.target : null,
    tags: Array.isArray(cfg.tags) ? cfg.tags : [],
    grep: typeof cfg.grep === 'string' ? cfg.grep : null,
    workers: Number.isFinite(cfg.workers) ? cfg.workers : null,
    retries: Number.isFinite(cfg.retries) ? cfg.retries : null,
    maxFailures: Number.isFinite(cfg.maxFailures) ? cfg.maxFailures : null,
    timeoutMs: Number.isFinite(cfg.timeoutMs) ? cfg.timeoutMs : DEFAULT_TIMEOUT_MS,
    // Flaky means "passed on a retry". Treating that as success is how a suite
    // rots, so it is reported — as advisory by default, blocking on request.
    failOnFlaky: cfg.failOnFlaky === true,
    // A spend ceiling, because agent steps cost money whenever the app changed.
    maxCostUsd: Number.isFinite(cfg.maxCostUsd) ? cfg.maxCostUsd : null,
    // `read-only` replays the cache and never calls a model; useful in CI.
    noCache: cfg.cache === false,
    strictCache: cfg.strictCache === true,
    gate: cfg.gate === true,
  };
}

/** True when the project opted this in as a quality gate (separate from the command). */
function isGateEnabled(targetDir) {
  const cfg = resolveConfig(targetDir);
  return Boolean(cfg && cfg.gate);
}

/* ------------------------------------------------------------------ *
 * Report parsing
 * ------------------------------------------------------------------ */

/**
 * Pull the report document out of stdout.
 *
 * The json reporter writes the document to stdout, but a config may add other
 * reporters that also write there, so this does not assume the whole stream is
 * the document.
 */
function parseReport(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch { /* mixed output; fall through */ }

  const marker = text.indexOf('"schemaVersion"');
  if (marker === -1) return null;

  // Walk back to the enclosing `{`, then forward to its balanced close.
  const start = text.lastIndexOf('{', marker);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (err) {
          debug('e2e-runner', 'balanced slice did not parse', err);
          return null;
        }
      }
    }
  }
  return null;
}

function finding(rule, message, detail, file, line) {
  return {
    rule,
    severity: RULE_SEVERITY[rule] || 'warn',
    message,
    detail: detail || null,
    file: file || null,
    line: typeof line === 'number' ? line : 0,
  };
}

/** Human-readable test name from the titlePath array. */
function titleOf(result) {
  const parts = Array.isArray(result.titlePath) ? result.titlePath.filter(Boolean) : [];
  return parts.length ? parts.join(' › ') : (result.testId || result.id || 'unnamed test');
}

/** The most informative error across a result's attempts. */
function errorOf(result) {
  const attempts = Array.isArray(result.attempts) ? result.attempts : [];
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i] && attempts[i].error) return attempts[i].error;
  }
  return null;
}

/** Screenshot or page URL captured at the moment of failure, if any. */
function evidenceOf(result) {
  const attempts = Array.isArray(result.attempts) ? result.attempts : [];
  for (let i = attempts.length - 1; i >= 0; i--) {
    const f = attempts[i] && attempts[i].failure;
    if (f && (f.screenshot || f.url)) {
      return [f.screenshot, f.url].filter(Boolean).join(' — ');
    }
  }
  return null;
}

/**
 * Turn a report into findings. Pure, so every mapping decision is testable
 * without running a browser or spending a model call.
 *
 * @param {object|null} report  parsed report-1 document
 * @param {object} options      { exitCode, maxCostUsd, failOnFlaky }
 */
function toFindings(report, options = {}) {
  const findings = [];
  const { exitCode, maxCostUsd, failOnFlaky } = options;

  if (!report) {
    const meaning = EXIT_MEANINGS[exitCode];
    if (exitCode !== 0) {
      findings.push(finding('e2e-run-error',
        `e2e exited ${exitCode} (${meaning ? meaning.label : 'unknown'}) and produced no parseable report`,
        meaning ? meaning.hint : null));
    }
    return findings;
  }

  if (report.schemaVersion && report.schemaVersion !== SUPPORTED_SCHEMA) {
    findings.push(finding('e2e-schema-mismatch',
      `e2e reported schema "${report.schemaVersion}", and this integration reads "${SUPPORTED_SCHEMA}"`,
      'e2e is pre-1.0 and its report shape can change. Findings below may be incomplete — upgrade Yuva or pin e2e.'));
  }

  const run = report.run || {};
  const results = Array.isArray(run.results) ? run.results : [];
  const summary = run.summary || {};

  // Run-level errors come first: a configuration or infrastructure failure
  // explains every test failure under it, and fixing those first is cheaper.
  for (const err of Array.isArray(run.errors) ? run.errors : []) {
    const where = err.phase ? ` during ${err.phase}` : '';
    findings.push(finding('e2e-run-error',
      `[${err.category}/${err.code}]${where}: ${err.message}`,
      err.category === 'configuration'
        ? 'This is a setup problem, not a product bug — the suite never got to test anything.'
        : err.retryable ? 'Marked retryable by the runner.' : null,
      err.source && err.source.file, err.source && err.source.line));
  }

  for (const result of results) {
    const title = titleOf(result);
    const file = result.file || null;
    const line = result.source && result.source.line;

    if (result.status === 'failed' || result.status === 'timed-out') {
      const err = errorOf(result);
      const evidence = evidenceOf(result);
      const rule = result.status === 'timed-out' ? 'e2e-timed-out' : 'e2e-failed';
      findings.push(finding(rule,
        `${title} — ${err ? err.message : result.status}`,
        [err && err.code ? `[${err.category}/${err.code}]` : null, evidence].filter(Boolean).join(' ') || null,
        file, line));
      continue;
    }

    if (result.status === 'flaky') {
      findings.push(finding('e2e-flaky',
        `${title} passed only on a retry`,
        'Flaky is not passing. A suite that tolerates retries stops telling you anything.',
        file, line));
      continue;
    }

    if (result.status === 'interrupted') {
      findings.push(finding('e2e-interrupted', `${title} was interrupted`, null, file, line));
      continue;
    }

    // A skip caused by setup failing or infrastructure being unavailable is a
    // failure wearing a skip's clothes, and reads as green if nobody looks.
    if (result.status === 'skipped' && result.skip && !BENIGN_SKIPS.has(result.skip.cause)) {
      findings.push(finding('e2e-silent-skip',
        `${title} never ran: ${result.skip.cause}`,
        `${result.skip.reason || ''} — this is not a passing test, it is an untested one.`.trim(),
        file, line));
    }
  }

  if (failOnFlaky) {
    for (const f of findings) {
      if (f.rule === 'e2e-flaky') f.severity = 'error';
    }
  }

  if (summary.selected === 0 || summary.executed === 0) {
    findings.push(finding('e2e-no-tests',
      'no tests were selected or executed',
      'A suite that runs nothing passes trivially. Check the `tests` globs and any tag or grep filters.'));
  }

  const usage = run.usage || {};
  if (Number.isFinite(maxCostUsd) && Number.isFinite(usage.estimatedCostUsd) &&
      usage.estimatedCostUsd > maxCostUsd) {
    findings.push(finding('e2e-cost',
      `run cost about $${usage.estimatedCostUsd.toFixed(4)}, over the $${maxCostUsd} ceiling`,
      'Agent steps call a model whenever the app changed. A rising bill usually means the cache is being invalidated — check `e2e cache stats`.'));
  }

  return findings;
}

/** Counts worth printing whether or not anything failed. */
function describeRun(report) {
  if (!report || !report.run) return null;
  const { summary = {}, usage = {}, status } = report.run;
  return {
    status,
    passed: summary.passed || 0,
    failed: summary.failed || 0,
    flaky: summary.flaky || 0,
    skipped: summary.skipped || 0,
    executed: summary.executed || 0,
    discovered: summary.discovered || 0,
    modelTokens: usage.modelTokens || 0,
    cachedTokens: usage.modelCachedTokens || 0,
    estimatedCostUsd: Number.isFinite(usage.estimatedCostUsd) ? usage.estimatedCostUsd : null,
  };
}

function summarize(findings = []) {
  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warn');
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };
}

function formatFindings(findings = []) {
  if (findings.length === 0) return 'No e2e findings.';
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  const lines = [];
  for (const severity of ['error', 'warn']) {
    const rules = [...byRule.entries()].filter(([, items]) => items[0].severity === severity);
    if (rules.length === 0) continue;
    lines.push(severity === 'error' ? 'BLOCKING' : 'ADVISORY');
    for (const [rule, items] of rules) {
      lines.push(`  ${rule}`);
      for (const item of items.slice(0, 6)) {
        const where = item.file ? ` (${item.file}${item.line ? `:${item.line}` : ''})` : '';
        lines.push(`    - ${item.message}${where}`);
        if (item.detail) lines.push(`      ${item.detail}`);
      }
      if (items.length > 6) lines.push(`    ... and ${items.length - 6} more`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/* ------------------------------------------------------------------ *
 * Running
 * ------------------------------------------------------------------ */

/** Build the argv for `e2e run`. Separated out so it is testable. */
function buildArgs(cfg, options = {}) {
  const args = ['run'];
  if (Array.isArray(options.files)) args.push(...options.files);

  args.push('--reporter', 'json');
  if (cfg.target) args.push('--target', cfg.target);
  if (cfg.tags.length) args.push('--tag', cfg.tags.join(','));
  if (cfg.grep) args.push('--grep', cfg.grep);
  if (cfg.workers !== null) args.push('--workers', String(cfg.workers));
  if (cfg.retries !== null) args.push('--retries', String(cfg.retries));
  if (cfg.maxFailures !== null) args.push('--max-failures', String(cfg.maxFailures));
  if (cfg.noCache) args.push('--no-cache');
  if (cfg.strictCache) args.push('--strict-cache');
  if (options.lastFailed) args.push('--last-failed');
  if (options.headed) args.push('--headed');
  // Without this, a project whose globs match nothing exits 1 and looks like a
  // product failure rather than a configuration one.
  args.push('--pass-with-no-tests');
  return args;
}

/**
 * Run the suite.
 *
 * Synchronous on purpose: `runGates()` and every caller of it are synchronous,
 * and `e2e` is a subprocess, so there is no reason to make the gate API async
 * the way the browser-driving visual gate had to.
 *
 * @returns {{ status, findings, report, run, output, exitCode }}
 */
function runE2E(targetDir, options = {}) {
  // `yuva e2e run` works without a `.yuva/config.json` e2e block — the block is
  // what opts the GATE in, not what makes the command usable.
  const cfg = resolveConfig(targetDir) || { ...DEFAULT_RUN_CONFIG };

  const install = detectInstall(targetDir);
  if (!install.installed) {
    return {
      status: 'failed',
      exitCode: null,
      report: null,
      run: null,
      findings: [finding('e2e-not-installed',
        'e2e is not installed in this project',
        'Install it where the tests live, so the version is pinned with the project:\n  npm install -D e2e\n  npx e2e init')],
      output: null,
    };
  }
  if (!install.configFile) {
    return {
      status: 'failed',
      exitCode: null,
      report: null,
      run: null,
      findings: [finding('e2e-no-config',
        'no e2e config file found (e2e.config.ts)',
        'Create one with `npx e2e init`, or `yuva e2e init` to scaffold it against this project.')],
      output: null,
    };
  }

  const args = buildArgs(cfg, options);
  let stdout = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(install.cli.command, [...install.cli.prefixArgs, ...args], {
      cwd: targetDir,
      encoding: 'utf8',
      timeout: cfg.timeoutMs,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      shell: install.cli.needsShell === true,
      env: { ...process.env, ...(options.env || {}) },
    });
  } catch (err) {
    stdout = err.stdout || '';
    exitCode = typeof err.status === 'number' ? err.status : 1;
    if (err.killed) {
      return {
        status: 'failed',
        exitCode: null,
        report: null,
        run: null,
        findings: [finding('e2e-run-error',
          `e2e did not finish within ${Math.round(cfg.timeoutMs / 1000)}s and was killed`,
          'Raise `e2e.timeoutMs` in .yuva/config.json, or narrow the run with tags or --grep.')],
        output: String(err.stderr || '').slice(-4000),
      };
    }
  }

  const report = parseReport(stdout);
  const findings = toFindings(report, {
    exitCode,
    maxCostUsd: cfg.maxCostUsd,
    failOnFlaky: cfg.failOnFlaky,
  });

  return {
    status: summarize(findings).passed ? 'passed' : 'failed',
    exitCode,
    report,
    run: describeRun(report),
    findings,
    output: formatFindings(findings),
  };
}

module.exports = {
  SUPPORTED_SCHEMA,
  DEFAULT_RUN_CONFIG,
  CONFIG_FILES,
  EXIT_MEANINGS,
  BENIGN_SKIPS,
  RULE_SEVERITY,
  resolveCli,
  findConfigFile,
  detectInstall,
  resolveConfig,
  isGateEnabled,
  parseReport,
  toFindings,
  describeRun,
  summarize,
  formatFindings,
  buildArgs,
  runE2E,
};
