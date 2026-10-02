import os from 'os';
import fs from 'fs';
import path from 'path';
import { detectTool, commandExists } from '../lib/detect-tool';

describe('commandExists()', () => {
  it('finds a command that is on PATH', () => {
    expect(commandExists('node')).toBe(true);
  });

  it('returns false for a command that does not exist', () => {
    expect(commandExists('definitely-not-a-real-cli-xyz')).toBe(false);
  });
});

describe('detectTool()', () => {
  const ENV_KEYS = ['CURSOR_TRACE_ID', 'CURSOR_SESSION', 'VSCODE_GIT_ASKPASS_MAIN', 'CODEX_ENV'];
  let savedEnv: Record<string, string | undefined>;
  let tmpDir: string;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-detect-tool-'));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects cursor via CURSOR_TRACE_ID env var', () => {
    process.env.CURSOR_TRACE_ID = '1';
    expect(detectTool(tmpDir)).toBe('cursor');
  });

  it('detects claude via VSCODE_GIT_ASKPASS_MAIN env var', () => {
    process.env.VSCODE_GIT_ASKPASS_MAIN = '/some/path';
    expect(detectTool(tmpDir)).toBe('claude');
  });

  it('detects codex via CODEX_ENV env var', () => {
    process.env.CODEX_ENV = '1';
    expect(detectTool(tmpDir)).toBe('codex');
  });

  it('detects tool from an existing config file when no env var is set', () => {
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cursor', 'rules'), '');
    expect(detectTool(tmpDir)).toBe('cursor');
  });

  it('prefers env vars over config files', () => {
    process.env.CODEX_ENV = '1';
    fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cursor', 'rules'), '');
    expect(detectTool(tmpDir)).toBe('codex');
  });

  it('falls back to claude when nothing else matches', () => {
    // Neutralize PATH so commandExists() can't find any real CLI on this
    // machine (e.g. antigravity/claude may genuinely be installed here) —
    // otherwise this test would pass or fail based on the dev machine's setup.
    const savedPath = process.env.PATH;
    process.env.PATH = tmpDir; // empty dir, contains no executables
    try {
      expect(detectTool(tmpDir)).toBe('claude');
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
