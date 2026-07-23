const path = require('path');
const fs = require('fs');
const { log, success, warn, box, info, error } = require('../colors');
const { fileExists, ensureDir, writeJSON, writeFile } = require('../fs-utils');
const { resolvePackagePath } = require('../resolve-package');
const { detectTool } = require('../detect-tool');
const { getLLMConfig, LLM_CONFIGS } = require('../llm-adapters');
const { generateNativeConfig, generateAllNativeConfigs, updateGitignore } = require('../native-configs');
const { GraphBuilder } = require('../graph-builder');
const { confirm, select } = require('../prompt-utils');

async function initCommand(options = {}) {
  const targetDir = process.cwd();
  const force = options.force || false;
  const dryRun = options.dryRun || false;
  const all = options.all || false;
  const requestedTool = options.tool || null;

  box('Yuva AI - Setup');

  // Check for existing setup
  const hasAgentsMd = fileExists(path.join(targetDir, 'AGENTS.md'));
  if (hasAgentsMd && !force) {
    warn('AGENTS.md already exists.');
    log('   Use --force to overwrite.\n', 'yellow');
    process.exit(1);
  }

  // Resolve package path
  const pkgPath = resolvePackagePath();
  if (!pkgPath) {
    error('Cannot find yuva-ai package. Try reinstalling.');
    process.exit(1);
  }

  // Determine tool(s)
  let selectedTool = requestedTool;

  if (!all && !selectedTool) {
    // Auto-detect and confirm
    const detected = detectTool(targetDir);
    const llmConfig = getLLMConfig(detected);
    const detectedName = llmConfig ? llmConfig.name : detected;

    info(`Detected: ${detectedName}`);

    const useDetected = await confirm(`Use ${detectedName}?`, options);
    if (useDetected) {
      selectedTool = detected;
    } else {
      // Show selection list
      const toolOptions = Object.entries(LLM_CONFIGS).map(([id, config]) => ({
        id,
        name: config.name,
        category: config.category === 'commercial' ? 'Commercial' :
                  config.category === 'terminal' ? 'Terminal / CLI' :
                  config.category === 'open-source' ? 'Open Source' : 'Other',
      }));

      selectedTool = await select('Which AI tool are you using?', toolOptions, options);
      if (!selectedTool) {
        error('No tool selected. Exiting.');
        process.exit(1);
      }
    }
  }

  const llmConfig = selectedTool ? getLLMConfig(selectedTool) : null;
  const toolName = llmConfig ? llmConfig.name : (all ? 'All Tools' : selectedTool);

  info(`Configuring for: ${toolName}\n`);

  if (dryRun) {
    info('DRY RUN - No files will be created.\n');
    info('Would create:');
    log('   AGENTS.md (orchestrator)');
    log('   .aiautomations/config.json');
    log('   .aiautomations/agents.md (agent index)');
    if (all) {
      log('   Native configs for ALL supported tools');
    } else if (selectedTool) {
      const tmpDry = path.join(require('os').tmpdir(), 'yuva-dry-' + Date.now());
      const files = generateNativeConfig(selectedTool, tmpDry);
      files.forEach(f => log(`   ${f} (native config)`));
      fs.rmSync(tmpDry, { recursive: true, force: true });
    }
    log('   .gitignore (updated)');
    return;
  }

  const createdFiles = [];

  try {
    // 1. Copy AGENTS.md from template
    const templatePath = path.join(pkgPath, 'template');
    const agentsMdSrc = path.join(templatePath, 'AGENTS.md');
    if (fileExists(agentsMdSrc)) {
      fs.copyFileSync(agentsMdSrc, path.join(targetDir, 'AGENTS.md'));
      createdFiles.push('AGENTS.md');
    }

    // 2. Create .aiautomations/config.json
    const configDir = path.join(targetDir, '.aiautomations');
    ensureDir(configDir);

    const pkg = require(path.join(pkgPath, 'package.json'));
    const config = {
      tool: selectedTool || 'all',
      packagePath: pkgPath,
      version: pkg.version,
      autoDetected: !requestedTool && !all,
      telemetry: false,
      sessionPersistence: true,
    };
    writeJSON(path.join(configDir, 'config.json'), config);
    createdFiles.push('.aiautomations/config.json');

    // 3. Copy agents.md index
    const agentsIndexSrc = path.join(templatePath, '.aiautomations', 'agents.md');
    if (fileExists(agentsIndexSrc)) {
      fs.copyFileSync(agentsIndexSrc, path.join(configDir, 'agents.md'));
      createdFiles.push('.aiautomations/agents.md');
    }

    // 4. Generate native configs
    if (all) {
      const result = generateAllNativeConfigs(targetDir);
      createdFiles.push(...result.files);
      info(`Generated native configs for ${result.tools.length} tools`);
    } else if (selectedTool) {
      const files = generateNativeConfig(selectedTool, targetDir);
      createdFiles.push(...files);
    }

    // 5. Update .gitignore
    updateGitignore(targetDir);
    createdFiles.push('.gitignore (updated)');

    // 6. Build neural graph (auto-scan the codebase)
    try {
      const builder = new GraphBuilder(targetDir);
      const graphResult = builder.build();
      if (graphResult.stats.totalNodes > 0) {
        createdFiles.push('.yuva/graph/graph.json (neural graph)');
        info(`Neural graph: ${graphResult.stats.totalNodes} nodes, ${graphResult.stats.totalEdges} edges built in ${graphResult.duration}ms`);
      }
    } catch {}

    // Success output
    success('Created files:');
    createdFiles.forEach(f => log(`   ${f}`));

    box('Setup Complete!', 'green');

    log(`\nConfigured for: ${toolName}`, 'bright');
    log(`Agent prompts served from: ${pkgPath}\n`);

    log('Quick start:', 'bright');
    log('  1. Open this project in your AI tool');
    log('  2. The AI reads its native config and uses yuva commands');
    log('  3. Tell it what you want to build\n');

    log('Commands:', 'bright');
    log('  yuva agent list        List all agents');
    log('  yuva agent show <name> Get agent prompt');
    log('  yuva agent orchestrate Scan project context');
    log('  yuva init --all        Generate configs for all tools');
    log('  yuva init --force      Regenerate configs\n');

  } catch (err) {
    error(`Error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = initCommand;
