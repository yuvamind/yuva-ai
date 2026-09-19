const path = require('path');
const fs = require('fs');
const { log, box, success, warn, info, error } = require('../colors');
const { fileExists, readJSON, writeJSON, ensureDir } = require('../fs-utils');
const { resolvePackagePath } = require('../resolve-package');
const { detectTool } = require('../detect-tool');
const P = require('../paths');

function upgradeCommand(options = {}) {
  const targetDir = process.cwd();
  const dryRun = options.dryRun || false;

  box('Yuva AI - Upgrade');

  const hasAgentsMd = fileExists(path.join(targetDir, 'AGENTS.md'));
  const hasClaudeMd = fileExists(path.join(targetDir, 'CLAUDE.md'));
  // Projects cloned fresh may only carry a config directory (.yuva/, or a
  // pre-2.2 .aiautomations/) — still a valid install to upgrade.
  const hasConfigDir = P.isInitialized(targetDir);

  if (!hasAgentsMd && !hasClaudeMd && !hasConfigDir) {
    warn('Not initialized. Run "yuva init" first.\n');
    return;
  }

  const pkgPath = resolvePackagePath();
  if (!pkgPath) {
    error('Cannot find yuva-ai package. Reinstall with: npm install -g yuva-ai');
    return;
  }

  const templatePath = path.join(pkgPath, 'template');

  // Layout migration runs FIRST and immediately, not as a queued action —
  // every check below resolves paths through P.*, and those answers change
  // once .aiautomations/ has been folded into .yuva/. Queuing it would leave
  // the checks reading pre-migration locations.
  let migrated = false;
  if (P.needsMigration(targetDir)) {
    if (dryRun) {
      info('Would migrate layout: config into .yuva/, runtime into .yuva/run/');
    } else {
      const moved = P.migrate(targetDir);
      for (const m of moved) log(`   ${m}`, 'dim');
      if (P.ensureGitignore(targetDir)) {
        log('   .gitignore now ignores .yuva/run/ only', 'dim');
      }
      success(`Migrated layout (${moved.length} ${moved.length === 1 ? 'move' : 'moves'})\n`);
      migrated = true;
    }
  }

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
  const configPath = P.configFile(targetDir);
  if (!fileExists(configPath)) {
    actions.push({ type: 'create-config', desc: 'Create .yuva/config.json' });
  }

  // Check if agents.md index exists
  const agentsIndex = P.agentsIndex(targetDir);
  if (!fileExists(agentsIndex)) {
    actions.push({ type: 'create-index', desc: 'Create .yuva/agents.md' });
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
  const localPrompts = P.promptsDir(targetDir);
  if (fileExists(localPrompts)) {
    const localFiles = fs.readdirSync(localPrompts).filter(f => f.endsWith('.md'));
    if (localFiles.length > 5) {
      actions.push({ type: 'cleanup-prompts', desc: `Remove ${localFiles.length} copied agent prompts (now served from package)`, files: localFiles });
    }
  }

  if (actions.length === 0) {
    // A layout migration is real work — do not then claim nothing happened.
    success(migrated ? 'Upgrade complete!\n' : 'Already up to date!\n');
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
        ensureDir(P.configDir(targetDir));
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
        success('Created .yuva/config.json');
        break;
      }

      case 'create-index': {
        const indexSrc = P.agentsIndex(templatePath);
        if (fileExists(indexSrc)) {
          ensureDir(P.configDir(targetDir));
          fs.copyFileSync(indexSrc, agentsIndex);
          success('Created .yuva/agents.md');
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
        const pkgPrompts = P.promptsDir(templatePath);
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
