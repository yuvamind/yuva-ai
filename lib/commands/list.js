const path = require('path');
const fs = require('fs');
const { log, box, table } = require('../colors');
const { fileExists } = require('../fs-utils');
const { resolvePackagePath } = require('../resolve-package');
const P = require('../paths');

const DEV_AGENTS = {
  'existingcodeagent.md': 'Existing Code Analyzer',
  'requirementsagent.md': 'Requirements',
  'riskassessmentagent.md': 'Risk Assessment',
  'planningprompt.md': 'Planner',
  'execution.md': 'Execution',
  'continuityagent.md': 'Continuity',
  'testeragent.md': 'Tester',
  'revieweragent.md': 'Reviewer',
  'securityagent.md': 'Security',
  'debuggeragent.md': 'Debugger',
  'refactoragent.md': 'Refactor',
  'statemanageragent.md': 'State Manager',
};

function listCommand(options = {}) {
  const targetDir = process.cwd();

  box('Yuva AI - Agents');

  const pkgPath = resolvePackagePath();
  const pkgPrompts = pkgPath ? path.join(pkgPath, 'template', '.yuva', 'prompts') : null;
  const localPrompts = P.promptsDir(targetDir);

  log('Development Agents:', 'bright');
  const rows = [];
  for (const [file, name] of Object.entries(DEV_AGENTS)) {
    const inPackage = pkgPrompts && fileExists(path.join(pkgPrompts, file));
    const inLocal = fileExists(path.join(localPrompts, file));
    const source = inLocal ? 'local' : inPackage ? 'package' : 'missing';
    const status = source !== 'missing' ? '\u2705' : '\u274C';
    rows.push([status, name, file, source]);
  }
  table(['', 'Agent', 'File', 'Source'], rows);

  // Check for custom agents
  if (fileExists(localPrompts)) {
    const allLocal = fs.readdirSync(localPrompts).filter(f => f.endsWith('.md'));
    const knownFiles = Object.keys(DEV_AGENTS);
    const custom = allLocal.filter(f => !knownFiles.includes(f) && f !== 'orchestrator.md');
    if (custom.length > 0) {
      log('\nCustom Agents:', 'bright');
      const customRows = custom.map(f => ['\u2705', f.replace('.md', '').replace('agent', ''), f, 'local']);
      table(['', 'Agent', 'File', 'Source'], customRows);
    }
  }

  log(`\n   Total: ${Object.keys(DEV_AGENTS).length} built-in development agents\n`);
}

module.exports = listCommand;
