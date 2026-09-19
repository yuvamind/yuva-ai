const { log, box, success, error, warn, info, table, colorize } = require('../colors');
const { TaskBus } = require('../task-bus');
const { detectGates } = require('../gate-runner');
const { verifyDoneTasks } = require('../loop-engine');
const { ROLES } = require('../work-package');
const { parseFlags } = require('../arg-utils');
const { readJSON } = require('../fs-utils');
const { NeuralGraph } = require('../neural-graph');
const { CostTracker } = require('../cost-tracker');
const P = require('../paths');

// Map configured tool → the CLI command that starts it in a terminal
const TOOL_CLI = {
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex',
  opencode: 'opencode',
  antigravity: 'agy',
  aider: 'aider',
};

function showSwarmHelp() {
  box('Yuva AI - Swarm Orchestrator');
  log('Multi-terminal orchestrator/worker mode. One orchestrator terminal', 'dim');
  log('coordinates tasks; each worker terminal runs one role.\n', 'dim');
  log('Orchestrator terminal:', 'bright');
  log('  swarm init            Create the task bus (.yuva/)');
  log('  swarm plan "goal"     Print the planning brief (break goal into tasks)');
  log('  swarm spawn           AUTO-OPEN worker terminals in this project dir');
  log('                        (--roles executor,tester --cli claude --headless)');
  log('  swarm start           Live dashboard: workers, tasks, auto-verification');
  log('  swarm status          One-shot status snapshot');
  log('  swarm unstick [id]    Release stuck claims (--all forces every claim)');
  log('  swarm verify          Manually gate-check completed tasks');
  log('  swarm clear           Delete the bus and all tasks\n');
  log('Worker terminals:', 'bright');
  log('  yuva worker next --role executor           (interactive AI terminal)');
  log('  yuva worker start --role tester --auto --cli "claude -p"   (headless)\n');
  log('Flow:', 'bright');
  log('  1. Terminal 1: yuva swarm init && yuva swarm plan "build feature X"');
  log('  2. Add tasks:  yuva task add "..." --role executor');
  log('  3. Terminal 2+: yuva worker next --role executor (or --auto)');
  log('  4. Terminal 1: yuva swarm start  → watches, verifies, enforces gates\n');
}

function swarmInit(bus, targetDir) {
  bus.init();
  bus.clearStop();
  // Runtime state only — .yuva/ config itself is meant to be committed.
  P.ensureGitignore(targetDir);
  success('Swarm bus created at .yuva/run/');
  info('Next: yuva swarm plan "your goal"  — then add tasks and open worker terminals.');
}

function swarmPlan(bus, goal) {
  if (!goal) {
    error('Goal required. Usage: yuva swarm plan "build user authentication"');
    return;
  }
  bus.init();
  bus.logEvent('swarm.plan', { goal });

  const roleList = Object.entries(ROLES).map(([n, r]) => `- **${n}** — ${r.description}`).join('\n');
  const gates = detectGates(process.cwd());
  const gateList = gates.length
    ? gates.map(g => `- ${g.name}: \`${g.command}\``).join('\n')
    : '- none detected (configure "gates" in .yuva/config.json)';

  process.stdout.write(`# Swarm Orchestrator Brief

## Goal
${goal}

## Your job (this terminal is the ORCHESTRATOR)
1. Run \`yuva agent show planning\` and follow it to break the goal into small,
   independently verifiable tasks.
2. Add each task to the bus, in dependency order:
   \`\`\`bash
   yuva task add "task title" --role executor --desc "details" [--deps <id>,<id>]
   \`\`\`
   Available roles:
${roleList}
3. Sequence quality in: for each meaningful feature, add a tester task and a
   reviewer task that depend on the executor task's id.
4. Open the worker terminals AUTOMATICALLY (all in this same project dir):
   \`\`\`bash
   yuva swarm spawn --roles executor,tester,reviewer
   \`\`\`
   (add \`--cli claude\` or another AI CLI to auto-boot the AI in each window;
   add \`--headless\` for unattended workers)
5. Then run \`yuva swarm start\` here to watch progress and auto-verify results.

## Quality gates for this project (enforced on every "yuva task done")
${gateList}

## Rules
- No task is finished until its gates pass — the CLI enforces this.
- Rejected tasks return to pending with feedback; workers must address it.
- Keep tasks small: one file/feature per task beats one giant task.
`);
}

function renderDashboard(bus, { verifications = [], summary = null } = {}) {
  // Callers that already polled the bus this tick pass their summary in
  // rather than making us re-read every task file off disk.
  summary = summary || bus.getStatusSummary();
  const now = Date.now();

  // Redraw-in-place only works on a terminal. When stdout is piped or
  // captured, the clear-screen escape is a no-op and every tick would append
  // another full frame — so the caller must use appendProgress() instead.
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }
  box('Yuva AI - Swarm Orchestrator');

  const c = summary.counts;
  log(`  Tasks: ${summary.total} total — ` +
    colorize(`${c.pending} pending`, 'yellow') + ', ' +
    colorize(`${c.claimed} claimed`, 'cyan') + ', ' +
    colorize(`${c.done} awaiting verify`, 'magenta') + ', ' +
    colorize(`${c.verified} verified`, 'green') + ', ' +
    colorize(`${c.failed} failed`, 'red') + '\n');

  if (summary.workers.length > 0) {
    log('Workers:', 'bright');
    table(
      ['ID', 'Role', 'Mode', 'Status', 'Task', 'Last seen'],
      summary.workers.map(w => [
        w.id,
        w.role || 'any',
        w.mode,
        w.status,
        w.currentTask || '-',
        `${Math.round((now - Date.parse(w.lastSeenAt)) / 1000)}s ago`,
      ])
    );
    log('');
  } else {
    warn('No workers connected. Open terminals with: yuva worker next --role <role>');
    log('');
  }

  if (summary.tasks.length > 0) {
    log('Tasks:', 'bright');
    table(
      ['ID', 'Status', 'Role', 'Title', 'Worker', 'Att'],
      summary.tasks.map(t => [t.id, t.status, t.role, t.title.slice(0, 38), t.claimedBy || '-', t.attempts])
    );
    log('');
  }

  // Graph and cost are read-only extras; both are cached per tick interval so
  // a 3-second dashboard does not re-read the whole graph from disk forever.
  const extras = readExtras(process.cwd());
  if (extras.graph) log(extras.graph, 'dim');
  if (extras.cost) log(extras.cost, 'dim');

  for (const v of verifications) {
    if (v.passed) success(v.message);
    else error(v.message);
  }
  if (verifications.length) log('');
}

const EXTRAS_TTL_MS = 15 * 1000;
let extrasCache = { at: 0, value: { graph: null, cost: null } };

/** Graph/cost summary lines, re-read from disk at most every EXTRAS_TTL_MS. */
function readExtras(targetDir, now = Date.now()) {
  if (now - extrasCache.at < EXTRAS_TTL_MS) return extrasCache.value;

  const value = { graph: null, cost: null };
  try {
    const graph = new NeuralGraph(targetDir);
    if (graph.load()) {
      const stats = graph.getStats();
      value.graph = `Neural Graph: ${stats.totalNodes} nodes, ${stats.totalEdges} edges`;
    }
  } catch { /* graph not available — display-only, non-critical */ }

  try {
    const costSummary = new CostTracker(P.runDir(targetDir)).getSummary();
    if (costSummary.totalCalls > 0) {
      value.cost = `Cost: ${costSummary.totalCalls} calls, $${costSummary.totalEstimatedCost}`;
    }
  } catch { /* cost tracker not available — display-only, non-critical */ }

  extrasCache = { at: now, value };
  return value;
}

/**
 * Fingerprint of everything the dashboard actually displays. Deliberately
 * excludes relative timestamps ("2240s ago"), which change every tick by
 * definition and would make every frame look like a change.
 */
function stateFingerprint(summary) {
  return JSON.stringify([
    summary.counts,
    summary.tasks.map(t => [t.id, t.status, t.claimedBy, t.attempts]),
    summary.workers.map(w => [w.id, w.status, w.currentTask]),
  ]);
}

/** One-line progress note for non-TTY output, where redraw is impossible. */
function appendProgress(summary) {
  const c = summary.counts;
  const workers = summary.workers.filter(w => w.status !== 'offline').length;
  log(`[${new Date().toISOString()}] ${c.pending} pending, ${c.claimed} claimed, ` +
    `${c.done} awaiting verify, ${c.verified} verified, ${c.failed} failed — ${workers} active worker(s)`);
}

function swarmStart(bus, flags) {
  if (!bus.exists()) {
    warn('No swarm bus found. Run: yuva swarm init');
    return;
  }

  const intervalMs = (Number(flags.interval) || 3) * 1000;
  const isTTY = Boolean(process.stdout.isTTY);
  info('Orchestrator running — Ctrl+C to stop.');
  if (!isTTY) {
    info('Output is not a terminal — logging state changes instead of redrawing.');
  }

  let lastVerifications = [];
  let lastFingerprint = null;

  const tick = () => {
    const released = bus.releaseStale();
    for (const task of released) {
      warn(`Reclaimed [${task.id}] ${task.title} — its worker stopped responding.`);
    }

    // Gates are expensive (they run lint/test), so only pay for them when
    // there is actually something awaiting verification.
    const verifications = bus.getStatusSummary().counts.done > 0
      ? verifyDoneTasks(bus, process.cwd())
      : [];
    if (verifications.length) lastVerifications = verifications;

    const summary = bus.getStatusSummary();
    const fingerprint = stateFingerprint(summary);
    const changed = fingerprint !== lastFingerprint;

    if (isTTY) {
      // Redraw only on change — an unchanged frame is identical output.
      if (changed || released.length || verifications.length) {
        renderDashboard(bus, { verifications: lastVerifications, summary });
      }
    } else if (changed || released.length || verifications.length) {
      appendProgress(summary);
      for (const v of verifications) {
        if (v.passed) success(v.message);
        else error(v.message);
      }
    }
    lastFingerprint = fingerprint;

    const active = summary.counts.pending + summary.counts.claimed + summary.counts.done;
    if (summary.total > 0 && active === 0) {
      if (!isTTY) appendProgress(summary);
      success('All tasks verified — swarm goal complete! 🎉');
      clearInterval(timer);
    }
  };

  const timer = setInterval(tick, intervalMs);
  process.on('SIGINT', () => {
    clearInterval(timer);
    log('\nOrchestrator stopped. Bus state preserved in .yuva/run/', 'yellow');
    process.exit(0);
  });
  tick();
}

/**
 * Free stuck claims by hand. `unstick <id>` releases one task; with no id it
 * releases every claim whose lease has expired or whose worker is gone, and
 * `--all` releases every claimed task outright.
 *
 * The lease sweep in `swarm start` does this automatically, but a blocked
 * dependency chain is painful enough to deserve a direct escape hatch.
 */
function swarmUnstick(bus, taskId, flags) {
  if (taskId) {
    const task = bus.getTask(taskId);
    if (!task) {
      error(`No task with id ${taskId}.`);
      return;
    }
    if (task.status !== 'claimed') {
      info(`Task ${taskId} is "${task.status}", not claimed — nothing to release.`);
      return;
    }
    bus.releaseTask(taskId, 'manually unstuck');
    success(`Released [${taskId}] ${task.title} — back to pending.`);
    return;
  }

  const released = flags.all
    ? bus.listTasks({ status: 'claimed' }).map(t => bus.releaseTask(t.id, 'manually unstuck (--all)')).filter(Boolean)
    : bus.releaseStale();

  if (released.length === 0) {
    const claimed = bus.listTasks({ status: 'claimed' });
    if (claimed.length === 0) {
      info('No claimed tasks — nothing to unstick.');
    } else {
      info(`${claimed.length} claimed task(s), all within their lease:`);
      for (const t of claimed) {
        const heldMin = Math.round((Date.now() - Date.parse(t.leaseRenewedAt || t.claimedAt)) / 60000);
        log(`  [${t.id}] ${t.title.slice(0, 40)} — held ${heldMin}m by ${t.claimedBy}`);
      }
      info('Force-release them with: yuva swarm unstick --all');
    }
    return;
  }

  for (const task of released) {
    success(`Released [${task.id}] ${task.title}`);
  }
  success(`${released.length} task(s) returned to pending.`);
}

/**
 * Open worker terminals automatically — every window starts in THIS project
 * directory, so all workers share one codebase and one .yuva/ bus.
 */
async function swarmSpawn(bus, flags, targetDir) {
  bus.init();

  const roles = String(flags.roles || 'executor,tester,reviewer')
    .split(',').map(r => r.trim()).filter(Boolean);
  for (const role of roles) {
    if (!ROLES[role]) {
      error(`Unknown role: ${role}. Valid roles: ${Object.keys(ROLES).join(', ')}`);
      return;
    }
  }

  // Resolve which AI CLI to boot in each terminal:
  // --cli flag > configured tool > claude (default). Workers must never
  // sit idle in an empty terminal.
  let cli = flags.cli && flags.cli !== true ? String(flags.cli) : null;
  if (!cli) {
    const config = readJSON(P.configFile(targetDir));
    cli = (config && TOOL_CLI[config.tool]) || 'claude';
  }
  if (cli.includes('"')) {
    error('--cli must not contain double quotes.');
    return;
  }

  const { openTerminal, hasWindowsTerminal } = require('../terminal-spawn');
  box('Yuva AI - Spawning Worker Terminals');
  info(`AI CLI: ${cli}  (override with --cli <command>)`);
  if (hasWindowsTerminal()) {
    info('Using Windows Terminal — each worker opens as a tab.');
  }

  let opened = 0;
  const failed = [];
  for (const role of roles) {
    let command = `yuva worker boot --role ${role}`;
    if (cli) command += ` --cli ${cli}`;
    if (cli && flags.headless) command += ' --headless';

    // Await the real launch result — the spawn only reports failure
    // asynchronously, so a fire-and-forget call cannot tell whether a
    // window actually opened.
    const result = await openTerminal(command, { title: `yuva ${role}`, cwd: targetDir });
    if (result.ok) {
      success(`Opened ${role} worker terminal (in ${targetDir})`);
      opened++;
    } else {
      error(`Could not open a terminal for ${role}: ${result.reason || 'unknown error'}`);
      failed.push(command);
    }
  }

  if (failed.length) {
    log('');
    warn(`${failed.length} terminal(s) did not open. Run these manually, one per terminal:`);
    for (const command of failed) log(`  ${command}`);
  }

  if (opened > 0) {
    log('');
    info('All workers share THIS project directory and task bus.');
    info('Now run: yuva swarm start   (this terminal becomes the orchestrator)');
  }
}

async function swarmCommand(args = []) {
  const { positional, flags } = parseFlags(args, { booleans: ['headless', 'force', 'all'] });
  const bus = new TaskBus(process.cwd());
  const targetDir = process.cwd();
  const sub = positional[0];

  switch (sub) {
    case 'init':
      return swarmInit(bus, targetDir);
    case 'spawn':
      return swarmSpawn(bus, flags, targetDir);
    case 'plan':
      return swarmPlan(bus, positional.slice(1).join(' '));
    case 'start':
      return swarmStart(bus, flags);
    case 'status': {
      if (!bus.exists()) {
        warn('No swarm bus found. Run: yuva swarm init');
        return;
      }
      bus.releaseStale();
      return renderDashboard(bus);
    }
    case 'unstick': {
      if (!bus.exists()) {
        warn('No swarm bus found. Run: yuva swarm init');
        return;
      }
      return swarmUnstick(bus, positional[1], flags);
    }
    case 'verify': {
      if (!bus.exists()) {
        warn('No swarm bus found. Run: yuva swarm init');
        return;
      }
      const messages = verifyDoneTasks(bus, targetDir);
      if (messages.length === 0) {
        info('No completed tasks awaiting verification.');
        return;
      }
      for (const m of messages) {
        if (m.passed) success(m.message);
        else error(m.message);
      }
      return;
    }
    case 'clear': {
      if (!flags.force) {
        warn('This deletes ALL tasks, workers, and swarm history in .yuva/.');
        info('If you are sure, re-run: yuva swarm clear --force');
        return;
      }
      bus.clear();
      success('Swarm bus cleared.');
      return;
    }
    default:
      showSwarmHelp();
  }
}

module.exports = swarmCommand;
module.exports.TOOL_CLI = TOOL_CLI;
module.exports.stateFingerprint = stateFingerprint;
module.exports.swarmUnstick = swarmUnstick;
