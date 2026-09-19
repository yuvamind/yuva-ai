const path = require('path');
const { fileExists } = require('./fs-utils');

const LLM_CONFIGS = {
  // === Commercial / Cloud LLMs ===
  claude: {
    name: 'Claude',
    vendor: 'Anthropic',
    category: 'commercial',
    configFile: 'AGENTS.md',
    description: 'Anthropic Claude (Claude Code, Cursor, VS Code)',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Open this project in Claude Code, Cursor, or VS Code with Claude extension. It reads AGENTS.md automatically.'
  },
  gpt: {
    name: 'GPT',
    vendor: 'OpenAI',
    category: 'commercial',
    configFile: 'AGENTS.md',
    description: 'OpenAI GPT (ChatGPT, GitHub Copilot)',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Use with GitHub Copilot or compatible OpenAI-based editors.'
  },
  gemini: {
    name: 'Gemini',
    vendor: 'Google',
    category: 'commercial',
    configFile: 'GEMINI.md',
    description: 'Google Gemini (Gemini CLI, AI Studio)',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Use with Gemini CLI or Google AI Studio.'
  },
  copilot: {
    name: 'GitHub Copilot',
    vendor: 'GitHub',
    category: 'commercial',
    configFile: '.github/copilot-instructions.md',
    description: 'GitHub Copilot with custom instructions',
    promptFormat: 'markdown',
    features: ['agent-routing', 'quality-gates'],
    instructions: 'Works automatically with GitHub Copilot in VS Code.'
  },
  codex: {
    name: 'Codex CLI',
    vendor: 'OpenAI',
    category: 'commercial',
    configFile: 'AGENTS.md',
    description: 'OpenAI Codex CLI terminal agent',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Run codex in your project directory. It reads AGENTS.md automatically.'
  },

  // === Open Source / Local LLMs ===
  ollama: {
    name: 'Ollama',
    vendor: 'Ollama',
    category: 'open-source',
    configFile: 'OLLAMA_INSTRUCTIONS.md',
    description: 'Ollama local models (Llama, Mistral, CodeLlama, DeepSeek, Qwen)',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Load the OLLAMA_INSTRUCTIONS.md as system prompt. Works with any Ollama model.',
    models: ['llama3', 'llama3.1', 'codellama', 'mistral', 'mixtral', 'deepseek-coder', 'deepseek-v2', 'qwen2.5-coder', 'phi-3', 'gemma2', 'starcoder2']
  },
  opencode: {
    name: 'OpenCode',
    vendor: 'OpenCode',
    category: 'terminal',
    configFile: 'AGENTS.md',
    description: 'OpenCode AI terminal coding assistant',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Run opencode in your project directory. It reads AGENTS.md automatically.'
  },
  'kilo-code': {
    name: 'Kilo Code',
    vendor: 'Kilo Code',
    category: 'terminal',
    configFile: '.kilo/instructions.md',
    description: 'Kilo Code VS Code extension',
    promptFormat: 'markdown',
    features: ['agent-routing', 'quality-gates', 'safety-protocols'],
    instructions: 'Install Kilo Code extension in VS Code. It reads .kilo/instructions.md.'
  },
  aider: {
    name: 'Aider',
    vendor: 'Aider',
    category: 'terminal',
    configFile: '.aider.conf.yml',
    description: 'Aider AI pair programming in terminal',
    promptFormat: 'yaml-config',
    features: ['agent-routing', 'quality-gates'],
    instructions: 'Run aider in your project. Add system prompt via .aider.conf.yml.',
    configTemplate: 'read: CLAUDE.md\n'
  },
  continue: {
    name: 'Continue',
    vendor: 'Continue.dev',
    category: 'open-source',
    configFile: '.continue/instructions.md',
    description: 'Continue.dev open-source AI code assistant (VS Code / JetBrains)',
    promptFormat: 'markdown',
    features: ['agent-routing', 'quality-gates', 'safety-protocols'],
    instructions: 'Install Continue extension. It reads .continue/instructions.md.'
  },
  cody: {
    name: 'Cody',
    vendor: 'Sourcegraph',
    category: 'commercial',
    configFile: '.sourcegraph/instructions.md',
    description: 'Sourcegraph Cody AI assistant',
    promptFormat: 'markdown',
    features: ['agent-routing', 'quality-gates'],
    instructions: 'Install Cody extension in VS Code. Add instructions via .sourcegraph/instructions.md.'
  },
  cursor: {
    name: 'Cursor',
    vendor: 'Cursor',
    category: 'commercial',
    configFile: '.cursor/rules/yuva.mdc',
    description: 'Cursor AI editor with rules',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Open project in Cursor. It reads .cursor/rules/ automatically.'
  },
  windsurf: {
    name: 'Windsurf',
    vendor: 'Codeium',
    category: 'commercial',
    configFile: '.windsurfrules',
    description: 'Windsurf (Codeium) AI editor',
    promptFormat: 'markdown',
    features: ['agent-routing', 'quality-gates', 'safety-protocols'],
    instructions: 'Open project in Windsurf. It reads .windsurfrules automatically.'
  },
  'llm-cli': {
    name: 'LLM CLI',
    vendor: 'Simon Willison',
    category: 'open-source',
    configFile: 'AGENTS.md',
    description: 'llm CLI tool (any model via plugins)',
    promptFormat: 'markdown',
    features: ['agent-routing'],
    instructions: 'Use: cat CLAUDE.md | llm -s "Follow these instructions" "your prompt"'
  },
  lmstudio: {
    name: 'LM Studio',
    vendor: 'LM Studio',
    category: 'open-source',
    configFile: 'OLLAMA_INSTRUCTIONS.md',
    description: 'LM Studio local model runner',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Load OLLAMA_INSTRUCTIONS.md as system prompt in LM Studio chat.'
  },
  jan: {
    name: 'Jan',
    vendor: 'Jan.ai',
    category: 'open-source',
    configFile: 'OLLAMA_INSTRUCTIONS.md',
    description: 'Jan.ai open-source local AI assistant',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates'],
    instructions: 'Load OLLAMA_INSTRUCTIONS.md as system prompt in Jan.'
  },
  'open-interpreter': {
    name: 'Open Interpreter',
    vendor: 'Open Interpreter',
    category: 'open-source',
    configFile: 'AGENTS.md',
    description: 'Open Interpreter terminal agent',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Run: interpreter --system_message "$(cat CLAUDE.md)"'
  },
  tabby: {
    name: 'Tabby',
    vendor: 'TabbyML',
    category: 'open-source',
    configFile: 'AGENTS.md',
    description: 'Tabby self-hosted AI coding assistant',
    promptFormat: 'markdown',
    features: ['agent-routing', 'quality-gates'],
    instructions: 'Add CLAUDE.md content as repository-level prompt in Tabby.'
  },
  'amazon-q': {
    name: 'Amazon Q',
    vendor: 'AWS',
    category: 'commercial',
    configFile: '.amazonq/instructions.md',
    description: 'Amazon Q Developer AI assistant',
    promptFormat: 'markdown',
    features: ['agent-routing', 'quality-gates'],
    instructions: 'Add instructions via .amazonq/instructions.md in your project.'
  },
  antigravity: {
    name: 'Antigravity',
    vendor: 'Google',
    category: 'commercial',
    configFile: 'AGENTS.md',
    description: 'Google Antigravity agent-first IDE',
    promptFormat: 'markdown',
    features: ['agent-routing', 'session-persistence', 'quality-gates', 'safety-protocols'],
    instructions: 'Open project in Antigravity or run "agy" in terminal. It reads AGENTS.md automatically.'
  }
};

function getAvailableLLMs() {
  return Object.entries(LLM_CONFIGS).map(([key, config]) => ({
    id: key,
    ...config
  }));
}

function getLLMsByCategory(category) {
  return Object.entries(LLM_CONFIGS)
    .filter(([, config]) => config.category === category)
    .map(([key, config]) => ({ id: key, ...config }));
}

function getLLMConfig(llmId) {
  return LLM_CONFIGS[llmId] || null;
}

function detectLLM(targetDir) {
  // Check in priority order
  const priority = ['claude', 'cursor', 'gpt', 'gemini', 'copilot', 'opencode', 'codex',
    'kilo-code', 'continue', 'cody', 'windsurf', 'ollama', 'amazon-q', 'aider'];
  for (const id of priority) {
    const config = LLM_CONFIGS[id];
    if (config) {
      const configPath = path.join(targetDir, config.configFile);
      if (fileExists(configPath)) {
        return { id, ...config };
      }
    }
  }
  return null;
}

function detectAllLLMs(targetDir) {
  const detected = [];
  for (const [id, config] of Object.entries(LLM_CONFIGS)) {
    const configPath = path.join(targetDir, config.configFile);
    if (fileExists(configPath)) {
      detected.push({ id, ...config });
    }
  }
  return detected;
}

function generateLLMConfig(llmId, masterContent) {
  const config = LLM_CONFIGS[llmId];
  if (!config) return null;

  if (llmId === 'claude') return masterContent;

  let adapted = masterContent;

  // Replace Claude-specific references
  adapted = adapted.replace(/Claude AI/g, `${config.name} AI`);
  adapted = adapted.replace(/Claude Code/g, config.name);

  // Add LLM-specific header
  const header = `# ${config.name} AI Universal Assistant System\n\n` +
    `> Auto-generated from AGENTS.md for ${config.description}\n` +
    `> All agent prompts in .yuva/prompts/ are compatible.\n` +
    `> Supported models: ${config.models ? config.models.join(', ') : 'all compatible models'}\n\n`;

  adapted = header + adapted.split('\n').slice(1).join('\n');

  // For aider, return config template instead
  if (config.configTemplate) {
    return config.configTemplate;
  }

  return adapted;
}

function getModelSuggestions(llmId) {
  const config = LLM_CONFIGS[llmId];
  if (!config || !config.models) return [];
  return config.models;
}

module.exports = {
  LLM_CONFIGS,
  getAvailableLLMs,
  getLLMsByCategory,
  getLLMConfig,
  detectLLM,
  detectAllLLMs,
  generateLLMConfig,
  getModelSuggestions
};
