const path = require('path');
const fs = require('fs');
const { log, box, success, warn, error, info, table } = require('../colors');
const { resolvePackagePath } = require('../resolve-package');
const { fileExists, readFile } = require('../fs-utils');
const { SessionManager } = require('../session-manager');

// Map short names to file names
const AGENT_MAP = {
  'existingcode': 'existingcodeagent.md',
  'requirements': 'requirementsagent.md',
  'riskassessment': 'riskassessmentagent.md',
  'planning': 'planningprompt.md',
  'execution': 'execution.md',
  'continuity': 'continuityagent.md',
  'tester': 'testeragent.md',
  'reviewer': 'revieweragent.md',
  'security': 'securityagent.md',
  'debugger': 'debuggeragent.md',
  'refactor': 'refactoragent.md',
  'statemanager': 'statemanageragent.md',
  'orchestrator': 'orchestrator.md',
};

const AGENT_DESCRIPTIONS = {
  'existingcode': 'Analyze existing codebase before making changes',
  'requirements': 'Gather and clarify project requirements',
  'riskassessment': 'Identify risks before development',
  'planning': 'Design architecture and create implementation plans',
  'execution': 'Implement code step-by-step following the plan',
  'continuity': 'Resume work from last session state',
  'tester': 'Write and run tests, QA',
  'reviewer': 'Code quality audits and review',
  'security': 'Security vulnerability analysis',
  'debugger': 'Bug investigation and fixing',
  'refactor': 'Code improvement and cleanup',
  'statemanager': 'Update session and project state files',
};

function agentCommand(args = []) {
  const action = args[0];

  switch (action) {
    case 'show': return showAgent(args[1]);
    case 'list': return listAgents();
    case 'orchestrate': return orchestrate();
    default: showAgentHelp();
  }
}

function showAgentHelp() {
  box('Yuva AI - Agent Commands');
  log('Usage:', 'bright');
  log('  yuva agent show <name>       Get full agent prompt');
  log('  yuva agent list              List all available agents');
  log('  yuva agent orchestrate       Scan project context\n');
  log('Agent names:', 'bright');
  for (const [name, desc] of Object.entries(AGENT_DESCRIPTIONS)) {
    log(`  ${name.padEnd(18)} ${desc}`);
  }
  log('');
}

function showAgent(name) {
  if (!name) {
    error('Agent name required. Run "yuva agent list" to see options.');
    return;
  }

  const targetDir = process.cwd();

  // 1. Check local override first
  const localFile = AGENT_MAP[name];
  if (localFile) {
    const localPath = path.join(targetDir, '.aiautomations', 'prompts', localFile);
    if (fileExists(localPath)) {
      process.stdout.write(readFile(localPath));
      return;
    }
  }

  // 2. Check custom local agents
  const customPath = path.join(targetDir, '.aiautomations', 'prompts', `${name}agent.md`);
  if (fileExists(customPath)) {
    process.stdout.write(readFile(customPath));
    return;
  }

  // 3. Read from package
  const pkgPath = resolvePackagePath();
  if (!pkgPath) {
    error('Cannot find yuva-ai package. Reinstall with: npm install -g yuva-ai');
    return;
  }

  const fileName = AGENT_MAP[name];
  if (!fileName) {
    error(`Unknown agent: ${name}. Run "yuva agent list" to see options.`);
    return;
  }

  const agentPath = path.join(pkgPath, 'template', '.aiautomations', 'prompts', fileName);
  if (!fileExists(agentPath)) {
    error(`Agent file not found: ${agentPath}`);
    return;
  }

  process.stdout.write(readFile(agentPath));
}

function listAgents() {
  box('Yuva AI - Available Agents');

  const targetDir = process.cwd();
  const rows = [];

  for (const [name, desc] of Object.entries(AGENT_DESCRIPTIONS)) {
    const fileName = AGENT_MAP[name];
    const localPath = path.join(targetDir, '.aiautomations', 'prompts', fileName);
    const source = fileExists(localPath) ? 'local' : 'package';
    rows.push([name, desc, source]);
  }

  table(['Name', 'Purpose', 'Source'], rows);

  // Check for custom local agents
  const promptsDir = path.join(targetDir, '.aiautomations', 'prompts');
  if (fileExists(promptsDir)) {
    const allFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));
    const knownFiles = Object.values(AGENT_MAP);
    const custom = allFiles.filter(f => !knownFiles.includes(f));
    if (custom.length > 0) {
      log('\nCustom Agents:', 'bright');
      custom.forEach(f => log(`  ${f.replace('.md', '').replace('agent', '')} → ${f}`));
    }
  }

  log(`\nTotal: ${Object.keys(AGENT_MAP).length} built-in agents\n`);
}

function orchestrate() {
  const targetDir = process.cwd();
  const result = {
    hasExistingCode: false,
    languages: [],
    frameworks: [],
    hasSession: false,
    gitStatus: 'unknown',
    tool: 'unknown',
    suggestedFirstAgent: 'requirements',
  };

  // Detect existing code
  const codeIndicators = [
    { file: 'package.json', lang: 'javascript' },
    { file: 'tsconfig.json', lang: 'typescript' },
    { file: 'requirements.txt', lang: 'python' },
    { file: 'setup.py', lang: 'python' },
    { file: 'pyproject.toml', lang: 'python' },
    { file: 'go.mod', lang: 'go' },
    { file: 'Cargo.toml', lang: 'rust' },
    { file: 'pom.xml', lang: 'java' },
    { file: 'build.gradle', lang: 'java' },
    { file: 'Gemfile', lang: 'ruby' },
    { file: 'composer.json', lang: 'php' },
    { file: 'pubspec.yaml', lang: 'dart' },
  ];

  for (const { file, lang } of codeIndicators) {
    if (fileExists(path.join(targetDir, file))) {
      result.hasExistingCode = true;
      if (!result.languages.includes(lang)) result.languages.push(lang);
    }
  }

  // Detect source directories
  const srcDirs = ['src', 'lib', 'app', 'pages', 'components', 'api'];
  for (const dir of srcDirs) {
    if (fileExists(path.join(targetDir, dir))) {
      result.hasExistingCode = true;
    }
  }

  // Detect frameworks from package.json
  const pkgPath = path.join(targetDir, 'package.json');
  if (fileExists(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const frameworkChecks = [
        { dep: 'react', name: 'react' },
        { dep: 'next', name: 'nextjs' },
        { dep: 'vue', name: 'vue' },
        { dep: 'nuxt', name: 'nuxt' },
        { dep: 'express', name: 'express' },
        { dep: 'fastify', name: 'fastify' },
        { dep: '@nestjs/core', name: 'nestjs' },
        { dep: '@angular/core', name: 'angular' },
        { dep: 'svelte', name: 'svelte' },
        { dep: 'hono', name: 'hono' },
      ];
      for (const { dep, name } of frameworkChecks) {
        if (allDeps && allDeps[dep]) result.frameworks.push(name);
      }
    } catch {}
  }

  // Check session
  result.hasSession = fileExists(path.join(targetDir, '.session', 'state.md'));

  // Check git status
  try {
    const { execSync } = require('child_process');
    const status = execSync('git status --porcelain 2>/dev/null', { cwd: targetDir, encoding: 'utf8' });
    result.gitStatus = status.trim() === '' ? 'clean' : 'dirty';
  } catch {
    result.gitStatus = 'not-a-repo';
  }

  // Detect tool from config
  const configPath = path.join(targetDir, '.aiautomations', 'config.json');
  if (fileExists(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      result.tool = config.tool || 'unknown';
    } catch {}
  }

  // Suggest first agent
  if (result.hasSession) {
    result.suggestedFirstAgent = 'continuity';
  } else if (result.hasExistingCode) {
    result.suggestedFirstAgent = 'existingcode';
  } else {
    result.suggestedFirstAgent = 'requirements';
  }

  // Swarm context — swarm is the DEFAULT flow for multi-step work
  // (set "mode": "solo" in .aiautomations/config.json to opt out)
  const { TaskBus } = require('../task-bus');
  const bus = new TaskBus(targetDir);
  let mode = 'swarm';
  if (fileExists(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.mode) mode = cfg.mode;
    } catch {}
  }
  result.mode = mode;

  if (bus.exists()) {
    const summary = bus.getStatusSummary();
    result.swarm = {
      active: true,
      tasks: summary.counts,
      workers: summary.workers.map(w => ({ id: w.id, role: w.role, status: w.status })),
      instruction: 'Swarm is ACTIVE. To work in this terminal: yuva worker next --role <role>. To orchestrate: yuva swarm start.',
    };
  } else {
    result.swarm = {
      active: false,
      isDefault: mode === 'swarm',
      instruction: mode === 'swarm'
        ? 'DEFAULT FLOW for any multi-step task: 1) yuva swarm init  2) yuva swarm plan "<goal>"  3) yuva task add ... (executor + tester + reviewer tasks with --deps)  4) yuva swarm spawn (auto-opens worker terminals in THIS directory)  5) yuva swarm start (this terminal orchestrates). Use solo mode only for trivial single-file changes or if the user asks.'
        : 'Solo mode configured. Use swarm commands only if the user asks.',
    };
  }

  // Add session context
  const sm = new SessionManager(process.cwd());
  const session = sm.getSession();

  if (session && session.status === 'active') {
    result.session = {
      active: true,
      goal: session.goal,
      phase: session.phase,
      summary: session.summary,
      lastSaved: session.lastSavedAt,
      recentEntries: session.entries.slice(-5).map(e => e.message),
      decisions: session.decisions.map(d => d.what),
      filesChanged: session.filesChanged,
      suggestAgent: 'continuity',
    };
  } else {
    result.session = { active: false };
  }

  // Output as JSON (for AI consumption)
  console.log(JSON.stringify(result, null, 2));
}

module.exports = agentCommand;
