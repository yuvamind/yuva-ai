const fs = require('fs');
const path = require('path');
const { log, box, success, error, warn, info, table, colorize } = require('../colors');
const { TaskBus } = require('../task-bus');
const { runGates, detectGates } = require('../gate-runner');
const { ROLES } = require('../work-package');
const { parseFlags } = require('../arg-utils');
const { readJSON } = require('../fs-utils');

// Map configured tool → the CLI command that starts it in a terminal
const TOOL_CLI = {
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex',
  opencode: 'opencode',
  antigravity: 'agy',
  aider: 'aider',
};

const GITIGNORE_ENTRY = '\n# Yuva AI swarm bus (runtime state)\n.yuva/\n';

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
  const gitignorePath = path.join(targetDir, '.gitignore');
  try {
    const content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
    if (!content.includes('.yuva/')) {
      fs.writeFileSync(gitignorePath, content + GITIGNORE_ENTRY);
    }
  } catch {}
  success('Swarm bus created at .yuva/');
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
    : '- none detected (configure "gates" in .aiautomations/config.json)';

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

function renderDashboard(bus, { verifications = [] } = {}) {
  const summary = bus.getStatusSummary();
  const now = Date.now();

  process.stdout.write('\x1b[2J\x1b[H'); // clear screen
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

  for (const v of verifications) {
    if (v.passed) success(v.message);
    else error(v.message);
  }
  if (verifications.length) log('');
}

/**
 * Verify tasks in 'done' state. Gates are project-wide, so one gate run
 * covers the current tree: pass → all done tasks become verified; fail →
 * the most recently completed task (likely culprit) is rejected with the
 * gate output as feedback, the rest stay queued for the next pass.
 */
function verifyDoneTasks(bus, targetDir) {
  const done = bus.listTasks({ status: 'done' });
  if (done.length === 0) return [];

  const result = runGates(targetDir);
  const messages = [];

  if (result.passed) {
    for (const task of done) {
      bus.verifyTask(task.id, { gate: { passed: true, at: new Date().toISOString() } });
      messages.push({ passed: true, message: `verified [${task.id}] ${task.title}` });
    }
  } else {
    const failures = result.gates.filter(g => g.status === 'failed')
      .map(g => `${g.name} failed:\n${g.output || ''}`).join('\n---\n');
    done.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    const culprit = done[0];
    bus.rejectTask(culprit.id, `orchestrator verification failed:\n${failures}`.slice(0, 3000));
    messages.push({ passed: false, message: `rejected [${culprit.id}] ${culprit.title} — gates failing, sent back with feedback` });
  }

  return messages;
}

function swarmStart(bus, flags) {
  if (!bus.exists()) {
    warn('No swarm bus found. Run: yuva swarm init');
    return;
  }

  const intervalMs = (Number(flags.interval) || 3) * 1000;
  info('Orchestrator running — Ctrl+C to stop.');

  let lastVerifications = [];
  const tick = () => {
    bus.releaseStale();
    const verifications = verifyDoneTasks(bus, process.cwd());
    if (verifications.length) lastVerifications = verifications;
    renderDashboard(bus, { verifications: lastVerifications });

    const summary = bus.getStatusSummary();
    if (summary.total > 0 && summary.counts.verified === summary.total) {
      success('All tasks verified — swarm goal complete! 🎉');
      clearInterval(timer);
    }
  };

  const timer = setInterval(tick, intervalMs);
  process.on('SIGINT', () => {
    clearInterval(timer);
    log('\nOrchestrator stopped. Bus state preserved in .yuva/', 'yellow');
    process.exit(0);
  });
  tick();
}

/**
 * Open worker terminals automatically — every window starts in THIS project
 * directory, so all workers share one codebase and one .yuva/ bus.
 */
function swarmSpawn(bus, flags, targetDir) {
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
    const config = readJSON(path.join(targetDir, '.aiautomations', 'config.json'));
    cli = (config && TOOL_CLI[config.tool]) || 'claude';
  }
  if (cli.includes('"')) {
    error('--cli must not contain double quotes.');
    return;
  }

  const { openTerminal } = require('../terminal-spawn');
  box('Yuva AI - Spawning Worker Terminals');
  info(`AI CLI: ${cli}  (override with --cli <command>)`);

  let opened = 0;
  for (const role of roles) {
    let command = `yuva worker boot --role ${role}`;
    if (cli) command += ` --cli ${cli}`;
    if (cli && flags.headless) command += ' --headless';

    if (openTerminal(command, { title: `yuva ${role}`, cwd: targetDir })) {
      success(`Opened ${role} worker terminal (in ${targetDir})`);
      opened++;
    } else {
      error(`Could not open a terminal for ${role}. Run manually: ${command}`);
    }
  }

  if (opened > 0) {
    log('');
    info('All workers share THIS project directory and task bus.');
    info('Now run: yuva swarm start   (this terminal becomes the orchestrator)');
  }
}

function swarmCommand(args = []) {
  const { positional, flags } = parseFlags(args, { booleans: ['headless', 'force'] });
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
