const path = require('path');
const fs = require('fs');
const { log, box, success, warn, info, error } = require('../colors');
const { fileExists, readJSON, writeJSON, ensureDir } = require('../fs-utils');
const { resolvePackagePath } = require('../resolve-package');
const { detectTool } = require('../detect-tool');

function upgradeCommand(options = {}) {
  const targetDir = process.cwd();
  const dryRun = options.dryRun || false;

  box('Yuva AI - Upgrade');

  const hasAgentsMd = fileExists(path.join(targetDir, 'AGENTS.md'));
  const hasClaudeMd = fileExists(path.join(targetDir, 'CLAUDE.md'));
  // Projects cloned fresh may only carry .aiautomations/ (the generated
  // master files are often gitignored) — still a valid install to upgrade.
  const hasAiautomations = fileExists(path.join(targetDir, '.aiautomations'));

  if (!hasAgentsMd && !hasClaudeMd && !hasAiautomations) {
    warn('Not initialized. Run "yuva init" first.\n');
    return;
  }

  const pkgPath = resolvePackagePath();
  if (!pkgPath) {
    error('Cannot find yuva-ai package. Reinstall with: npm install -g yuva-ai');
    return;
  }

  const templatePath = path.join(pkgPath, 'template');
  const actions = [];

  // Migration: CLAUDE.md -> AGENTS.md
  if (hasClaudeMd && !hasAgentsMd) {
    actions.push({ type: 'migrate', desc: 'Rename CLAUDE.md -> AGENTS.md' });
  }

  // Master file missing entirely (e.g. gitignored on a fresh clone) — restore it
  if (!hasClaudeMd && !hasAgentsMd) {
    actions.push({ type: 'restore-agents-md', desc: 'Restore AGENTS.md from template' });
  }

  // Check if config.json exists
  const configPath = path.join(targetDir, '.aiautomations', 'config.json');
  if (!fileExists(configPath)) {
    actions.push({ type: 'create-config', desc: 'Create .aiautomations/config.json' });
  }

  // Check if agents.md index exists
  const agentsIndex = path.join(targetDir, '.aiautomations', 'agents.md');
  if (!fileExists(agentsIndex)) {
    actions.push({ type: 'create-index', desc: 'Create .aiautomations/agents.md' });
  }

  // Update AGENTS.md from template
  const templateAgentsMd = path.join(templatePath, 'AGENTS.md');
  if (fileExists(templateAgentsMd) && hasAgentsMd) {
    const current = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8');
    const latest = fs.readFileSync(templateAgentsMd, 'utf8');
    if (current !== latest) {
      actions.push({ type: 'update-agents-md', desc: 'Update AGENTS.md to latest version' });
    }
  }

  // Check for old-style full copy (prompts dir with many files)
  const localPrompts = path.join(targetDir, '.aiautomations', 'prompts');
  if (fileExists(localPrompts)) {
    const localFiles = fs.readdirSync(localPrompts).filter(f => f.endsWith('.md'));
    if (localFiles.length > 5) {
      actions.push({ type: 'cleanup-prompts', desc: `Remove ${localFiles.length} copied agent prompts (now served from package)`, files: localFiles });
    }
  }

  if (actions.length === 0) {
    success('Already up to date!\n');
    return;
  }

  log(`\nUpgrade actions: ${actions.length}`, 'bright');
  actions.forEach(a => log(`   ${a.desc}`));

  if (dryRun) {
    info('\nDRY RUN - No files will be modified.\n');
    return;
  }

  log('');

  for (const action of actions) {
    switch (action.type) {
      case 'migrate':
        fs.renameSync(path.join(targetDir, 'CLAUDE.md'), path.join(targetDir, 'AGENTS.md'));
        // Copy new AGENTS.md content from template
        if (fileExists(path.join(templatePath, 'AGENTS.md'))) {
          fs.copyFileSync(path.join(templatePath, 'AGENTS.md'), path.join(targetDir, 'AGENTS.md'));
        }
        success('Migrated CLAUDE.md -> AGENTS.md');
        break;

      case 'create-config': {
        ensureDir(path.join(targetDir, '.aiautomations'));
        const tool = detectTool(targetDir);
        const pkg = require(path.join(pkgPath, 'package.json'));
        const config = {
          tool,
          packagePath: pkgPath,
          version: pkg.version,
          autoDetected: true,
          telemetry: false,
          sessionPersistence: true,
        };
        writeJSON(configPath, config);
        success('Created .aiautomations/config.json');
        break;
      }

      case 'create-index': {
        const indexSrc = path.join(templatePath, '.aiautomations', 'agents.md');
        if (fileExists(indexSrc)) {
          ensureDir(path.join(targetDir, '.aiautomations'));
          fs.copyFileSync(indexSrc, agentsIndex);
          success('Created .aiautomations/agents.md');
        }
        break;
      }

      case 'update-agents-md':
        fs.copyFileSync(path.join(templatePath, 'AGENTS.md'), path.join(targetDir, 'AGENTS.md'));
        success('Updated AGENTS.md');
        break;

      case 'restore-agents-md':
        if (fileExists(path.join(templatePath, 'AGENTS.md'))) {
          fs.copyFileSync(path.join(templatePath, 'AGENTS.md'), path.join(targetDir, 'AGENTS.md'));
          success('Restored AGENTS.md');
        }
        break;

      case 'cleanup-prompts': {
        // Only remove files that match package agents (preserve custom ones)
        const pkgPrompts = path.join(templatePath, '.aiautomations', 'prompts');
        const pkgFiles = fs.readdirSync(pkgPrompts).filter(f => f.endsWith('.md'));
        let removed = 0;
        for (const file of action.files) {
          if (pkgFiles.includes(file)) {
            fs.unlinkSync(path.join(localPrompts, file));
            removed++;
          }
        }
        // Remove prompts dir if empty
        const remaining = fs.readdirSync(localPrompts);
        if (remaining.length === 0) {
          fs.rmdirSync(localPrompts);
        }
        success(`Removed ${removed} copied prompts (now served from package)`);
        break;
      }
    }
  }

  success('\nUpgrade complete!\n');
}

module.exports = upgradeCommand;
