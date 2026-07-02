const path = require('path');
const fs = require('fs');
const { log, box, success, warn, error } = require('../colors');
const { fileExists, readJSON } = require('../fs-utils');
const { resolvePackagePath } = require('../resolve-package');

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
  const configPath = path.join(targetDir, '.aiautomations', 'config.json');
  if (fileExists(configPath)) {
    const config = readJSON(configPath);
    if (config && config.tool) {
      success(`Config: tool=${config.tool}, version=${config.version || 'unknown'}`);
    } else {
      warn('Config exists but missing tool setting');
      warnings++;
    }
  } else {
    warn('.aiautomations/config.json missing');
    warnings++;
  }

  // Check agents.md index
  const agentsIndex = path.join(targetDir, '.aiautomations', 'agents.md');
  if (fileExists(agentsIndex)) {
    success('Agent index (.aiautomations/agents.md) exists');
  } else {
    warn('Agent index missing');
    warnings++;
  }

  // Check package path resolution
  const pkgPath = resolvePackagePath();
  if (pkgPath) {
    const promptsDir = path.join(pkgPath, 'template', '.aiautomations', 'prompts');
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
  const localPrompts = path.join(targetDir, '.aiautomations', 'prompts');
  if (fileExists(localPrompts)) {
    const local = fs.readdirSync(localPrompts).filter(f => f.endsWith('.md'));
    if (local.length > 0) {
      success(`Local agent overrides: ${local.length} found`);
    }
  }

  // Check session directory (.yuva/session/, or legacy .session/)
  if (fileExists(path.join(targetDir, '.yuva', 'session')) || fileExists(path.join(targetDir, '.session'))) {
    success('session directory exists (.yuva/session/)');
  } else {
    warn('session directory not found (created on first use)');
  }

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  if (major >= 14) {
    success(`Node.js ${nodeVersion}`);
  } else {
    error(`Node.js ${nodeVersion} - requires >=14.0.0`);
    issues++;
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
}

module.exports = doctorCommand;
