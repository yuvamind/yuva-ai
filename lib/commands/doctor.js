const path = require('path');
const fs = require('fs');
const { log, box, success, warn, error, info } = require('../colors');
const { fileExists, readJSON } = require('../fs-utils');
const { NeuralGraph } = require('../neural-graph');
const { detectGates } = require('../gate-runner');
const { BUILTIN_RULES } = require('../plugin-gates');
const { resolvePackagePath } = require('../resolve-package');
const P = require('../paths');

function doctorCommand() {
  const targetDir = process.cwd();
  let issues = 0;
  let warnings = 0;

  box('Yuva AI - Doctor');

  // Check AGENTS.md (new) or CLAUDE.md (legacy)
  const hasAgentsMd = fileExists(path.join(targetDir, 'AGENTS.md'));
  const hasClaudeMd = fileExists(path.join(targetDir, 'CLAUDE.md'));

  if (hasAgentsMd) {
    success('AGENTS.md exists');
  } else if (hasClaudeMd) {
    warn('CLAUDE.md exists (legacy format). Run "yuva upgrade" to migrate to AGENTS.md');
    warnings++;
  } else {
    error('AGENTS.md missing - run "yuva init"');
    issues++;
  }

  // Check config.json
  const configPath = P.configFile(targetDir);
  if (fileExists(configPath)) {
    const config = readJSON(configPath);
    if (config && config.tool) {
      success(`Config: tool=${config.tool}, version=${config.version || 'unknown'}`);
    } else {
      warn('Config exists but missing tool setting');
      warnings++;
    }
  } else {
    warn('.yuva/config.json missing');
    warnings++;
  }

  // Check agents.md index
  const agentsIndex = P.agentsIndex(targetDir);
  if (fileExists(agentsIndex)) {
    success('Agent index (.yuva/agents.md) exists');
  } else {
    warn('Agent index missing');
    warnings++;
  }

  // Check package path resolution
  const pkgPath = resolvePackagePath();
  if (pkgPath) {
    const promptsDir = path.join(pkgPath, 'template', '.yuva', 'prompts');
    if (fileExists(promptsDir)) {
      const agents = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));
      success(`Package agents: ${agents.length} found at ${pkgPath}`);
    } else {
      error('Package template directory missing');
      issues++;
    }
  } else {
    error('Cannot resolve yuva-ai package path');
    issues++;
  }

  // Check for local overrides
  const localPrompts = P.promptsDir(targetDir);
  if (fileExists(localPrompts)) {
    const local = fs.readdirSync(localPrompts).filter(f => f.endsWith('.md'));
    if (local.length > 0) {
      success(`Local agent overrides: ${local.length} found`);
    }
  }

  // Check session directory (.yuva/run/session/, or legacy .session/)
  if (fileExists(P.sessionDir(targetDir)) || fileExists(path.join(targetDir, '.session'))) {
    success('session directory exists (.yuva/run/session/)');
  } else {
    warn('session directory not found (created on first use)');
  }

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  if (major >= 18) {
    success(`Node.js ${nodeVersion}`);
  } else {
    error(`Node.js ${nodeVersion} - requires >=18.0.0`);
    issues++;
  }

  // Check quality gates
  const gates = detectGates(targetDir);
  if (gates.length > 0) {
    success(`Quality gates: ${gates.map(g => g.name).join(', ')}`);
  } else {
    warn('No quality gates detected — add lint/test/build scripts to package.json');
    warnings++;
  }

  // Check plugin gates
  const pluginGateCount = Object.keys(BUILTIN_RULES).length;
  success(`Plugin gates: ${pluginGateCount} built-in rules available`);

  // Check neural graph
  const graph = new NeuralGraph(targetDir);
  if (graph.load()) {
    const stats = graph.getStats();
    success(`Neural graph: ${stats.totalNodes} nodes, ${stats.totalEdges} edges`);
  } else {
    info('Neural graph: not built yet (run "yuva graph build")');
  }

  // Check swarm bus — the task bus lives in the runtime half, not the config
  if (fileExists(P.tasksDir(targetDir))) {
    success('Swarm bus (.yuva/run/) exists');
  }

  // Flag a legacy layout so the fix is one obvious command away
  if (P.needsMigration(targetDir)) {
    warn('Legacy layout detected — run "yuva upgrade" to move config into .yuva/');
  }

  // Summary
  log('');
  if (issues === 0 && warnings === 0) {
    box('All checks passed!', 'green');
  } else if (issues === 0) {
    box(`${warnings} warning(s), no critical issues`, 'yellow');
  } else {
    box(`${issues} issue(s), ${warnings} warning(s) found`, 'red');
  }

  if (issues > 0) process.exitCode = 1;
}

module.exports = doctorCommand;
