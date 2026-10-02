import { execSync } from 'child_process';
import { SessionManager } from '../session-manager';
import { log, success, warn, error, info, heading, colorize } from '../colors';
import type { FlagValue } from '../arg-utils';
type Flags = Record<string, FlagValue | boolean | null | undefined>;

function showSessionHelp() {
  heading('Session Commands:');
  log('  session start "goal"          Start a new development session');
  log('  session log "message"         Log a work entry (see --type below)');
  log('  session decision "what" "why" Record a decision');
  log('  session save "summary"        Save checkpoint');
  log('  session resume                Resume with full context');
  log('  session status                Show current session info');
  log('  session end                   End current session');
  log('  session clear                 Clear session files\n');
  log('Entry types (--type, default "note"):', 'bright');
  log('  note        general progress (the default)');
  log('  code        implementation work');
  log('  plan        planning and architecture');
  log('  design      design decisions, briefs, tokens');
  log('  qa          testing and visual QA');
  log('  risk        risks and blockers');
  log('  security    security review');
  log('  review      code review');
  log('  todo        something deferred');
  log('  issue       a problem found\n');
  log('Any string is accepted; these are the ones the agents actually emit.', 'dim');
  log('`session log --type decision` writes only a LOG entry — use', 'dim');
  log('`session decision "what" "why"` to record an actual decision.\n', 'dim');
}


function run(subArgs: string[], flags: Flags) {
  const sm = new SessionManager(process.cwd());
  const subcommand = subArgs[0];
  const rest = subArgs.slice(1);

  switch (subcommand) {
    case 'start': {
      const goal = rest.join(' ') || 'Unnamed session';
      if (sm.hasActiveSession()) {
        // Non-null: hasActiveSession() was just checked.
        const existing = sm.getSession()!;
        warn(`Session already active: "${existing.goal}"`);
        return;
      }
      const session = sm.start({ goal });
      success(`Session started: "${session.goal}"`);
      info(`ID: ${session.id}`);
      break;
    }

    case 'log': {
      const type = String(flags.type || 'note');
      const message = rest.join(' ');
      if (!message) {
        error('Please provide a message to log.');
        return;
      }
      sm.log(message, { type });
      success(`Logged [${type}]: ${message}`);
      break;
    }

    case 'decision': {
      const what = rest[0];
      const why = rest[1];
      if (!what || !why) {
        error('Usage: session decision "what" "why"');
        return;
      }
      // Both arguments are single positionals, so unquoted multi-word input
      // used to silently truncate: `session decision use postgres faster writes`
      // recorded what="use", why="postgres" and dropped the rest.
      if (rest.length > 2) {
        error('Usage: session decision "what" "why"  — both arguments must be quoted.');
        info(`Got ${rest.length} arguments; the extra ones would be silently dropped.`);
        info(`Did you mean:  yuva session decision "${rest.slice(0, Math.ceil(rest.length / 2)).join(' ')}" "${rest.slice(Math.ceil(rest.length / 2)).join(' ')}"`);
        return;
      }
      sm.decision(what, why);
      success(`Decision recorded: ${what}`);
      break;
    }

    case 'save': {
      const summary = rest.join(' ') || undefined;
      let filesChanged;
      try {
        const diff = execSync('git diff --name-only HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        filesChanged = diff.trim().split('\n').filter(Boolean);
      } catch {
        filesChanged = undefined;
      }
      if (!sm.save({ summary, filesChanged })) {
        warn('No active session — nothing to checkpoint.');
        info('Start one with: yuva session start "goal"');
        return;
      }
      success('Checkpoint saved.');
      if (summary) info(`Summary: ${summary}`);
      break;
    }

    case 'resume': {
      const content = sm.resume();
      if (content === 'No active session') {
        warn('No active session to resume.');
        return;
      }
      log(content);
      break;
    }

    case 'status': {
      const session = sm.getSession();
      if (!session) {
        warn('No session found.');
        return;
      }
      heading('Session Status');
      log(`  Goal:      ${session.goal}`);
      log(`  Status:    ${session.status}`);
      log(`  Phase:     ${session.phase}`);
      log(`  Started:   ${session.startedAt}`);
      log(`  Entries:   ${session.entries.length}`);
      log(`  Files:     ${session.filesChanged.length}`);
      log(`  Decisions: ${session.decisions.length}\n`);
      break;
    }

    case 'end': {
      if (!sm.hasActiveSession()) {
        warn('No active session to end.');
        return;
      }
      sm.end();
      success('Session ended.');
      break;
    }

    case 'clear': {
      sm.clear();
      success('Session files cleared.');
      break;
    }

    default:
      showSessionHelp();
      break;
  }
}

export { run };