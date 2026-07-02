const path = require('path');
const fs = require('fs');
const os = require('os');
const { detectGates, runGates } = require('../lib/gate-runner');

function writeJSON(dir, name, data) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
}

describe('gate-runner', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-gate-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectGates()', () => {
    it('detects gates from package.json scripts', () => {
      writeJSON(tmpDir, 'package.json', {
        scripts: { lint: 'eslint .', test: 'vitest run', build: 'tsc' },
      });
      const gates = detectGates(tmpDir);
      const names = gates.map(g => g.name);
      expect(names).toContain('lint');
      expect(names).toContain('test');
      expect(names).toContain('build');
    });

    it('skips the npm default test script', () => {
      writeJSON(tmpDir, 'package.json', {
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      });
      expect(detectGates(tmpDir).map(g => g.name)).not.toContain('test');
    });

    it('returns empty when nothing is detectable', () => {
      expect(detectGates(tmpDir)).toEqual([]);
    });

    it('honors config overrides, including disabling a gate', () => {
      writeJSON(tmpDir, 'package.json', {
        scripts: { lint: 'eslint .', test: 'vitest run' },
      });
      fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
      writeJSON(path.join(tmpDir, '.aiautomations'), 'config.json', {
        gates: { test: false, lint: 'custom-lint', e2e: 'run-e2e' },
      });

      const gates = detectGates(tmpDir);
      const names = gates.map(g => g.name);
      expect(names).not.toContain('test');
      expect(gates.find(g => g.name === 'lint').command).toBe('custom-lint');
      expect(names).toContain('e2e');
    });
  });

  describe('runGates()', () => {
    it('passes when all gate commands exit 0', () => {
      fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
      writeJSON(path.join(tmpDir, '.aiautomations'), 'config.json', {
        gates: { lint: 'node -e "process.exit(0)"' },
      });

      const result = runGates(tmpDir);
      expect(result.passed).toBe(true);
      expect(result.gates[0].status).toBe('passed');
      expect(result.gates[0].output).toBeNull();
    });

    it('fails and captures output when a gate exits non-zero', () => {
      fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
      writeJSON(path.join(tmpDir, '.aiautomations'), 'config.json', {
        gates: { test: 'node -e "console.error(\'boom\'); process.exit(1)"' },
      });

      const result = runGates(tmpDir);
      expect(result.passed).toBe(false);
      expect(result.gates[0].status).toBe('failed');
      expect(result.gates[0].output).toContain('boom');
    });

    it('runs only the requested subset', () => {
      fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
      writeJSON(path.join(tmpDir, '.aiautomations'), 'config.json', {
        gates: {
          lint: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(1)"',
        },
      });

      const result = runGates(tmpDir, { only: ['lint'] });
      expect(result.passed).toBe(true);
      expect(result.gates.length).toBe(1);
      expect(result.gates[0].name).toBe('lint');
    });
  });
});
