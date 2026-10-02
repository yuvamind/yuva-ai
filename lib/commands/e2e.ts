import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { log, box, success, error, warn, info, table } from '../colors';
import { parseFlags } from '../arg-utils';
import { readJSON, writeJSON, ensureDir } from '../fs-utils';
import { resolveTemplateFile } from '../work-package';
import { CostTracker } from '../cost-tracker';
import { debug } from '../debug';
import * as runner from '../e2e-runner';
import * as P from '../paths';
import type { describeRun } from '../e2e-runner';
import type { Recommendation } from '../e2e-auth';

import * as auth from '../e2e-auth';
import type { FlagValue } from '../arg-utils';
type Flags = Record<string, FlagValue>;

function showHelp() {
  box('Yuva AI - Agent-driven E2E tests');
  log('Usage:', 'bright');
  log('  yuva e2e                  Run the behaviour suite');
  log('  yuva e2e run [files...]   Run specific tests (path, name, or glob)');
  log('  yuva e2e init             Scaffold e2e.config.ts and starter tests');
  log('  yuva e2e list             List the tests without running them');
  log('  yuva e2e login [provider]  Sign in to a subscription (no API key)');
  log('  yuva e2e models [provider] Which models that subscription serves');
  log('  yuva e2e cache [ls|stats|clear]');
  log('  yuva e2e status           Show install, auth, config and gate state\n');
  log('Flags for run:', 'bright');
  log('  --headed                  Watch the browser drive the app');
  log('  --last-failed             Only what failed last time');
  log('  --gate                    Exit non-zero on findings (for CI)\n');
  log('What this covers that `yuva gate visual` cannot:', 'dim');
  log('  keyboard operability, focus restoration after a dialog closes, and', 'dim');
  log('  forcing a data surface through its five states — behaviour, not looks.\n', 'dim');
  log('Auth — subscription first:', 'dim');
  log('  Yuva drives AI CLIs you already pay for, so the agent should too.', 'dim');
  log('  github-copilot serves OpenAI, Anthropic, Google and xAI models on one', 'dim');
  log('  login, and --from-gh reuses the GitHub CLI you are already signed into.', 'dim');
  log('  e2e has no Claude subscription support, so Copilot is how a Claude Code', 'dim');
  log('  user reaches Anthropic models without an API key.\n', 'dim');
  log('Cost:', 'dim');
  log('  An agent step calls a model the first time and whenever the app', 'dim');
  log('  changes; verified steps replay from cache otherwise. This is why it', 'dim');
  log('  is a separate command and not part of `yuva gate` by default.', 'dim');
  log('  Opt it into the gate with { "e2e": { "gate": true } } in .yuva/config.json.\n', 'dim');
}

/* ------------------------------------------------------------------ */

function statusCommand(targetDir: string) {
  const install = runner.detectInstall(targetDir);
  const cfg = runner.resolveConfig(targetDir);
  const a = auth.inspect(targetDir);

  box('Yuva AI - E2E status');
  table(['Item', 'State'], [
    ['e2e installed', install.installed ? `yes (${install.version || 'unknown version'})` : 'NO'],
    ['config file', install.configFile || 'NONE'],
    ['yuva e2e block', cfg ? 'present' : 'absent'],
    ['runs as a gate', cfg && cfg.gate ? 'YES — part of `yuva gate`' : 'no — `yuva e2e` only'],
    ['yuva AI CLI', a.yuvaCli || 'not set (yuva llm use <name>)'],
    ['e2e subscription', a.logins.length ? `signed in: ${a.logins.join(', ')}` : 'none'],
    ['GitHub CLI', a.hasGh ? 'available (can reuse for Copilot)' : 'not found'],
    ['API keys', a.apiKeys.length ? a.apiKeys.join(', ') : 'none (good — subscriptions are preferred)'],
  ]);
  log('');
  info(`Agent auth: ${a.choice.kind} — ${a.choice.provider.name}`);
  log(`  ${a.choice.reason}`);
  if (a.choice.setup) log(`  Set up with:  ${a.choice.setup}`);
  log('');

  if (!install.installed) {
    warn('e2e is not installed in this project.');
    info('  npm install -D e2e @e2e-dev/web');
    info('  yuva e2e init');
    log('');
    return { installed: false };
  }
  if (!install.configFile) {
    warn('No e2e config file. Run: yuva e2e init');
    log('');
  }
  return { installed: true, configFile: install.configFile };
}

/* ------------------------------------------------------------------ */

function initCommand(args: string[], targetDir: string) {
  const { flags } = parseFlags(args, { booleans: ['force', 'local'] });
  box('Yuva AI - E2E setup');

  const install = runner.detectInstall(targetDir);
  if (!install.installed) {
    error('e2e is not installed in this project.');
    info('Install it where the tests live, so its version is pinned with the project:');
    log('  npm install -D e2e @e2e-dev/web\n');
    info('Then run this again. Nothing was written.');
    process.exitCode = 1;
    return;
  }

  // --- how the agent authenticates ------------------------------------
  // Subscription first. Yuva drives AI CLIs people already pay for; defaulting
  // to a per-token API key would make them buy a second way to pay for it.
  const a = auth.inspect(targetDir);
  const choice: Recommendation = flags.local
    ? { kind: 'local', provider: auth.LOCAL, reason: 'forced with --local',
      setup: 'Start Ollama (or any OpenAI-compatible server) on 127.0.0.1:11434',
      importLine: auth.LOCAL.import, expr: auth.LOCAL.expr, pkg: auth.LOCAL.pkg }
    : a.choice;

  info(`Agent auth: ${choice.provider.name}`);
  log(`  ${choice.reason}`);
  log('');

  if (choice.kind === 'api-key') {
    warn('This scaffolds an API-KEY config, which bills per token.');
    info('Yuva drives AI CLIs you already subscribe to. For a subscription instead:');
    for (const sub of auth.SUBSCRIPTIONS) {
      log(`  npx e2e login ${sub.id.padEnd(15)} ${sub.name} — ${sub.serves}`);
    }
    info('then re-run `yuva e2e init --force`.');
    log('');
  }

  // --- write the config ----------------------------------------------
  const existing = runner.findConfigFile(targetDir);
  const configPath = path.join(targetDir, 'e2e.config.ts');
  if (existing && !flags.force) {
    warn(`${existing} already exists — left alone. Use --force to overwrite.`);
  } else {
    // resolveTemplateFile returns the CONTENT, not a path — local
    // .yuva/templates/ wins over the packaged default.
    const template = resolveTemplateFile(targetDir, 'templates', 'e2e.config.ts');
    if (!template) {
      error('Could not find the e2e.config.ts template.');
      process.exitCode = 1;
      return;
    }
    const visualUrl = ((readJSON(P.configFile(targetDir)) || {}).visual || {}).url;
    const body = template
      .replace('// __MODEL_IMPORT__', choice.importLine)
      .replace('__MODEL_EXPR__', choice.expr)
      .replace('// __MODEL_COMMENT__', `// ${choice.reason.replace(/\s+/g, ' ')}`)
      .replace('__APP_URL__', visualUrl || 'http://localhost:3000');
    fs.writeFileSync(configPath, body, 'utf8');
    success(`Wrote e2e.config.ts${visualUrl ? ` (app url taken from your visual gate: ${visualUrl})` : ''}`);
  }

  // --- starter tests ---------------------------------------------------
  const testsDir = path.join(targetDir, 'tests', 'e2e');
  const starter = path.join(testsDir, 'critical-workflow.e2e.ts');
  if (fs.existsSync(starter) && !flags.force) {
    warn('tests/e2e/critical-workflow.e2e.ts already exists — left alone.');
  } else {
    const template = resolveTemplateFile(targetDir, 'templates', 'e2e-starter.e2e.ts');
    if (template) {
      ensureDir(testsDir);
      fs.writeFileSync(starter, template, 'utf8');
      success('Wrote tests/e2e/critical-workflow.e2e.ts');
    } else {
      warn('Could not find the starter-test template; wrote no tests.');
    }
  }

  // --- register with yuva, WITHOUT turning the gate on -----------------
  const configFile = P.configPath(targetDir, 'config.json');
  const yuvaConfig = readJSON(P.configFile(targetDir)) || {};
  if (!yuvaConfig.e2e) {
    yuvaConfig.e2e = { gate: false, failOnFlaky: false };
    ensureDir(path.dirname(configFile));
    writeJSON(configFile, yuvaConfig);
    success('Registered an "e2e" block in .yuva/config.json (gate OFF).');
  }

  log('');
  // The config does not load at all without the provider package, so this is a
  // blocker rather than a nice-to-have, and it goes first.
  if (choice.pkg) {
    warn(`REQUIRED before anything runs:  npm install -D ${choice.pkg}`);
    info('Without it, e2e exits 2 with CONFIG_LOAD_FAILED — the config imports it.');
    log('');
  }
  if (choice.setup) {
    warn(`REQUIRED before anything runs:  ${choice.setup}`);
    if (choice.kind === 'subscription-login-needed') {
      info(`Signs in once and stores the login in ${a.credentialsPath}.`);
      info('No API key, and nothing billed per token.');
      info(`See what the plan serves with:  npx e2e models ${choice.provider.id}`);
    }
    log('');
  }
  info('Next:');
  log('  1. Replace the starter goals with your own, from docs/product-brief.md P3');
  log('     and the keyboard contracts in docs/components/*.md C7.');
  log('  2. Start your app, then:  yuva e2e');
  log('  3. The first run calls a model and records the steps. Later runs replay');
  log('     them for free until the app changes.');
  log('  4. To enforce it: set { "e2e": { "gate": true } } in .yuva/config.json.\n');
}

/* ------------------------------------------------------------------ */

function passthrough(targetDir: string, args: string[], label: string) {
  const install = runner.detectInstall(targetDir);
  if (!install.installed) {
    error('e2e is not installed in this project. Run: npm install -D e2e');
    process.exitCode = 1;
    return;
  }
  // Non-null: `installed` is Boolean(cli), checked just above.
  const cli = install.cli!;
  try {
    const out = execFileSync(cli.command, [...cli.prefixArgs, ...args], {
      cwd: targetDir, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      shell: cli.needsShell === true,
    });
    log(out.trimEnd());
  } catch (caught) {
    const err = caught as { stdout?: string; stderr?: string; code?: string; status?: number; message?: string };
    const out = String(err.stdout || '').trimEnd();
    if (out) log(out);
    const stderr = String(err.stderr || '').trim();
    if (stderr) {
      error(stderr.slice(-2000));
    } else if (!out) {
      // Both streams empty means the process never really started.
      error(`Could not run e2e: ${err.code || err.message}`);
    }
    process.exitCode = typeof err.status === 'number' ? err.status : 1;
    debug('e2e-command', `${label} failed`, err);
  }
}

/* ------------------------------------------------------------------ */

function runCommand(args: string[], targetDir: string) {
  const { positional, flags } = parseFlags(args, {
    booleans: ['headed', 'last-failed', 'lastFailed', 'gate'],
  });

  const status = runner.detectInstall(targetDir);
  if (!status.installed || !status.configFile) {
    statusCommand(targetDir);
    info('Run `yuva e2e init` to set this up.');
    process.exitCode = 1;
    return;
  }

  box('Yuva AI - Running behaviour tests');
  info('Agent steps replay from cache; a model is called only where the app changed.');
  log('');

  const started = Date.now();
  const result = runner.runE2E(targetDir, {
    files: positional,
    headed: flags.headed === true,
    lastFailed: flags['last-failed'] === true || flags.lastFailed === true,
  });

  // --- what happened --------------------------------------------------
  if (result.run) {
    const r = result.run;
    table(['Result', 'Count'], [
      ['passed', String(r.passed)],
      ['failed', String(r.failed)],
      ['flaky', String(r.flaky)],
      ['skipped', String(r.skipped)],
      ['executed', `${r.executed} of ${r.discovered} discovered`],
    ]);
    log('');
    if (r.estimatedCostUsd !== null || r.modelTokens) {
      const cached = r.cachedTokens ? ` (${r.cachedTokens.toLocaleString()} served from cache)` : '';
      info(`Model usage: ${r.modelTokens.toLocaleString()} tokens${cached}` +
        (r.estimatedCostUsd !== null ? ` — about $${r.estimatedCostUsd.toFixed(4)}` : ''));
      recordCost(targetDir, r, Date.now() - started);
      log('');
    }
  }

  log(result.output || runner.formatFindings(result.findings));
  log('');

  if (result.status === 'passed') {
    success('Behaviour suite passed.');
  } else {
    error('Behaviour suite FAILED.');
    // Only fail the process when asked, so an exploratory local run does not
    // break a shell pipeline the developer did not intend to gate.
    if (flags.gate === true || runner.isGateEnabled(targetDir)) process.exitCode = 1;
  }
  log('');
  return result;
}

/** Record the run's REAL spend, rather than a character estimate of it. */
function recordCost(targetDir: string, run: NonNullable<ReturnType<typeof describeRun>>, durationMs: number) {
  try {
    const tracker = new CostTracker(P.runPath(targetDir));
    tracker.recordCall({
      cli: 'e2e',
      task: 'behaviour suite',
      inputTokens: run.modelTokens || 0,
      outputTokens: 0,
      costUsd: run.estimatedCostUsd === null ? undefined : run.estimatedCostUsd,
      durationMs,
      success: run.failed === 0,
    });
  } catch (err) {
    debug('e2e-command', 'could not record cost', err);
  }
}

/* ------------------------------------------------------------------ */

function e2eCommand(args: string[] = []) {
  const targetDir = process.cwd();
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    case 'help': case '--help': case '-h':
      return showHelp();
    case 'init':
      return initCommand(rest, targetDir);
    case 'status':
      return statusCommand(targetDir);
    case 'login': case 'logout':
      // Straight through: an interactive browser or device-code flow, which
      // wrapping would only get in the way of.
      return passthrough(targetDir, [sub, ...rest], sub);
    case 'models':
      return passthrough(targetDir, ['models', ...rest], 'models');
    case 'list':
      return passthrough(targetDir, ['list', ...rest], 'list');
    case 'cache':
      return passthrough(targetDir, ['cache', ...(rest.length ? rest : ['stats'])], 'cache');
    case 'run':
      return runCommand(rest, targetDir);
    default:
      // Bare `yuva e2e`, or `yuva e2e some/test.e2e.ts`
      return runCommand(args, targetDir);
  }
}

export = e2eCommand;