const path = require('path');
const { log, box, success, warn } = require('../colors');
const { fileExists, readFile, listFiles, readJSON } = require('../fs-utils');
const { NeuralGraph } = require('../neural-graph');
const { detectGates } = require('../gate-runner');
const { CostTracker } = require('../cost-tracker');

function statusCommand() {
  const targetDir = process.cwd();

  box('Yuva AI - Project Status');

  if (!fileExists(path.join(targetDir, 'AGENTS.md')) && !fileExists(path.join(targetDir, 'CLAUDE.md'))) {
    warn('Not initialized. Run "yuva init" first.\n');
    return;
  }

  success('Project is initialized\n');

  // Count agents
  const promptsDir = path.join(targetDir, '.aiautomations', 'prompts');
  const agents = fileExists(promptsDir) ? listFiles(promptsDir, '*.md') : [];
  const devAgents = ['requirementsagent.md', 'riskassessmentagent.md', 'planningprompt.md',
    'execution.md', 'continuityagent.md', 'testeragent.md', 'revieweragent.md',
    'securityagent.md', 'debuggeragent.md', 'refactoragent.md', 'statemanageragent.md'];

  const devCount = agents.filter(a => devAgents.includes(a)).length;
  const lifeCount = agents.length - devCount - (agents.includes('orchestrator.md') ? 1 : 0);

  log('📊 Agents:', 'bright');
  log(`   Total: ${agents.length} agents`);
  log(`   Development: ${devCount}`);
  log(`   Life/Personal: ${lifeCount}\n`);

  // Check standards
  const standardsDir = path.join(targetDir, '.aiautomations', 'standards');
  const standards = fileExists(standardsDir) ? listFiles(standardsDir, '*.md') : [];
  log(`📋 Standards: ${standards.length} files`, 'bright');

  // Check checklists
  const checklistsDir = path.join(targetDir, '.aiautomations', 'checklists');
  const checklists = fileExists(checklistsDir) ? listFiles(checklistsDir, '*.md') : [];
  log(`✓  Checklists: ${checklists.length} files`, 'bright');

  // Check templates
  const templatesDir = path.join(targetDir, '.aiautomations', 'templates');
  const templates = fileExists(templatesDir) ? listFiles(templatesDir, '*.md') : [];
  log(`📄 Templates: ${templates.length} files`, 'bright');

  // Check protocols
  const protocolsDir = path.join(targetDir, '.aiautomations', 'protocols');
  const protocols = fileExists(protocolsDir) ? listFiles(protocolsDir, '*.md') : [];
  log(`🔒 Protocols: ${protocols.length} files`, 'bright');

  // Check workflows
  const workflowsDir = path.join(targetDir, '.aiautomations', 'workflows');
  const workflows = fileExists(workflowsDir) ? listFiles(workflowsDir, '*.yml') : [];
  log(`🔄 Workflows: ${workflows.length} files`, 'bright');

  // Session state
  log('\n📁 Session:', 'bright');
  const stateFile = fileExists(path.join(targetDir, '.yuva', 'session', 'state.md'))
    ? path.join(targetDir, '.yuva', 'session', 'state.md')
    : path.join(targetDir, '.session', 'state.md');
  if (fileExists(stateFile)) {
    const state = readFile(stateFile);
    const phaseMatch = state && state.match(/## Current Phase\n(.+)/);
    const statusMatch = state && state.match(/Status: (.+)/);
    if (phaseMatch) log(`   Phase: ${phaseMatch[1]}`);
    if (statusMatch) log(`   Health: ${statusMatch[1]}`);
  } else {
    log('   No active session');
  }

  // Memory state
  log('\n🧠 Memory:', 'bright');
  const userMemory = path.join(targetDir, '.memory', 'user.md');
  if (fileExists(userMemory)) {
    const mem = readFile(userMemory);
    const lines = mem ? mem.split('\n').filter(l => l.trim()).length : 0;
    log(`   User profile: ${lines} lines`);
  } else {
    log('   No user profile saved');
  }

  // Quality gates
  const gates = detectGates(targetDir);
  log('\n🔒 Quality Gates:', 'bright');
  if (gates.length > 0) {
    for (const g of gates) log(`   ${g.name}: ${g.command}`);
  } else {
    log('   No gates detected');
  }

  // Neural graph
  log('\n🧠 Neural Graph:', 'bright');
  const graph = new NeuralGraph(targetDir);
  if (graph.load()) {
    const stats = graph.getStats();
    log(`   Nodes: ${stats.totalNodes}  Edges: ${stats.totalEdges}`);
    const types = Object.entries(stats.nodesByType).map(([t, c]) => `${t}:${c}`).join(', ');
    log(`   Types: ${types}`);
  } else {
    log('   Not built yet (run "yuva graph build")');
  }

  // Cost tracking
  log('\n💰 Cost Tracking:', 'bright');
  const costTracker = new CostTracker(path.join(targetDir, '.yuva'));
  const costSummary = costTracker.getSummary();
  if (costSummary.totalCalls > 0) {
    log(`   Calls: ${costSummary.totalCalls}  Cost: $${costSummary.totalEstimatedCost}`);
    if (costSummary.budgetLimit) {
      log(`   Budget: $${costSummary.budgetLimit} ($${costSummary.remainingBudget.toFixed(2)} left)`);
    }
  } else {
    log('   No AI calls recorded yet');
  }

  // LLM config
  const configFile = path.join(targetDir, '.aiautomations', 'config.json');
  if (fileExists(configFile)) {
    const config = readJSON(configFile);
    if (config) {
      log(`\n⚙️  LLM: ${config.tool || config.llm || 'claude'}`, 'bright');
    }
  }

  log('');
}

module.exports = statusCommand;
