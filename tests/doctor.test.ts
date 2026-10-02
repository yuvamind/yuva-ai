import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

// The compiled entry point, not the .ts source: this is spawned as a real
// child process with `node`, which cannot execute TypeScript. `npm test`
// runs the build first (see the pretest script).
const CLI = path.resolve('dist/bin/cli.js');

describe('doctor command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-doctor-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs without crashing when the project is not initialized', () => {
    let exitCode: number | undefined = 0;
    try {
      execFileSync(process.execPath, [CLI, 'doctor'], {
        cwd: tmpDir,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: '0' },
      });
    } catch (caught) {
      const err = caught as { status?: number; stdout?: string };
      exitCode = err.status;
      expect(err.stdout).toContain('AGENTS.md missing');
    }

    expect(exitCode).toBe(1);
  });
});
