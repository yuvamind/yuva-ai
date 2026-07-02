const { spawn } = require('child_process');
const { log, box, success, error, warn, info } = require('../colors');
const { TaskBus } = require('../task-bus');
const { runGates } = require('../gate-runner');
const { buildWorkPackage, ROLES } = require('../work-package');
const { parseFlags } = require('../arg-utils');

const HEARTBEAT_MS = 30 * 1000;

function showWorkerHelp() {
  box('Yuva AI - Swarm Worker');
  log('Run one of these in each worker terminal:\n', 'bright');
  log('  yuva worker next --role <role>');
  log('      Claim ONE task and print its full work package.');
  log('      For interactive AI terminals (Claude Code, Cursor, etc.) —');
  log('      the AI runs this, does the work, then runs "yuva task done <id>".\n');
  log('  yuva worker start --role <role> --auto --cli "claude -p"');
  log('      Headless loop: claims tasks and pipes each work package into');
  log('      the given LLM CLI via stdin. Gates run after each task.\n');
  log('Options:', 'bright');
  log('  --role <name>     executor | tester | reviewer | security | debugger');
  log('  --cli "<cmd>"     LLM CLI command (work package is piped to stdin)');
  log('  --once            Process a single task then exit (with --auto)');
  log('  --interval <sec>  Poll interval in auto mode (default 5)\n');
  log('Roles:', 'bright');
  for (const [name, role] of Object.entries(ROLES)) {
    log(`  ${name.padEnd(10)} ${role.description}`);
  }
  log('');
}

function validateRole(role) {
  if (role && !ROLES[role]) {
    error(`Unknown role: ${role}. Valid roles: ${Object.keys(ROLES).join(', ')}`);
    return false;
  }
  return true;
}

/** Claim one task and print its work package — for interactive AI terminals. */
function workerNext(bus, flags) {
  const role = flags.role || null;
  if (!validateRole(role)) return;

  if (!bus.exists()) {
    warn('No swarm bus found. Start one from the orchestrator terminal: yuva swarm init');
    return;
  }

  const worker = bus.registerWorker({ role, mode: 'interactive' });
  const task = bus.claimTask(worker.id, role);

  if (!task) {
    bus.removeWorker(worker.id);
    info(`No claimable ${role ? `"${role}" ` : ''}tasks right now. Re-run "yuva worker next" later.`);
    return;
  }

  process.stdout.write(buildWorkPackage(task, process.cwd()));
}

function runCli(cliCommand, workPackage) {
  return new Promise((resolve) => {
    const child = spawn(cliCommand, {
      shell: true,
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.on('error', (err) => resolve({ code: 1, error: err.message }));
    child.on('close', (code) => resolve({ code }));
    child.stdin.write(workPackage);
    child.stdin.end();
  });
}

/** Headless loop: claim → pipe work package into LLM CLI → gate → repeat. */
async function workerStart(bus, flags) {
  const role = flags.role || null;
  if (!validateRole(role)) return;

  if (!flags.auto) {
    info('Interactive terminals should use "yuva worker next" instead.');
    info('For a headless worker, add: --auto --cli "claude -p"');
    return;
  }

  const cliCommand = flags.cli;
  if (!cliCommand || cliCommand === true) {
    error('Auto mode needs an LLM CLI. Example: yuva worker start --role executor --auto --cli "claude -p"');
    return;
  }

  bus.init();
  const worker = bus.registerWorker({ role, mode: 'auto' });
  const pollMs = (Number(flags.interval) || 5) * 1000;

  box(`Yuva AI - Worker ${worker.id} (${role || 'any role'}, auto)`);
  info(`CLI: ${cliCommand}`);
  info('Waiting for tasks... (Ctrl+C to stop)\n');

  let running = true;
  process.on('SIGINT', () => {
    running = false;
    bus.heartbeat(worker.id, { status: 'offline' });
    log('\nWorker stopped.', 'yellow');
    process.exit(0);
  });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  while (running) {
    bus.heartbeat(worker.id, { status: 'idle' });
    const task = bus.claimTask(worker.id, role);

    if (!task) {
      await sleep(pollMs);
      continue;
    }

    log(`\n▶ Claimed task [${task.id}] ${task.title}`, 'cyan');
    bus.heartbeat(worker.id, { status: 'busy', currentTask: task.id });

    // Keep heartbeating while the LLM CLI runs so the orchestrator
    // doesn't release our task mid-flight.
    const beat = setInterval(() => bus.heartbeat(worker.id, { status: 'busy', currentTask: task.id }), HEARTBEAT_MS);
    const result = await runCli(cliCommand, buildWorkPackage(task, process.cwd()));
    clearInterval(beat);

    if (result.error) {
      error(`CLI failed to start: ${result.error}`);
      bus.rejectTask(task.id, `worker CLI failed to start: ${result.error}`);
      bus.heartbeat(worker.id, { status: 'idle', currentTask: null });
      if (flags.once) break;
      continue;
    }

    // The AI should have run "yuva task done" itself. If the task is still
    // claimed, decide from the gates: pass → done, fail → back to pending
    // with the gate output as feedback for the next attempt.
    const after = bus.getTask(task.id);
    if (after && after.status === 'claimed') {
      info('CLI exited without completing the task — running gates to decide...');
      const gateResult = runGates(process.cwd());
      if (gateResult.passed) {
        bus.completeTask(task.id, {
          summary: 'auto worker: CLI finished, gates passed',
          gate: { passed: true, at: new Date().toISOString() },
        });
        success(`Task ${task.id} completed (gates passed).`);
      } else {
        const failures = gateResult.gates.filter(g => g.status === 'failed')
          .map(g => `${g.name}: ${g.output || 'failed'}`).join('\n---\n');
        bus.rejectTask(task.id, `quality gates failed:\n${failures}`.slice(0, 3000));
        warn(`Task ${task.id} returned to pending — gates failed.`);
      }
    } else if (after) {
      success(`Task ${task.id} → ${after.status}`);
    }

    bus.heartbeat(worker.id, { status: 'idle', currentTask: null });
    if (flags.once) break;
  }

  bus.heartbeat(worker.id, { status: 'offline' });
}

function workerCommand(args = []) {
  const { positional, flags } = parseFlags(args, { booleans: ['auto', 'once'] });
  const bus = new TaskBus(process.cwd());
  const sub = positional[0];

  switch (sub) {
    case 'next':
      return workerNext(bus, flags);
    case 'start':
      return workerStart(bus, flags);
    default:
      showWorkerHelp();
  }
}

module.exports = workerCommand;
