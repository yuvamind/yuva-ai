const { spawn, spawnSync } = require('child_process');
const { log, box, success, error, warn, info } = require('../colors');
const { TaskBus } = require('../task-bus');
const { runGates, runAllGates } = require('../gate-runner');
const { buildWorkPackage, ROLES } = require('../work-package');
const { parseFlags } = require('../arg-utils');
const { GitIsolation } = require('../git-isolation');
const { StreamingWorker } = require('../streaming-worker');
const { PromptEnforcer } = require('../prompt-enforcer');

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

  if (bus.stopRequested()) {
    info('SWARM STOPPED — the orchestrator ended the loop. No new tasks will be handed out. End your worker loop now.');
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
  const git = new GitIsolation(process.cwd());
  const streamer = new StreamingWorker(bus);

  // Git isolation: check status and warn if unavailable
  let useGitBranch = false;
  if (flags['no-isolate']) {
    warn('Git branch isolation: DISABLED (--no-isolate). Changes are NOT protected by branches.');
  } else {
    const gitStatus = git.getStatus();
    if (gitStatus.available) {
      useGitBranch = true;
      success('Git branch isolation: ENABLED (each task gets its own branch)');
    } else {
      warn(`Git isolation UNAVAILABLE: ${gitStatus.reason}`);
      warn(`  → ${gitStatus.suggestion}`);
      if (gitStatus.dirtyFiles) {
        for (const f of gitStatus.dirtyFiles) {
          warn(`    ${f}`);
        }
      }
      warn('Continuing WITHOUT branch isolation — changes are NOT protected.');
      warn('Add --no-isolate to suppress this warning.');
    }
  }

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
    if (bus.stopRequested()) {
      info('Stop signal received (.yuva/stop) — worker exiting.');
      break;
    }
    bus.heartbeat(worker.id, { status: 'idle' });
    const task = bus.claimTask(worker.id, role);

    if (!task) {
      await sleep(pollMs);
      continue;
    }

    log(`\n▶ Claimed task [${task.id}] ${task.title}`, 'cyan');
    bus.heartbeat(worker.id, { status: 'busy', currentTask: task.id });

    const workPkg = buildWorkPackage(task, process.cwd());

    // PRE-FLIGHT ENFORCEMENT: send comprehension check before the full work package
    // This verifies the AI actually understands the task before spending tokens on it
    const enforcer = new PromptEnforcer(process.cwd());
    if (!flags['skip-preflight']) {
      info('Running pre-flight comprehension check...');
      const preFlightPrompt = enforcer.buildPreFlightPrompt(task, workPkg.slice(0, 500));
      const preFlightResult = await runCli(cliCommand, preFlightPrompt);

      if (!preFlightResult.error) {
        // Try to parse the AI's pre-flight response
        try {
          // Extract JSON from the response (the AI may wrap it in prose)
          const { extractJSON } = require('../loop-engine');
          const preFlightPlan = extractJSON(preFlightResult.stdout || '');
          if (preFlightPlan) {
            const validation = enforcer.validatePreFlight(preFlightPlan, task);
            if (!validation.valid) {
              warn('Pre-flight check FAILED:');
              for (const v of validation.violations) {
                warn(`  ❌ ${v}`);
              }
              bus.rejectTask(task.id, `pre-flight failed: ${validation.violations.join('; ')}`);
              bus.heartbeat(worker.id, { status: 'idle', currentTask: null });
              if (flags.once) break;
              continue;
            }
            if (validation.warnings.length > 0) {
              for (const w of validation.warnings) warn(`  ⚠️ ${w}`);
            }
            // Store the plan for post-task validation
            task.preFlightPlan = preFlightPlan;
            success('Pre-flight check passed.');
          }
        } catch {}
      }
    }

    // Keep heartbeating while the LLM CLI runs
    const beat = setInterval(() => bus.heartbeat(worker.id, { status: 'busy', currentTask: task.id }), HEARTBEAT_MS);

    let result;
    if (useGitBranch) {
      // Git branch isolation: each task runs on its own branch
      result = await git.isolateTask(worker.id, task.id, async () => {
        const r = await streamer.run(task.id, cliCommand, { cwd: process.cwd() });
        return { success: r.code === 0, summary: `CLI exit code ${r.code}` };
      });
    } else {
      // No git isolation — run directly
      result = { success: true };
      const r = await streamer.run(task.id, cliCommand, { cwd: process.cwd() });
      result.cliResult = r;
    }

    clearInterval(beat);

    // Check if CLI failed to start
    const cliResult = result.cliResult || { code: result.success ? 0 : 1, error: result.error };
    if (cliResult.error && cliResult.code !== 0 && !result.success) {
      error(`CLI failed: ${cliResult.error || 'unknown error'}`);
      bus.rejectTask(task.id, `worker CLI failed: ${cliResult.error}`);
      bus.heartbeat(worker.id, { status: 'idle', currentTask: null });
      if (flags.once) break;
      continue;
    }

    // If git isolation detected a merge conflict, reject with details
    if (result.needsManualMerge) {
      error(`Merge conflict for task ${task.id} — manual resolution needed`);
      bus.rejectTask(task.id, `merge conflict: ${result.error}`);
      bus.heartbeat(worker.id, { status: 'idle', currentTask: null });
      if (flags.once) break;
      continue;
    }

    // The AI should have run "yuva task done" itself. If the task is still
    // claimed, decide from the gates: pass → done, fail → back to pending
    const after = bus.getTask(task.id);
    if (after && after.status === 'claimed') {
      info('CLI exited without completing the task — running gates to decide...');
      const gateResult = runAllGates(process.cwd());
      if (gateResult.passed) {
        bus.completeTask(task.id, {
          summary: 'auto worker: CLI finished, gates passed',
          gate: { passed: true, at: new Date().toISOString() },
        });
        success(`Task ${task.id} completed (gates passed).`);
      } else {
        const failures = [
          ...gateResult.projectGates.gates.filter(g => g.status === 'failed').map(g => `${g.name}: ${g.output || 'failed'}`),
          ...gateResult.pluginGates.gates.filter(g => !g.passed).map(g => `plugin:${g.name}: ${g.findings.length} findings`),
        ].join('\n---\n');
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

/**
 * Build the bootstrap prompt an AI CLI receives when a worker terminal is
 * spawned. MUST NOT contain double quotes (passed through shells).
 */
function buildWorkerBootPrompt(role) {
  return [
    `You are a Yuva swarm WORKER with the role: ${role}.`,
    'Work in a strict loop:',
    `1) Run: yuva worker next --role ${role}`,
    '2) If it prints a work package, follow it EXACTLY — its agent instructions, checklists, and standards are mandatory. Finish ONLY via the yuva task done command it specifies (quality gates run automatically; if they fail, fix and retry).',
    `3) If it prints SWARM STOPPED, end your loop and tell the user you are done.`,
    `4) If no task is available, run: yuva task list — if pending tasks exist for other reasons wait ~30 seconds, then go back to step 1.`,
    '5) After completing a task, go back to step 1 for the next one.',
    'Never stop the loop unless the user tells you to stop or the swarm is stopped. Do not invent work outside the bus.',
    'IMPORTANT: work ONLY inside the current working directory (the shared project) — never cd elsewhere, never clone or create a separate copy of the project.',
    'PROTECTED FILES — NEVER delete, move, or empty: .yuva/, .session/, .aiautomations/, AGENTS.md, CLAUDE.md, GEMINI.md, .claude/, .cursor/ or any AI config file. Never run yuva swarm clear or yuva session clear.',
  ].join(' ');
}

/**
 * Runs inside a freshly spawned worker terminal (via `yuva swarm spawn`).
 * With --cli: launches the AI CLI with the worker-loop prompt.
 * With --cli + --headless: runs the fully automated worker loop instead.
 * Without --cli: falls back to claiming one task for a human/AI to read.
 */
function workerBoot(bus, flags) {
  const role = flags.role || 'executor';
  if (!validateRole(role)) return;

  const cli = flags.cli && flags.cli !== true ? String(flags.cli) : null;

  if (cli && flags.headless) {
    return workerStart(bus, { role, auto: true, cli: `${cli} -p`, interval: flags.interval });
  }

  if (cli) {
    box(`Yuva AI - Worker Terminal (${role})`);
    info(`Launching ${cli} as a ${role} worker...`);
    const prompt = buildWorkerBootPrompt(role);
    const result = spawnSync(`${cli} "${prompt}"`, {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
    });
    if (result.error) {
      error(`Could not launch "${cli}": ${result.error.message}`);
      info(`Manual fallback — run: yuva worker next --role ${role}`);
    }
    return;
  }

  return workerNext(bus, { role });
}

function workerCommand(args = []) {
  const { positional, flags } = parseFlags(args, { booleans: ['auto', 'once', 'headless', 'no-isolate', 'skip-preflight'] });
  const bus = new TaskBus(process.cwd());
  const sub = positional[0];

  switch (sub) {
    case 'next':
      return workerNext(bus, flags);
    case 'start':
      return workerStart(bus, flags);
    case 'boot':
      return workerBoot(bus, flags);
    default:
      showWorkerHelp();
  }
}

module.exports = workerCommand;
module.exports.buildWorkerBootPrompt = buildWorkerBootPrompt;
