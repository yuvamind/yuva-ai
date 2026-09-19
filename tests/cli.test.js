
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('CLI', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('template copy', () => {
    it('should copy template files to target directory', () => {
      const templateDir = path.join(__dirname, '..', 'template');
      const { copyDir } = require('../lib/fs-utils');

      copyDir(templateDir, tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'prompts'))).toBe(true);
    });

    it('should create all dev agent prompt files', () => {
      const templateDir = path.join(__dirname, '..', 'template');
      const { copyDir } = require('../lib/fs-utils');

      copyDir(templateDir, tmpDir);

      const promptsDir = path.join(tmpDir, '.yuva', 'prompts');
      const agents = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));
      expect(agents.length).toBeGreaterThanOrEqual(12);
    });

    it('should create config.json', () => {
      const templateDir = path.join(__dirname, '..', 'template');
      const { copyDir } = require('../lib/fs-utils');

      copyDir(templateDir, tmpDir);

      expect(fs.existsSync(path.join(tmpDir, '.yuva', 'config.json'))).toBe(true);
    });

  });

  describe('resolve-package', () => {
    it('should resolve package path from source', () => {
      const { resolvePackagePath } = require('../lib/resolve-package');
      const pkgPath = resolvePackagePath();
      expect(pkgPath).toBeTruthy();
      expect(fs.existsSync(path.join(pkgPath, 'template'))).toBe(true);
    });

    it('should find agent prompt paths', () => {
      const { getAgentPromptPath } = require('../lib/resolve-package');
      const promptPath = getAgentPromptPath('requirements');
      expect(promptPath).toBeTruthy();
      expect(fs.existsSync(promptPath)).toBe(true);
    });
  });

  describe('detect-tool', () => {
    it('should return a valid tool string', () => {
      const { detectTool } = require('../lib/detect-tool');
      const tool = detectTool(process.cwd());
      expect(typeof tool).toBe('string');
      expect(tool.length).toBeGreaterThan(0);
    });
  });

  describe('init with native configs', () => {
    it('should generate claude native config with --tool flag', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        const initCommand = require('../lib/commands/init');
        await initCommand({ tool: 'claude', force: true });

        expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'debug.md'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);

        // Check gitignore was updated
        const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
        expect(gitignore).toContain('Yuva AI');
      } finally {
        process.chdir(origCwd);
      }
    });

    it('should generate cursor native config with --tool flag', async () => {
      const origCwd = process.cwd();
      process.chdir(tmpDir);

      try {
        const initCommand = require('../lib/commands/init');
        await initCommand({ tool: 'cursor', force: true });

        expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.cursor', 'rules', 'yuva-agents.mdc'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.cursor', 'rules', 'yuva-code.mdc'))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, '.cursor', 'rules', 'yuva-testing.mdc'))).toBe(true);
      } finally {
        process.chdir(origCwd);
      }
    });
  });
});
