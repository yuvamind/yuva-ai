#!/usr/bin/env node

// Parse flags
const args = process.argv.slice(2);
// Extract --type <value> before general flag parsing
let typeFlag = null;
const argsWithoutType = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--type' && i + 1 < args.length) {
    typeFlag = args[i + 1];
    i++; // skip value
  } else {
    argsWithoutType.push(args[i]);
  }
}

const flags = {
  force: argsWithoutType.includes('--force'),
  dryRun: argsWithoutType.includes('--dry-run'),
  verbose: argsWithoutType.includes('--verbose'),
  all: argsWithoutType.includes('--all'),
  version: argsWithoutType.includes('--version') || argsWithoutType.includes('-v'),
  type: typeFlag,
};

// Remove flags from args
const commands = argsWithoutType.filter(a => !a.startsWith('--') && !a.startsWith('-v'));
const command = commands[0];
const subArgs = commands.slice(1);

// Version check
if (flags.version) {
  const pkg = require('../package.json');
  console.log(`yuva-ai v${pkg.version}`);
  process.exit(0);
}

// Set up verbose logging
if (flags.verbose) {
  const { getLogger } = require('../lib/logger');
  getLogger({ verbose: true });
}

// Load color utilities
const { log, box } = require('../lib/colors');

// Swarm/gate commands parse their own --flags (e.g. --role, --summary),
// so hand them the raw args that follow the command name.
function rawSubArgs() {
  return args.slice(args.indexOf(command) + 1);
}

function showHelp() {
  const pkg = require('../package.json');
  box(`Yuva AI v${pkg.version}`);

  log('Usage:', 'bright');
  log('  yuva <command> [options]\n');

  log('Setup Commands:', 'bright');
  log('  init              Initialize for AI tool (interactive, auto-detects)');
  log('  init --all        Generate native configs for ALL supported tools');
  log('  init --tool <n>   Initialize for specific tool (skip prompt)');
  log('  upgrade           Update/migrate to latest format');
  log('  update            Update yuva-ai and regenerate all configs');
  log('  doctor            Diagnose setup issues\n');

  log('Agent Commands:', 'bright');
  log('  agent show <name> Get full agent prompt');
  log('  agent list        List all available agents');
  log('  agent orchestrate Scan project context');
  log('  list              List all installed agents');
  log('  add create <name> Create a custom agent');
  log('  add remove <name> Remove an agent\n');

  log('Workflow Commands:', 'bright');
  log('  workflow list     List all workflows');
  log('  workflow create   Create a new workflow');
  log('  workflow show     Show workflow details');
  log('  workflow delete   Delete a workflow\n');

  log('Configuration:', 'bright');
  log('  config            Show/edit configuration');
  log('  config set <k> <v>  Set a config value');
  log('  llm list          List supported LLMs');
  log('  llm use <name>    Switch LLM platform');
  log('  llm generate      Generate configs for all LLMs\n');

  log('Analytics:', 'bright');
  log('  status            Show project status');
  log('  telemetry         Manage usage analytics');
  log('  analytics         View analytics dashboard\n');

  log('Quality Gates:', 'bright');
  log('  gate              Run all quality gates (lint, typecheck, test, build)');
  log('  gate list         Show detected gates without running them\n');

  log('Swarm (multi-terminal orchestrator/worker mode — DEFAULT for big tasks):', 'bright');
  log('  swarm init        Create the task bus (.yuva/)');
  log('  swarm plan "goal" Print the orchestrator planning brief');
  log('  swarm spawn       AUTO-OPEN worker terminals in this project dir');
  log('                    (--roles executor,tester --cli claude --headless)');
  log('  swarm start       Live dashboard: workers, tasks, auto-verification');
  log('  swarm status      One-shot swarm snapshot');
  log('  task add "title"  Add a task (--role executor|tester|reviewer|...)');
  log('  task done <id>    Complete a task (quality gates enforced)');
  log('  worker next       Claim one task in this terminal (--role <role>)');
  log('  worker boot       Boot an AI CLI as a looping worker (--role --cli)');
  log('  worker start      Headless worker loop (--auto --cli "claude -p")\n');

  log('Session:', 'bright');
  log('  session start     Start a new development session');
  log('  session log       Log a work entry');
  log('  session resume    Resume with full context');
  log('  session save      Save checkpoint');
  log('  session end       End current session\n');

  log('Options:', 'bright');
  log('  --force           Overwrite existing files');
  log('  --dry-run         Preview changes without applying');
  log('  --verbose         Enable detailed logging');
  log('  --version, -v     Show version');
  log('  --skip-npm        Skip npm update (only regenerate configs)\n');

  log('Examples:', 'bright');
  log('  npx yuva init');
  log('  npx yuva init opencode');
  log('  npx yuva agent list');
  log('  npx yuva agent show requirements');
  log('  npx yuva agent orchestrate');
  log('  npx yuva llm use gpt');
  log('  npx yuva status\n');

  log('Documentation: https://github.com/Aftab-web-dev/yuva-ai\n', 'cyan');
}

// Route commands
switch (command) {
  case 'init': {
    const initCommand = require('../lib/commands/init');
    initCommand({ force: flags.force, dryRun: flags.dryRun, all: flags.all, tool: subArgs[0] || null });
    break;
  }
  case 'agent': {
    const agentCommand = require('../lib/commands/agent');
    agentCommand(subArgs);
    break;
  }
  case 'status': {
    const statusCommand = require('../lib/commands/status');
    statusCommand();
    break;
  }
  case 'doctor': {
    const doctorCommand = require('../lib/commands/doctor');
    doctorCommand();
    break;
  }
  case 'list': {
    const listCommand = require('../lib/commands/list');
    listCommand({ category: subArgs[0] });
    break;
  }
  case 'upgrade': {
    const upgradeCommand = require('../lib/commands/upgrade');
    upgradeCommand({ dryRun: flags.dryRun });
    break;
  }
  case 'update': {
    const updateCommand = require('../lib/commands/update');
    updateCommand({ dryRun: flags.dryRun, skipNpm: args.includes('--skip-npm') });
    break;
  }
  case 'config': {
    const configCommand = require('../lib/commands/config');
    configCommand(subArgs);
    break;
  }
  case 'add': {
    const addCommand = require('../lib/commands/add');
    addCommand(subArgs);
    break;
  }
  case 'workflow': {
    const workflowCommand = require('../lib/commands/workflow');
    workflowCommand(subArgs);
    break;
  }
  case 'llm': {
    const llmCommand = require('../lib/commands/llm');
    llmCommand(subArgs);
    break;
  }
  case 'telemetry': {
    const telemetryCommand = require('../lib/commands/telemetry');
    telemetryCommand(subArgs);
    break;
  }
  case 'analytics': {
    const analyticsCommand = require('../lib/commands/analytics');
    analyticsCommand();
    break;
  }
  case 'session': {
    const sessionCommand = require('../lib/commands/session');
    sessionCommand.run(subArgs, flags);
    break;
  }
  case 'gate': {
    const gateCommand = require('../lib/commands/gate');
    gateCommand(rawSubArgs());
    break;
  }
  case 'swarm': {
    const swarmCommand = require('../lib/commands/swarm');
    swarmCommand(rawSubArgs());
    break;
  }
  case 'worker': {
    const workerCommand = require('../lib/commands/worker');
    workerCommand(rawSubArgs());
    break;
  }
  case 'task': {
    const taskCommand = require('../lib/commands/task');
    taskCommand(rawSubArgs());
    break;
  }
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    if (!command) {
      showHelp();
    } else {
      log(`\n❌ Unknown command: ${command}`, 'red');
      log('   Run "yuva help" for usage.\n', 'reset');
      process.exit(1);
    }
}

// Auto-save session after every command (except session/help/version)
if (command && !['session', 'help', '--help', '-h'].includes(command) && !flags.version) {
  try {
    const { SessionManager } = require('../lib/session-manager');
    const sm = new SessionManager(process.cwd());
    sm.autoSave();
  } catch {}
}
