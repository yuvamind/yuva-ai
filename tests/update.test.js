const path = require('path');
const fs = require('fs');
const os = require('os');

describe('update command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-update-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should warn if not initialized', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    const logs = [];
    const origWarn = console.log;
    console.log = (msg) => logs.push(msg);

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });
      const output = logs.join(' ');
      expect(output).toContain('Not initialized');
    } finally {
      console.log = origWarn;
      process.chdir(origCwd);
    }
  });

  it('should migrate legacy CLAUDE.md projects instead of claiming not initialized', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    // Legacy install: CLAUDE.md master file, no AGENTS.md
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Old master file\n');

    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });

      const output = logs.join(' ');
      expect(output).not.toContain('Not initialized');
      expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
    } finally {
      console.log = origLog;
      process.chdir(origCwd);
    }
  });

  it('should update projects that only have .aiautomations/', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.aiautomations', 'config.json'), JSON.stringify({
      tool: 'gemini',
      version: '1.0.0',
    }));

    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });

      const output = logs.join(' ');
      expect(output).not.toContain('Not initialized');
      expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
    } finally {
      console.log = origLog;
      process.chdir(origCwd);
    }
  });

  it('should update AGENTS.md from template', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    // Setup: create minimal initialized project
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Old content\n');
    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.aiautomations', 'config.json'), JSON.stringify({
      tool: 'claude',
      version: '3.0.0',
    }));

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });

      const agentsMd = fs.readFileSync(path.join(tmpDir, 'AGENTS.md'), 'utf8');
      expect(agentsMd).toContain('Yuva AI');
      expect(agentsMd).not.toBe('# Old content\n');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('should regenerate native configs for configured tool', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Old\n');
    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.aiautomations', 'config.json'), JSON.stringify({
      tool: 'claude',
      version: '3.0.0',
    }));

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });

      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'debug.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.claude', 'settings.json'))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('should regenerate all native configs when tool is "all"', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Old\n');
    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.aiautomations', 'config.json'), JSON.stringify({
      tool: 'all',
      version: '3.0.0',
    }));

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });

      expect(fs.existsSync(path.join(tmpDir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.windsurfrules'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'GEMINI.md'))).toBe(true);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('should update gitignore', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Old\n');
    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.aiautomations', 'config.json'), JSON.stringify({
      tool: 'claude',
      version: '3.0.0',
    }));

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });

      const gitignore = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
      expect(gitignore).toContain('Yuva AI');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('should update config.json version', () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);

    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), '# Old\n');
    fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.aiautomations', 'config.json'), JSON.stringify({
      tool: 'claude',
      version: '3.0.0',
    }));

    try {
      const updateCommand = require('../lib/commands/update');
      updateCommand({ skipNpm: true });

      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.aiautomations', 'config.json'), 'utf8'));
      // Version should be updated to current package version
      expect(config.version).toBeDefined();
      expect(config.version).not.toBe('3.0.0');
    } finally {
      process.chdir(origCwd);
    }
  });
});
