const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const CLI = path.resolve('bin/cli.js');

describe('doctor command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-doctor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs without crashing when the project is not initialized', () => {
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [CLI, 'doctor'], {
        cwd: tmpDir,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
      });
    } catch (err) {
      exitCode = err.status;
      expect(err.stdout).toContain('AGENTS.md missing');
    }

    expect(exitCode).toBe(1);
  });
});
