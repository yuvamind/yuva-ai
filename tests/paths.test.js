const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../lib/paths');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-paths-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const write = (rel, content = 'x') => {
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

const exists = (rel) => fs.existsSync(path.join(tmpDir, rel));

describe('paths', () => {
  describe('layout', () => {
    it('puts committed config in .yuva/ and runtime in .yuva/run/', () => {
      expect(P.configPath(tmpDir, 'config.json')).toBe(path.join(tmpDir, '.yuva', 'config.json'));
      expect(P.runPath(tmpDir, 'tasks')).toBe(path.join(tmpDir, '.yuva', 'run', 'tasks'));
    });

    it('resolves writes to the new location even when a legacy file exists', () => {
      write('.aiautomations/config.json');
      // Reads fall back...
      expect(P.configFile(tmpDir)).toBe(path.join(tmpDir, '.aiautomations', 'config.json'));
      // ...but writes never do.
      expect(P.configPath(tmpDir, 'config.json')).toBe(path.join(tmpDir, '.yuva', 'config.json'));
    });
  });

  describe('resolveConfig()', () => {
    it('prefers .yuva/ when both layouts are present', () => {
      write('.aiautomations/config.json');
      write('.yuva/config.json');
      expect(P.configFile(tmpDir)).toBe(path.join(tmpDir, '.yuva', 'config.json'));
    });

    it('falls back to .aiautomations/ so un-upgraded projects keep working', () => {
      write('.aiautomations/prompts/executoragent.md');
      expect(P.promptsDir(tmpDir)).toBe(path.join(tmpDir, '.aiautomations', 'prompts'));
    });

    it('returns the new path when neither exists', () => {
      expect(P.agentsIndex(tmpDir)).toBe(path.join(tmpDir, '.yuva', 'agents.md'));
    });
  });

  describe('resolveRun()', () => {
    it('falls back to the flat .yuva/ runtime layout', () => {
      write('.yuva/tasks/abc.json');
      expect(P.tasksDir(tmpDir)).toBe(path.join(tmpDir, '.yuva', 'tasks'));
    });

    it('prefers .yuva/run/ once migrated', () => {
      write('.yuva/run/tasks/abc.json');
      expect(P.tasksDir(tmpDir)).toBe(path.join(tmpDir, '.yuva', 'run', 'tasks'));
    });
  });

  describe('migrate()', () => {
    it('moves .aiautomations config into .yuva/', () => {
      write('.aiautomations/config.json', '{"tool":"claude"}');
      write('.aiautomations/prompts/executoragent.md', 'prompt');

      P.migrate(tmpDir);

      expect(exists('.yuva/config.json')).toBe(true);
      expect(exists('.yuva/prompts/executoragent.md')).toBe(true);
      expect(exists('.aiautomations')).toBe(false);
      expect(fs.readFileSync(path.join(tmpDir, '.yuva', 'config.json'), 'utf8')).toBe('{"tool":"claude"}');
    });

    it('routes runtime files out of the config dir into .yuva/run/', () => {
      // telemetry.json used to sit beside the config but is generated data
      write('.aiautomations/telemetry.json', '{}');
      write('.aiautomations/config.json', '{}');

      P.migrate(tmpDir);

      expect(exists('.yuva/run/telemetry.json')).toBe(true);
      expect(exists('.yuva/telemetry.json')).toBe(false);
      expect(exists('.yuva/config.json')).toBe(true);
    });

    it('moves flat .yuva/ runtime into .yuva/run/', () => {
      write('.yuva/tasks/abc.json', '{}');
      write('.yuva/workers/w-1.json', '{}');
      write('.yuva/events.log', 'line\n');
      write('.yuva/costs.json', '{}');

      P.migrate(tmpDir);

      expect(exists('.yuva/run/tasks/abc.json')).toBe(true);
      expect(exists('.yuva/run/workers/w-1.json')).toBe(true);
      expect(exists('.yuva/run/events.log')).toBe(true);
      expect(exists('.yuva/run/costs.json')).toBe(true);
      expect(exists('.yuva/tasks')).toBe(false);
    });

    it('moves a legacy .session/ directory into .yuva/run/session/', () => {
      write('.session/state.md', '# state');
      P.migrate(tmpDir);
      expect(exists('.yuva/run/session/state.md')).toBe(true);
      expect(exists('.session')).toBe(false);
    });

    it('never overwrites a file that already exists at the target', () => {
      write('.aiautomations/config.json', 'OLD');
      write('.yuva/config.json', 'NEW');

      P.migrate(tmpDir);

      expect(fs.readFileSync(path.join(tmpDir, '.yuva', 'config.json'), 'utf8')).toBe('NEW');
      // The un-migratable file is left behind rather than silently dropped
      expect(exists('.aiautomations/config.json')).toBe(true);
    });

    it('is idempotent', () => {
      write('.aiautomations/config.json', '{}');
      write('.yuva/tasks/abc.json', '{}');

      const first = P.migrate(tmpDir);
      const second = P.migrate(tmpDir);

      expect(first.length).toBeGreaterThan(0);
      expect(second).toEqual([]);
      expect(exists('.yuva/config.json')).toBe(true);
      expect(exists('.yuva/run/tasks/abc.json')).toBe(true);
    });
  });

  describe('needsMigration()', () => {
    it('is false for a clean new-layout project', () => {
      write('.yuva/config.json');
      write('.yuva/run/tasks/abc.json');
      expect(P.needsMigration(tmpDir)).toBe(false);
    });

    it('is true when .aiautomations/ is present', () => {
      write('.aiautomations/config.json');
      expect(P.needsMigration(tmpDir)).toBe(true);
    });

    it('is true when runtime still sits flat in .yuva/', () => {
      write('.yuva/events.log');
      expect(P.needsMigration(tmpDir)).toBe(true);
    });
  });

  describe('ensureGitignore()', () => {
    it('adds .yuva/run/ when no gitignore exists', () => {
      P.ensureGitignore(tmpDir);
      expect(fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8')).toContain('.yuva/run/');
    });

    it('drops a blanket .yuva/ ignore so config becomes committable', () => {
      write('.gitignore', 'node_modules/\n.yuva/\n');

      expect(P.ensureGitignore(tmpDir)).toBe(true);
      const content = fs.readFileSync(path.join(tmpDir, '.gitignore'), 'utf8');
      const lines = content.split(/\r?\n/).map(l => l.trim());

      expect(lines).not.toContain('.yuva/');
      expect(lines).toContain('.yuva/run/');
      expect(lines).toContain('node_modules/');
    });

    it('is a no-op once already correct', () => {
      write('.gitignore', 'node_modules/\n.yuva/run/\n');
      expect(P.ensureGitignore(tmpDir)).toBe(false);
    });
  });
});
