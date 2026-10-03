import path from 'path';
import { log, box, success, warn } from '../colors';
import { fileExists, readFile, listFiles, readJSON } from '../fs-utils';
import { NeuralGraph } from '../neural-graph';
import { detectGates } from '../gate-runner';
import { CostTracker } from '../cost-tracker';
import * as P from '../paths';
import { resolvePackagePath } from '../resolve-package';

function statusCommand() {
  const targetDir = process.cwd();

  box('Yuva AI - Project Status');

  if (!fileExists(path.join(targetDir, 'AGENTS.md')) && !fileExists(path.join(targetDir, 'CLAUDE.md'))) {
    warn('Not initialized. Run "yuva init" first.\n');
    return;
  }

  success('Project is initialized\n');

  // Agents, templates and standards are SERVED FROM THE PACKAGE; the project's
  // own .yuva/prompts/ holds overrides only and is empty on a healthy install.
  // Counting just the local directory reported "Total: 0 agents" on a project
  // that `yuva agent list` and `yuva doctor` both described as having 16.
  const pkgRoot = resolvePackagePath();
  const pkgTemplate = pkgRoot ? path.join(pkgRoot, 'template') : null;
  const countIn = (dir: string | null, pattern = '*.md') =>
    (dir && fileExists(dir) ? listFiles(dir, pattern) : []);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const available = countIn(pkgTemplate ? P.promptsDir(pkgTemplate) : null);
  const overrides = countIn(P.promptsDir(targetDir));

  log('📊 Agents:', 'bright');
  if (available.length === 0 && !pkgRoot) {
    warn('   Package not found — run "yuva doctor"');
  } else {
    log(`   Available: ${available.length} (served from the package)`);
    log(`   Local overrides: ${overrides.length}${overrides.length ? ` — ${overrides.join(', ')}` : ''}`);
  }
  log('');



  // Templates and standards, same rule: package first, local override second.
  const templates = countIn(pkgTemplate ? P.templatesDir(pkgTemplate) : null, '*')
    .concat(countIn(P.templatesDir(targetDir), '*'));
  log(`📄 Templates: ${plural(templates.length, 'file')}`, 'bright');

  // Standards replaced the old "protocols" directory, which no longer ships —
  // so that line reported 0 forever regardless of the project's real state.
  const standards = countIn(pkgTemplate ? P.standardsDir(pkgTemplate) : null)
    .concat(countIn(P.standardsDir(targetDir)));
  log(`📐 Standards: ${plural(standards.length, 'file')}`, 'bright');

  // Session state
  log('\n📁 Session:', 'bright');
  const sessionStateFile = path.join(P.sessionDir(targetDir), 'state.md');
  const stateFile = fileExists(sessionStateFile)
    ? sessionStateFile
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
  const costTracker = new CostTracker(P.runDir(targetDir));
  const costSummary = costTracker.getSummary();
  if (costSummary.totalCalls > 0) {
    log(`   Calls: ${costSummary.totalCalls}  Cost: $${costSummary.totalEstimatedCost}`);
    if (costSummary.budgetLimit) {
      log(`   Budget: $${costSummary.budgetLimit} ($${(costSummary.remainingBudget ?? 0).toFixed(2)} left)`);
    }
  } else {
    log('   No AI calls recorded yet');
  }

  // LLM config
  const configFile = P.configFile(targetDir);
  if (fileExists(configFile)) {
    const config = readJSON(configFile);
    if (config) {
      log(`\n⚙️  LLM: ${config.tool || config.llm || 'claude'}`, 'bright');
    }
  }

  log('');
}

export = statusCommand;