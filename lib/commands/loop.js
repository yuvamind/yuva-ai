const path = require('path');
const { log, box, success, error, warn, info } = require('../colors');
const { TaskBus } = require('../task-bus');
const { parseFlags } = require('../arg-utils');
const { readJSON } = require('../fs-utils');
const {
  LoopEngine, ensurePrintMode, DEFAULT_MAX_ITERATIONS, DEFAULT_MAX_ATTEMPTS,
} = require('../loop-engine');
const { CANDIDATE_CLIS, commandExists, preflight, resolveWorkingCli } = require('../ai-cli');
const { detectGates } = require('../gate-runner');
const { GraphBuilder } = require('../graph-builder');

function showLoopHelp() {
  box('Yuva AI - Loop Engine (autopilot)');
  log('Fully autonomous cycle: AI plans → workers build → gates verify →', 'dim');
  log('AI reviews & replans — repeating until the goal is achieved.\n', 'dim');
  log('Usage:', 'bright');
  log('  yuva loop run "goal"       Start the autonomous loop for a goal');
  log('  yuva loop doctor           Test which installed AI CLIs work headlessly');
  log('  yuva loop status           Show loop state and task counts');
  log('  yuva loop stop             Signal the loop and all workers to stop\n');
  log('Options for "loop run":', 'bright');
  log('  --cli <command>            AI CLI to use (default: configured tool or claude)');
  log('  --roles <r1,r2>            Worker roles to spawn (default: executor,tester,reviewer)');
  log(`  --max-iterations <n>       Plan→review cycles before giving up (default: ${DEFAULT_MAX_ITERATIONS})`);
  log(`  --max-attempts <n>         Retries per task before escalating (default: ${DEFAULT_MAX_ATTEMPTS})`);
  log('  --interval <sec>           Orchestrator poll interval (default: 5)');
  log('  --no-spawn                 Do not auto-open worker terminals\n');
  log('What happens:', 'bright');
  log('  0. PREFLIGHT Verifies the AI CLI answers headlessly; auto-falls back');
  log('               to any other installed CLI if the first one fails');
  log('  1. PLAN     Your goal is piped to the AI CLI, which returns a task list');
  log('  2. EXECUTE  Headless worker terminals are spawned and claim tasks');
  log('  3. VERIFY   Quality gates run on every completion; failures bounce back');
  log('  4. ESCALATE Tasks failing repeatedly become debugger tasks');
  log('  5. REVIEW   AI checks the repo: goal achieved? If not → new tasks, repeat');
  log('  6. REPORT   Final summary written to .yuva/report.md\n');
}

// The CLI the project is configured for (null when unset/unknown).
function configuredCli(targetDir) {
  const { TOOL_CLI } = require('./swarm');
  const config = readJSON(path.join(targetDir, '.aiautomations', 'config.json'));
  return (config && TOOL_CLI[config.tool]) || null;
}

const EVENT_PRINTERS = { success, error, warn, info };
const printEvent = (level, message) => (EVENT_PRINTERS[level] || info)(message);

/**
 * PREFLIGHT: prove an AI CLI answers headlessly before betting the loop on it.
 * A forced --cli is tested strictly (no silent switching); otherwise the
 * configured tool is tried first, then every other installed candidate.
 * Returns the working CLI command, or null after printing diagnostics.
 */
async function preflightCli(flags, targetDir) {
  if (flags.cli && flags.cli !== true) {
    const cli = String(flags.cli);
    info(`PREFLIGHT — testing "${cli}" headlessly...`);
    const result = await preflight(cli, { cwd: targetDir });
    if (result.ok) {
      success(`AI CLI ready: ${cli}`);
      return cli;
    }
    error(`--cli "${cli}" failed preflight: ${result.reason}`);
    if (result.hint) info(result.hint);
    info('Not switching CLIs because --cli was set explicitly. See what works with: yuva loop doctor');
    return null;
  }

  info('PREFLIGHT — finding a working headless AI CLI...');
  const { cli, tried } = await resolveWorkingCli({
    configured: configuredCli(targetDir),
    cwd: targetDir,
    onEvent: printEvent,
  });
  if (cli) {
    success(`AI CLI ready: ${cli}`);
    return cli;
  }
  error('No working headless AI CLI found.');
  for (const t of tried) {
    log(`  ${t.cli.padEnd(10)} ${t.reason}${t.hint ? ` — ${t.hint}` : ''}`, 'dim');
  }
  info('Fix one of the above (usually: open it once and log in), then retry.');
  return null;
}

async function loopRun(bus, flags, goal, targetDir) {
  if (!goal) {
    error('Goal required. Usage: yuva loop run "build user authentication"');
    return;
  }

  if (flags.cli && flags.cli !== true && String(flags.cli).includes('"')) {
    error('--cli must not contain double quotes.');
    return;
  }

  // Phase 0: PREFLIGHT — never bet the loop on an AI CLI that can't answer
  const cli = await preflightCli(flags, targetDir);
  if (!cli) return;
  log('');

  const roles = String(flags.roles || 'executor,tester,reviewer');
  const maxIterations = Number(flags['max-iterations']) || DEFAULT_MAX_ITERATIONS;
  const maxAttempts = Number(flags['max-attempts']) || DEFAULT_MAX_ATTEMPTS;
  const intervalMs = (Number(flags.interval) || 5) * 1000;

  bus.init();
  bus.clearStop();

  const engine = new LoopEngine(bus, targetDir, {
    cli: ensurePrintMode(cli),
    maxIterations,
    maxAttempts,
    intervalMs,
  });

  box('Yuva AI - Loop Engine (autopilot)');
  info(`Goal:           ${goal}`);
  info(`AI CLI:         ${engine.options.cli}`);
  info(`Worker roles:   ${roles}`);
  info(`Max iterations: ${maxIterations}   Max attempts/task: ${maxAttempts}`);
  log('');

  process.on('SIGINT', () => {
    log('\nLoop orchestrator interrupted. Workers keep running.', 'yellow');
    info('Stop everything with:  yuva loop stop');
    info('Resume watching with:  yuva loop run (state is in .yuva/loop.json)');
    process.exit(0);
  });

  // Phase 0.5: Build neural graph for context
  try {
    info('Building neural graph for context...');
    const builder = new GraphBuilder(targetDir);
    const graphResult = builder.build();
    success(`Graph: ${graphResult.stats.totalNodes} nodes, ${graphResult.stats.totalEdges} edges`);
  } catch {}

  // Phase 1: PLAN — the AI turns the goal into bus tasks
  info('PLAN — asking the AI to break the goal into tasks (this can take a few minutes)...');
  const planned = await engine.plan(goal);
  if (planned.length === 0) {
    error('Planning produced no tasks — the AI answered preflight but returned no usable plan (one retry included).');
    info('Diagnose with "yuva loop doctor", or add tasks manually with "yuva task add" and run "yuva swarm start".');
    return;
  }
  success(`Planned ${planned.length} task(s):`);
  for (const t of planned) log(`  [${t.id}] (${t.role}) ${t.title}`, 'dim');
  log('');

  // Phase 2: EXECUTE — spawn headless worker terminals on the shared bus
  if (!flags['no-spawn']) {
    const swarmCommand = require('./swarm');
    swarmCommand(['spawn', '--roles', roles, '--cli', cli, '--headless']);
    log('');
  } else {
    info('Worker spawn skipped (--no-spawn). Start workers yourself, e.g.:');
    info(`  yuva worker start --role executor --auto --cli "${ensurePrintMode(cli)}"`);
    log('');
  }

  // Phases 3-5: VERIFY / ESCALATE / REVIEW — the engine loops until done
  info('Loop running — Ctrl+C detaches (workers continue), "yuva loop stop" halts everything.\n');
  const result = await engine.run(goal, {
    onEvent: (level, message) => (EVENT_PRINTERS[level] || info)(message),
  });

  // Phase 6: REPORT — shut workers down and leave a summary behind
  bus.requestStop(result.done ? 'loop complete' : `loop stopped: ${result.reason}`);
  const reportFile = engine.writeReport(goal, result);
  log('');
  if (result.done) {
    success(`GOAL ACHIEVED after ${result.iterations} iteration(s) — ${result.reason}`);
  } else {
    warn(`Loop stopped after ${result.iterations} iteration(s) — ${result.reason}`);
  }
  info(`Report: ${path.relative(targetDir, reportFile)}`);
  info('Workers were signalled to stop and will exit at their next poll.');
}

function loopStatus(bus) {
  if (!bus.exists()) {
    warn('No swarm bus found. Start a loop with: yuva loop run "your goal"');
    return;
  }
  const engine = new LoopEngine(bus, process.cwd());
  const state = engine.loadState();
  box('Yuva AI - Loop Status');
  if (!state) {
    info('No loop has been started on this bus. Run: yuva loop run "your goal"');
    return;
  }
  log(`  Goal:       ${state.goal || '-'}`);
  log(`  Status:     ${state.status || '-'}${bus.stopRequested() ? ' (stop requested)' : ''}`);
  log(`  Iteration:  ${state.iteration || '-'}`);
  log(`  Started:    ${state.startedAt || '-'}`);
  log(`  Updated:    ${state.updatedAt || '-'}`);
  const c = bus.getStatusSummary().counts;
  log(`  Tasks:      ${c.pending} pending, ${c.claimed} in progress, ${c.done} awaiting verify, ${c.verified} verified, ${c.failed} failed`);
  if (state.result) log(`  Result:     ${state.result.done ? 'goal achieved' : 'stopped'} — ${state.result.reason}`);
  log('');
}

/**
 * Test every candidate AI CLI headlessly and report what the loop would use.
 */
async function loopDoctor(targetDir) {
  box('Yuva AI - Loop Doctor');
  const configured = configuredCli(targetDir);
  const candidates = [...new Set([configured, ...CANDIDATE_CLIS].filter(Boolean))];
  info(`Configured tool CLI: ${configured || '(none — will fall back automatically)'}`);
  log('');

  let firstWorking = null;
  for (const cli of candidates) {
    if (!commandExists(cli)) {
      log(`  ✗ ${cli.padEnd(10)} not installed`, 'dim');
      continue;
    }
    info(`  testing ${cli} headlessly (can take a minute)...`);
    const result = await preflight(cli, { cwd: targetDir });
    if (result.ok) {
      success(`  ${cli.padEnd(10)} works headlessly`);
      if (!firstWorking) firstWorking = cli;
    } else {
      error(`  ${cli.padEnd(10)} ${result.reason} — ${result.hint || ''}`);
    }
  }

  log('');
  const gates = detectGates(targetDir);
  info(`Quality gates detected: ${gates.length ? gates.map(g => g.name).join(', ') : 'none'}`);
  if (firstWorking) {
    success(`Loop would use: ${firstWorking}`);
    info('Note: workers edit files headlessly — make sure the CLI has the needed');
    info(`permissions pre-approved (e.g. --cli "${firstWorking} --permission-mode acceptEdits" for Claude Code).`);
  } else {
    warn('No working headless AI CLI found. Install one and log in, then re-run.');
  }
}

function loopStop(bus) {
  if (!bus.exists()) {
    warn('No swarm bus found — nothing to stop.');
    return;
  }
  bus.requestStop('manual stop via yuva loop stop');
  success('Stop signal written to .yuva/stop.');
  info('Headless workers exit at their next poll; "yuva worker next" stops handing out tasks.');
  info('Restarting the loop clears the signal automatically.');
}

function loopCommand(args = []) {
  const { positional, flags } = parseFlags(args, { booleans: ['no-spawn'] });
  const bus = new TaskBus(process.cwd());
  const sub = positional[0];

  switch (sub) {
    case 'run':
      return loopRun(bus, flags, positional.slice(1).join(' '), process.cwd());
    case 'status':
      return loopStatus(bus);
    case 'doctor':
      return loopDoctor(process.cwd());
    case 'stop':
      return loopStop(bus);
    case undefined:
    case 'help':
      return showLoopHelp();
    default:
      // Shorthand: yuva loop "goal"
      return loopRun(bus, flags, positional.join(' '), process.cwd());
  }
}

module.exports = loopCommand;
