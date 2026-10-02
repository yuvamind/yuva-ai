import { log, box, success, error, warn, info, table } from '../colors';
import { TaskBus, type TaskStatus } from '../task-bus';
import { runGates, runAllGates } from '../gate-runner';
import { buildWorkPackage, ROLES } from '../work-package';
import { parseFlags } from '../arg-utils';
import { PromptEnforcer, formatEnforcementResult } from '../prompt-enforcer';
import { NeuralGraph } from '../neural-graph';
import type { FlagValue } from '../arg-utils';
import type { PreFlightPlan } from '../prompt-enforcer';
type Flags = Record<string, FlagValue>;

function showTaskHelp() {
  box('Yuva AI - Swarm Tasks');
  log('Usage:', 'bright');
  log('  yuva task add "title" --role <role> [--desc "..."] [--deps id1,id2] [--priority N]');
  log('  yuva task list [--status pending|claimed|done|verified|failed]');
  log('  yuva task show <id>       Full task details + work package');
  log('  yuva task done <id> --worker <worker-id> --summary "..."   Finish a task (runs quality gates first)');
  log('  yuva task fail <id> --worker <worker-id> --reason "..."    Mark a task as blocked/failed\n');
  log('Roles:', 'bright');
  for (const [name, role] of Object.entries(ROLES)) {
    log(`  ${name.padEnd(10)} ${role.description}`);
  }
  log(`  ${'any'.padEnd(10)} Claimable by any worker\n`);
}

function taskCommand(args: string[] = []) {
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
      if (role !== 'any' && !(ROLES as Record<string, unknown>)[String(role)]) {
        error(`Unknown role: ${role}. Valid roles: ${Object.keys(ROLES).join(', ')}, any`);
        return;
      }
      const deps = flags.deps ? String(flags.deps).split(',').map(d => d.trim()).filter(Boolean) : [];
      let task;
      try {
        task = bus.addTask({
          title,
          // String(): addTask coerces with String() itself, so this is the same value.
          description: String(flags.desc || flags.description || ''),
          // The ROLES check above guarantees a string here; a bare --role (true)
          // was rejected on that path. Number(): addTask applies it anyway.
          role: String(role),
          deps,
          priority: Number(flags.priority) || 0,
        });
      } catch (err) {
        error(`Could not add task: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }
      success(`Task added: [${task.id}] ${task.title} (role: ${task.role})`);
      if (deps.length) info(`Depends on: ${deps.join(', ')}`);
      break;
    }

    case 'list': {
      // Any flag value is passed through as before; an unknown status simply matches nothing.
      const tasks = bus.listTasks({ status: flags.status as TaskStatus | undefined });
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
      const workerId = flags.worker;
      if (!workerId || task.claimedBy !== workerId) {
        error(`Task ${task.id} can only be completed by its claiming worker (${task.claimedBy}).`);
        process.exitCode = 1;
        return;
      }

      // ENFORCEMENT: validate scope + protected files before running gates
      const enforcer = new PromptEnforcer(process.cwd());
      const enforcement = enforcer.validateCompletion(task, (task.preFlightPlan as PreFlightPlan | undefined) || null);

      if (!enforcement.valid) {
        log('');
        error('ENFORCEMENT VIOLATIONS DETECTED:');
        for (const v of enforcement.violations) {
          error(`  ❌ ${v}`);
        }
        log('');
        error(`Task ${task.id} REJECTED — fix violations and retry.`);
        bus.rejectTask(task.id, `enforcement violations:\n${enforcement.violations.join('\n')}`);
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
            if (gate.output) log(gate.output.split('\n').map(l => `    ${l}`).join('\n'), 'dim');
          }
        }

        // Show plugin gate failures
        for (const gate of allGates.pluginGates.gates) {
          if (!gate.passed) {
            const report = gate.blocking ? error : warn;
            report(`plugin gate ${gate.name} ${gate.blocking ? 'FAILED' : 'warning'} (${gate.findings.length} findings)`);
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
      const completed = bus.completeTask(task.id, {
        // Stored verbatim, as before: a bare --summary flag records `true`.
        summary: summary as string | null,
        gate: gateResult ? { passed: gateResult.passed, at: new Date().toISOString() } : null,
        workerId,
      });
      if (!completed) {
        error(`Task ${task.id} was not completed — its claim changed or is no longer owned by worker ${workerId}.`);
        process.exitCode = 1;
        return;
      }

      // Learn from this task — update the neural graph
      try {
        const graph = new NeuralGraph(process.cwd());
        if (graph.load()) {
          const changedFiles = enforcement.changedFiles || [];
          graph.learnFromTask({ ...task, summary, status: 'done' }, changedFiles);
          graph.save();
        }
      } catch (err) { /* graph learning failed — non-critical */ }

      success(`Task ${task.id} completed — awaiting orchestrator verification.`);
      break;
    }

    case 'fail': {
      const task = bus.getTask(positional[1]);
      if (!task) {
        error(`Task not found: ${positional[1] || '(no id given)'}`);
        return;
      }
      if (task.status !== 'claimed') {
        warn(`Task ${task.id} is "${task.status}" — only claimed tasks can be failed.`);
        return;
      }
      const workerId = flags.worker;
      if (!workerId || task.claimedBy !== workerId) {
        error(`Task ${task.id} can only be failed by its claiming worker (${task.claimedBy}).`);
        process.exitCode = 1;
        return;
      }
      const reason = flags.reason || positional.slice(2).join(' ') || 'no reason given';
      const failed = bus.failTask(task.id, reason as string, { workerId });
      if (!failed) {
        error(`Task ${task.id} was not failed — its claim changed or is no longer owned by worker ${workerId}.`);
        process.exitCode = 1;
        return;
      }
      warn(`Task ${task.id} marked failed: ${reason}`);
      break;
    }

    default:
      showTaskHelp();
  }
}

export = taskCommand;