const { log, box, success, error, warn, info, table } = require('../colors');
const { TaskBus } = require('../task-bus');
const { runGates, runAllGates } = require('../gate-runner');
const { buildWorkPackage, ROLES } = require('../work-package');
const { parseFlags } = require('../arg-utils');
const { PromptEnforcer, formatEnforcementResult } = require('../prompt-enforcer');
const { NeuralGraph } = require('../neural-graph');

function showTaskHelp() {
  box('Yuva AI - Swarm Tasks');
  log('Usage:', 'bright');
  log('  yuva task add "title" --role <role> [--desc "..."] [--deps id1,id2] [--priority N]');
  log('  yuva task list [--status pending|claimed|done|verified|failed]');
  log('  yuva task show <id>       Full task details + work package');
  log('  yuva task done <id> --summary "..."   Finish a task (runs quality gates first)');
  log('  yuva task fail <id> --reason "..."    Mark a task as blocked/failed\n');
  log('Roles:', 'bright');
  for (const [name, role] of Object.entries(ROLES)) {
    log(`  ${name.padEnd(10)} ${role.description}`);
  }
  log(`  ${'any'.padEnd(10)} Claimable by any worker\n`);
}

function taskCommand(args = []) {
  const { positional, flags } = parseFlags(args, { booleans: ['skip-gates'] });
  const bus = new TaskBus(process.cwd());
  const sub = positional[0];

  switch (sub) {
    case 'add': {
      const title = positional.slice(1).join(' ');
      if (!title) {
        error('Task title required. Usage: yuva task add "title" --role executor');
        return;
      }
      const role = flags.role || 'any';
      if (role !== 'any' && !ROLES[role]) {
        error(`Unknown role: ${role}. Valid roles: ${Object.keys(ROLES).join(', ')}, any`);
        return;
      }
      const deps = flags.deps ? String(flags.deps).split(',').map(d => d.trim()).filter(Boolean) : [];
      const task = bus.addTask({
        title,
        description: flags.desc || flags.description || '',
        role,
        deps,
        priority: flags.priority || 0,
      });
      success(`Task added: [${task.id}] ${task.title} (role: ${task.role})`);
      if (deps.length) info(`Depends on: ${deps.join(', ')}`);
      break;
    }

    case 'list': {
      const tasks = bus.listTasks({ status: flags.status });
      if (tasks.length === 0) {
        warn('No tasks on the bus. Add one: yuva task add "title" --role executor');
        return;
      }
      box('Yuva AI - Task Board');
      table(
        ['ID', 'Status', 'Role', 'Title', 'Worker', 'Attempts'],
        tasks.map(t => [t.id, t.status, t.role, t.title.slice(0, 40), t.claimedBy || '-', t.attempts])
      );
      log('');
      break;
    }

    case 'show': {
      const task = bus.getTask(positional[1]);
      if (!task) {
        error(`Task not found: ${positional[1] || '(no id given)'}`);
        return;
      }
      process.stdout.write(buildWorkPackage(task, process.cwd()));
      break;
    }

    case 'done': {
      const task = bus.getTask(positional[1]);
      if (!task) {
        error(`Task not found: ${positional[1] || '(no id given)'}`);
        return;
      }
      if (task.status !== 'claimed') {
        warn(`Task ${task.id} is "${task.status}" — only claimed tasks can be completed.`);
        return;
      }

      // ENFORCEMENT: validate scope + protected files before running gates
      const enforcer = new PromptEnforcer(process.cwd());
      const enforcement = enforcer.validateCompletion(task, task.preFlightPlan || null);

      if (!enforcement.valid) {
        log('');
        error('ENFORCEMENT VIOLATIONS DETECTED:');
        for (const v of enforcement.violations) {
          error(`  ❌ ${v}`);
        }
        log('');
        error(`Task ${task.id} REJECTED — fix violations and retry.`);
        bus.rejectTask(task.id, `enforcement violations:\\n${enforcement.violations.join('\\n')}`);
        process.exitCode = 1;
        return;
      }

      if (enforcement.warnings.length > 0) {
        for (const w of enforcement.warnings) {
          warn(`  ⚠️ ${w}`);
        }
      }

      // ENFORCEMENT: quality gates (project + plugin) must pass before a task can be marked done
      let gateResult = null;
      if (!flags['skip-gates']) {
        info('Running quality gates before accepting completion...');
        const allGates = runAllGates(process.cwd());
        gateResult = allGates;

        // Show project gates
        for (const gate of allGates.projectGates.gates) {
          if (gate.status === 'passed') {
            success(`gate ${gate.name} passed`);
          } else {
            error(`gate ${gate.name} FAILED`);
            if (gate.output) log(gate.output.split('\\n').map(l => `    ${l}`).join('\\n'), 'dim');
          }
        }

        // Show plugin gate failures
        for (const gate of allGates.pluginGates.gates) {
          if (!gate.passed) {
            error(`plugin gate ${gate.name} FAILED (${gate.findings.length} findings)`);
          }
        }

        if (!allGates.passed) {
          log('');
          error(`Task ${task.id} NOT completed — fix the gate failures and run "yuva task done ${task.id}" again.`);
          process.exitCode = 1;
          return;
        }
      } else {
        warn('Gates skipped (--skip-gates). The orchestrator will still verify this task.');
      }

      const summary = flags.summary || positional.slice(2).join(' ') || null;
      bus.completeTask(task.id, {
        summary,
        gate: gateResult ? { passed: gateResult.passed, at: new Date().toISOString() } : null,
      });

      // Learn from this task — update the neural graph
      try {
        const graph = new NeuralGraph(process.cwd());
        if (graph.load()) {
          const changedFiles = enforcement.changedFiles || [];
          graph.learnFromTask({ ...task, summary, status: 'done' }, changedFiles);
          graph.save();
        }
      } catch {}

      success(`Task ${task.id} completed — awaiting orchestrator verification.`);
      break;
    }

    case 'fail': {
      const task = bus.getTask(positional[1]);
      if (!task) {
        error(`Task not found: ${positional[1] || '(no id given)'}`);
        return;
      }
      const reason = flags.reason || positional.slice(2).join(' ') || 'no reason given';
      bus.failTask(task.id, reason);
      warn(`Task ${task.id} marked failed: ${reason}`);
      break;
    }

    default:
      showTaskHelp();
  }
}

module.exports = taskCommand;
