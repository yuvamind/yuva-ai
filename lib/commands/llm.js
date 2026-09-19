const path = require('path');
const fs = require('fs');
const { log, box, success, warn, error, info, table } = require('../colors');
const { fileExists, readFile, writeFile, readJSON, writeJSON } = require('../fs-utils');
const { getAvailableLLMs, getLLMsByCategory, getLLMConfig, generateLLMConfig, detectLLM, detectAllLLMs, getModelSuggestions } = require('../llm-adapters');
const P = require('../paths');

function llmCommand(args = []) {
  const action = args[0];

  switch (action) {
    case 'list': return listLLMs(args[1]);
    case 'use': return useLLM(args[1]);
    case 'detect': return detectCurrentLLM();
    case 'generate': return generateConfigs(args[1]);
    case 'models': return showModels(args[1]);
    default: showLLMHelp();
  }
}

function showLLMHelp() {
  box('Yuva AI - LLM Support');
  log('Configure which LLM platform to use.\n', 'bright');
  log('Usage:', 'bright');
  log('   yuva llm list              List all supported LLMs');
  log('   yuva llm list commercial   List commercial LLMs only');
  log('   yuva llm list open-source  List open-source LLMs only');
  log('   yuva llm list terminal     List terminal-based LLMs');
  log('   yuva llm use <name>        Set active LLM');
  log('   yuva llm detect            Detect current LLM');
  log('   yuva llm generate          Generate configs for all LLMs');
  log('   yuva llm generate <name>   Generate config for specific LLM');
  log('   yuva llm models <name>     Show suggested models for an LLM\n');
}

function listLLMs(category) {
  const llms = category ? getLLMsByCategory(category) : getAvailableLLMs();

  if (category) {
    box(`Supported LLMs - ${category}`);
    const rows = llms.map(l => [l.id, l.name, l.vendor, l.configFile]);
    if (rows.length === 0) {
      warn(`No LLMs found for category: ${category}`);
      info('Valid categories: commercial, open-source, terminal\n');
      return;
    }
    table(['ID', 'Name', 'Vendor', 'Config File'], rows);
  } else {
    box('Supported LLMs');

    log('\n🏢 Commercial:', 'bright');
    const commercial = getLLMsByCategory('commercial');
    table(['ID', 'Name', 'Vendor', 'Config File'],
      commercial.map(l => [l.id, l.name, l.vendor, l.configFile]));

    log('\n🔓 Open Source / Local:', 'bright');
    const openSource = getLLMsByCategory('open-source');
    table(['ID', 'Name', 'Vendor', 'Config File'],
      openSource.map(l => [l.id, l.name, l.vendor, l.configFile]));

    log('\n💻 Terminal / CLI:', 'bright');
    const terminal = getLLMsByCategory('terminal');
    table(['ID', 'Name', 'Vendor', 'Config File'],
      terminal.map(l => [l.id, l.name, l.vendor, l.configFile]));
  }

  const configPath = P.configFile(process.cwd());
  const config = readJSON(configPath) || {};
  log(`\n   Current: ${config.llm || 'claude'}`);
  log(`   Total: ${getAvailableLLMs().length} platforms supported\n`);
}

function useLLM(llmId) {
  if (!llmId) {
    error('LLM name required. Use "yuva llm list" to see options.');
    return;
  }

  const configData = getLLMConfig(llmId);
  if (!configData) {
    error(`Unknown LLM: ${llmId}. Use "yuva llm list" to see options.`);
    return;
  }

  const configPath = P.configFile(process.cwd());
  const config = readJSON(configPath) || {};
  config.llm = llmId;
  config.llmConfig = configData.configFile;
  writeJSON(configPath, config);

  const agentsMd = path.join(process.cwd(), 'AGENTS.md');
  if (fileExists(agentsMd)) {
    const content = readFile(agentsMd);
    const adapted = generateLLMConfig(llmId, content);
    if (adapted && llmId !== 'claude') {
      const targetFile = path.join(process.cwd(), configData.configFile);
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeFile(targetFile, adapted);
      success(`Set LLM to ${configData.name}`);
      log(`   Generated: ${configData.configFile}`);
    } else {
      success(`Set LLM to ${configData.name}`);
    }
  } else {
    success(`Set LLM to ${configData.name}`);
  }

  // Show setup instructions
  log(`\n   📖 Setup: ${configData.instructions}\n`);

  // Show model suggestions if available
  const models = getModelSuggestions(llmId);
  if (models.length > 0) {
    log('   Suggested models:', 'bright');
    log(`   ${models.join(', ')}\n`);
  }
}

function detectCurrentLLM() {
  const targetDir = process.cwd();
  const all = detectAllLLMs(targetDir);

  if (all.length > 0) {
    box('Detected LLM Configurations');
    const rows = all.map(l => [l.id, l.name, l.configFile]);
    table(['ID', 'Name', 'Config File'], rows);
    log('');
  } else {
    warn('No LLM configuration detected.');
    info('Run "yuva init" to set up.\n');
  }
}

function generateConfigs(specific) {
  const targetDir = process.cwd();
  const agentsMd = path.join(targetDir, 'AGENTS.md');

  if (!fileExists(agentsMd)) {
    error('AGENTS.md not found. Run "yuva init" first.');
    return;
  }

  const content = readFile(agentsMd);
  const llms = getAvailableLLMs();

  const toGenerate = specific
    ? llms.filter(l => l.id === specific)
    : llms.filter(l => l.id !== 'claude');

  if (toGenerate.length === 0) {
    error(specific ? `Unknown LLM: ${specific}` : 'No LLMs to generate configs for.');
    return;
  }

  let count = 0;
  for (const llm of toGenerate) {
    const adapted = generateLLMConfig(llm.id, content);
    if (adapted) {
      const targetFile = path.join(targetDir, llm.configFile);
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      writeFile(targetFile, adapted);
      success(`Generated ${llm.configFile} for ${llm.name}`);
      count++;
    }
  }
  log(`\n   Generated configs for ${count} platforms.\n`);
}

function showModels(llmId) {
  if (!llmId) {
    error('LLM name required. Usage: yuva llm models <name>');
    return;
  }

  const config = getLLMConfig(llmId);
  if (!config) {
    error(`Unknown LLM: ${llmId}`);
    return;
  }

  const models = getModelSuggestions(llmId);
  box(`${config.name} - Suggested Models`);

  if (models.length > 0) {
    models.forEach(m => log(`   • ${m}`));
  } else {
    info('This platform works with its default model.');
  }
  log('');
}

module.exports = llmCommand;
