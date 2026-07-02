const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { log, box, success, warn, info, error } = require('../colors');
const { fileExists, readJSON, writeJSON } = require('../fs-utils');
const { resolvePackagePath } = require('../resolve-package');
const { getLLMConfig } = require('../llm-adapters');
const { generateNativeConfig, generateAllNativeConfigs, updateGitignore } = require('../native-configs');

function updateCommand(options = {}) {
  const targetDir = process.cwd();
  const dryRun = options.dryRun || false;
  const skipNpm = options.skipNpm || false;

  box('Yuva AI - Update');

  // Check if initialized. Older versions used CLAUDE.md as the master file
  // (before the AGENTS.md migration), and some projects only carry
  // .aiautomations/ — all of those are valid installs to update.
  const hasAgentsMd = fileExists(path.join(targetDir, 'AGENTS.md'));
  const hasLegacyClaudeMd = fileExists(path.join(targetDir, 'CLAUDE.md'));
  const hasAiautomations = fileExists(path.join(targetDir, '.aiautomations'));

  if (!hasAgentsMd && !hasLegacyClaudeMd && !hasAiautomations) {
    warn('Not initialized. Run "yuva init" first.\n');
    return;
  }

  // Legacy install (pre-AGENTS.md) — run the upgrade migration first
  if (!hasAgentsMd && hasLegacyClaudeMd) {
    info('Legacy installation detected (CLAUDE.md) — migrating to latest format first...\n');
    const upgradeCommand = require('./upgrade');
    upgradeCommand({ dryRun });
    log('');
    if (dryRun) return;
  }

  // Read current config
  const configPath = path.join(targetDir, '.aiautomations', 'config.json');
  const config = readJSON(configPath);
  const currentTool = config ? config.tool : null;
  const currentVersion = config ? config.version : 'unknown';

  info(`Current version: ${currentVersion}`);

  // Step 1: Update npm package
  if (!skipNpm) {
    info('Checking for updates...');

    if (dryRun) {
      info('DRY RUN - Would run npm update for yuva-ai');
    } else {
      try {
        // Check if installed globally or locally
        const isGlobal = isGlobalInstall();
        const updateCmd = isGlobal
          ? 'npm update -g yuva-ai'
          : 'npm update yuva-ai';

        info(`Updating yuva-ai (${isGlobal ? 'global' : 'local'})...`);
        execSync(updateCmd, { stdio: 'pipe', encoding: 'utf8' });
        success('Package updated');
      } catch (err) {
        warn(`npm update failed: ${err.message}`);
        warn('Continuing with config regeneration...\n');
      }
    }
  }

  // Resolve package path (may have changed after update)
  const pkgPath = resolvePackagePath();
  if (!pkgPath) {
    error('Cannot find yuva-ai package. Try reinstalling.');
    return;
  }

  const pkg = require(path.join(pkgPath, 'package.json'));
  const newVersion = pkg.version;

  if (skipNpm) {
    info(`Package version: ${newVersion}`);
  } else {
    if (newVersion !== currentVersion) {
      success(`Updated to: ${newVersion}`);
    } else {
      info(`Already on latest: ${newVersion}`);
    }
  }

  if (dryRun) {
    info('\nDRY RUN - Would update:');
    log('   AGENTS.md');
    log('   .aiautomations/config.json');
    if (currentTool === 'all') {
      log('   Native configs for ALL tools');
    } else if (currentTool) {
      log(`   Native configs for: ${currentTool}`);
    }
    log('   .gitignore');
    return;
  }

  log('');

  // Step 2: Update AGENTS.md from template
  const templatePath = path.join(pkgPath, 'template');
  const templateAgentsMd = path.join(templatePath, 'AGENTS.md');
  if (fileExists(templateAgentsMd)) {
    fs.copyFileSync(templateAgentsMd, path.join(targetDir, 'AGENTS.md'));
    success('Updated AGENTS.md');
  }

  // Step 3: Regenerate native configs
  if (currentTool) {
    const llmConfig = getLLMConfig(currentTool);
    const toolName = llmConfig ? llmConfig.name : (currentTool === 'all' ? 'All Tools' : currentTool);

    info(`Regenerating native configs for: ${toolName}`);

    if (currentTool === 'all') {
      const result = generateAllNativeConfigs(targetDir);
      success(`Regenerated ${result.totalFiles} native config files`);
    } else {
      const files = generateNativeConfig(currentTool, targetDir);
      if (files.length > 0) {
        success(`Regenerated ${files.length} native config files`);
      } else {
        info(`No native configs needed for ${toolName} (uses AGENTS.md directly)`);
      }
    }
  }

  // Step 4: Update gitignore
  updateGitignore(targetDir);

  // Step 5: Update config.json version
  if (config) {
    config.version = newVersion;
    writeJSON(configPath, config);
  }

  success('\nUpdate complete!\n');
}

function isGlobalInstall() {
  try {
    const globalPath = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const pkgPath = resolvePackagePath();
    return pkgPath && pkgPath.startsWith(globalPath);
  } catch {
    return false;
  }
}

module.exports = updateCommand;
