const path = require('path');
const fs = require('fs');
const os = require('os');

describe('native-configs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-native-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getBaseTemplate', () => {
    it('should return markdown string with tool name', () => {
      const { getBaseTemplate } = require('../lib/native-configs');
      const result = getBaseTemplate('Claude Code');
      expect(result).toContain('Yuva AI');
      expect(result).toContain('yuva agent orchestrate');
      expect(result).toContain('yuva agent show');
      expect(result).toContain('Build something new');
    });
  });

  describe('updateGitignore', () => {
    it('should create .gitignore if it does not exist', () => {
      const { updateGitignore } = require('../lib/native-configs');
      updateGitignore(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('# Yuva AI - generated native configs');
      expect(content).toContain('CLAUDE.md');
      expect(content).toContain('.claude/');
    });

    it('should append to existing .gitignore', () => {
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/\n');
      const { updateGitignore } = require('../lib/native-configs');
      updateGitignore(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('# Yuva AI - generated native configs');
    });

    it('should not duplicate if already present', () => {
      const { updateGitignore } = require('../lib/native-configs');
      updateGitignore(tmpDir);
      updateGitignore(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
      const matches = content.match(/# Yuva AI - generated native configs/g);
      expect(matches.length).toBe(1);
    });
  });

  describe('generateClaudeConfig', () => {
    it('should create CLAUDE.md with base template', () => {
      const { generateClaudeConfig } = require('../lib/native-configs');
      const files = generateClaudeConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
      expect(content).toContain('Yuva AI - Claude Code Configuration');
      expect(content).toContain('yuva agent orchestrate');
      expect(files).toContain('CLAUDE.md');
    });

    it('should create slash command files', () => {
      const { generateClaudeConfig } = require('../lib/native-configs');
      generateClaudeConfig(tmpDir);
      const commandsDir = path.join(tmpDir, '.claude', 'commands');
      expect(fs.existsSync(path.join(commandsDir, 'debug.md'))).toBe(true);
      expect(fs.existsSync(path.join(commandsDir, 'review.md'))).toBe(true);
      expect(fs.existsSync(path.join(commandsDir, 'test.md'))).toBe(true);
      expect(fs.existsSync(path.join(commandsDir, 'security.md'))).toBe(true);
      expect(fs.existsSync(path.join(commandsDir, 'plan.md'))).toBe(true);
      expect(fs.existsSync(path.join(commandsDir, 'orchestrate.md'))).toBe(true);
    });

    it('should create command files that call yuva CLI', () => {
      const { generateClaudeConfig } = require('../lib/native-configs');
      generateClaudeConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.claude', 'commands', 'debug.md'), 'utf8');
      expect(content).toContain('yuva agent show debugger');
      expect(content).toContain('$ARGUMENTS');
    });

    it('should create settings.json with yuva permissions', () => {
      const { generateClaudeConfig } = require('../lib/native-configs');
      generateClaudeConfig(tmpDir);
      const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8'));
      expect(settings.permissions.allow).toContain('Bash(yuva *)');
    });

    it('should create a SessionStart hook that runs orchestrate', () => {
      const { generateClaudeConfig } = require('../lib/native-configs');
      generateClaudeConfig(tmpDir);
      const settings = JSON.parse(fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8'));
      const hookCommand = settings.hooks.SessionStart[0].hooks[0];
      expect(hookCommand.type).toBe('command');
      expect(hookCommand.command).toContain('yuva agent orchestrate');
    });

    it('base template should require options with recommendations when asking questions', () => {
      const { getBaseTemplate } = require('../lib/native-configs');
      const template = getBaseTemplate('Any Tool');
      expect(template).toContain('(Recommended)');
      expect(template).toContain('go with');
      expect(template).toContain('greetings');
    });

    it('should return list of created files', () => {
      const { generateClaudeConfig } = require('../lib/native-configs');
      const files = generateClaudeConfig(tmpDir);
      expect(files.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('generateCursorConfig', () => {
    it('should create yuva-agents.mdc with glob frontmatter', () => {
      const { generateCursorConfig } = require('../lib/native-configs');
      generateCursorConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.cursor', 'rules', 'yuva-agents.mdc'), 'utf8');
      expect(content).toContain('globs: **/*');
      expect(content).toContain('yuva agent orchestrate');
    });

    it('should create yuva-code.mdc scoped to source files', () => {
      const { generateCursorConfig } = require('../lib/native-configs');
      generateCursorConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.cursor', 'rules', 'yuva-code.mdc'), 'utf8');
      expect(content).toContain('globs: src/**,lib/**,app/**');
      expect(content).toContain('yuva agent show reviewer');
    });

    it('should create yuva-testing.mdc scoped to test files', () => {
      const { generateCursorConfig } = require('../lib/native-configs');
      generateCursorConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.cursor', 'rules', 'yuva-testing.mdc'), 'utf8');
      expect(content).toContain('globs: tests/**,test/**,**/*.test.*,**/*.spec.*');
      expect(content).toContain('yuva agent show tester');
    });

    it('should return list of created files', () => {
      const { generateCursorConfig } = require('../lib/native-configs');
      const files = generateCursorConfig(tmpDir);
      expect(files).toHaveLength(3);
    });
  });

  describe('single-file generators', () => {
    it('should create copilot instructions', () => {
      const { generateCopilotConfig } = require('../lib/native-configs');
      const files = generateCopilotConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.github', 'copilot-instructions.md'), 'utf8');
      expect(content).toContain('Yuva AI - GitHub Copilot Configuration');
      expect(content).toContain('yuva agent orchestrate');
      expect(files).toContain('.github/copilot-instructions.md');
    });

    it('should create windsurf rules', () => {
      const { generateWindsurfConfig } = require('../lib/native-configs');
      const files = generateWindsurfConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.windsurfrules'), 'utf8');
      expect(content).toContain('Yuva AI - Windsurf Configuration');
      expect(files).toContain('.windsurfrules');
    });

    it('should create gemini config', () => {
      const { generateGeminiConfig } = require('../lib/native-configs');
      const files = generateGeminiConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'GEMINI.md'), 'utf8');
      expect(content).toContain('Yuva AI - Gemini Configuration');
      expect(files).toContain('GEMINI.md');
    });

    it('should create kilo code instructions', () => {
      const { generateKiloConfig } = require('../lib/native-configs');
      const files = generateKiloConfig(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, '.kilo', 'instructions.md'))).toBe(true);
      expect(files).toContain('.kilo/instructions.md');
    });

    it('should create cody instructions', () => {
      const { generateCodyConfig } = require('../lib/native-configs');
      const files = generateCodyConfig(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, '.sourcegraph', 'instructions.md'))).toBe(true);
      expect(files).toContain('.sourcegraph/instructions.md');
    });

    it('should create amazon q instructions', () => {
      const { generateAmazonQConfig } = require('../lib/native-configs');
      const files = generateAmazonQConfig(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, '.amazonq', 'instructions.md'))).toBe(true);
      expect(files).toContain('.amazonq/instructions.md');
    });

    it('should create continue instructions', () => {
      const { generateContinueConfig } = require('../lib/native-configs');
      const files = generateContinueConfig(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, '.continue', 'instructions.md'))).toBe(true);
      expect(files).toContain('.continue/instructions.md');
    });

    it('should create ollama instructions with fallback note', () => {
      const { generateOllamaConfig } = require('../lib/native-configs');
      const files = generateOllamaConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, 'OLLAMA_INSTRUCTIONS.md'), 'utf8');
      expect(content).toContain('Yuva AI - Ollama Configuration');
      expect(content).toContain('.aiautomations/prompts/');
      expect(files).toContain('OLLAMA_INSTRUCTIONS.md');
    });

    it('should create aider config yaml', () => {
      const { generateAiderConfig } = require('../lib/native-configs');
      const files = generateAiderConfig(tmpDir);
      const content = fs.readFileSync(path.join(tmpDir, '.aider.conf.yml'), 'utf8');
      expect(content).toContain('read: AGENTS.md');
      expect(files).toContain('.aider.conf.yml');
    });
  });

  describe('generateNativeConfig', () => {
    it('should dispatch to claude generator', () => {
      const { generateNativeConfig } = require('../lib/native-configs');
      const files = generateNativeConfig('claude', tmpDir);
      expect(files).toContain('CLAUDE.md');
      expect(files).toContain('.claude/settings.json');
    });

    it('should dispatch to cursor generator', () => {
      const { generateNativeConfig } = require('../lib/native-configs');
      const files = generateNativeConfig('cursor', tmpDir);
      expect(files).toContain('.cursor/rules/yuva-agents.mdc');
    });

    it('should return empty array for tools that use AGENTS.md natively', () => {
      const { generateNativeConfig } = require('../lib/native-configs');
      const files = generateNativeConfig('codex', tmpDir);
      expect(files).toHaveLength(0);
    });

    it('should return empty array for unknown tool', () => {
      const { generateNativeConfig } = require('../lib/native-configs');
      const files = generateNativeConfig('unknown-tool', tmpDir);
      expect(files).toHaveLength(0);
    });
  });

  describe('generateAllNativeConfigs', () => {
    it('should generate configs for all tools', () => {
      const { generateAllNativeConfigs } = require('../lib/native-configs');
      const result = generateAllNativeConfigs(tmpDir);
      expect(result.totalFiles).toBeGreaterThan(10);
      expect(result.tools).toContain('claude');
      expect(result.tools).toContain('cursor');
      expect(result.tools).toContain('copilot');
    });

    it('should create CLAUDE.md and .windsurfrules and GEMINI.md', () => {
      const { generateAllNativeConfigs } = require('../lib/native-configs');
      generateAllNativeConfigs(tmpDir);
      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.windsurfrules'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'GEMINI.md'))).toBe(true);
    });
  });
});
