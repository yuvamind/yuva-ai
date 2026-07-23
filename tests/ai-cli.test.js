const { commandExists, diagnose, resolveWorkingCli, CANDIDATE_CLIS, HINTS } = require('../lib/ai-cli');

describe('commandExists()', () => {
  it('finds a command that is on PATH', () => {
    expect(commandExists('node')).toBe(true);
    expect(commandExists('node --some-flag')).toBe(true); // only first token is probed
  });

  it('rejects commands that are not installed or empty', () => {
    expect(commandExists('definitely-not-a-real-cli-xyz')).toBe(false);
    expect(commandExists('')).toBe(false);
  });
});

describe('diagnose()', () => {
  it('detects a missing binary', () => {
    expect(diagnose({ error: 'spawn claude ENOENT' })).toBe('not-installed');
    expect(diagnose({ stderr: "'gemini' is not recognized as an internal or external command" })).toBe('not-installed');
  });

  it('detects authentication problems', () => {
    expect(diagnose({ stdout: 'Please run /login to authenticate' })).toBe('not-authenticated');
    expect(diagnose({ stderr: 'Invalid API key provided' })).toBe('not-authenticated');
  });

  it('detects timeouts', () => {
    expect(diagnose({ error: 'AI CLI timed out after 2 minutes' })).toBe('timeout');
  });

  it('falls back to bad-output', () => {
    expect(diagnose({ stdout: 'some random text', error: 'exit code 1' })).toBe('bad-output');
  });

  it('every reason has an actionable hint', () => {
    for (const reason of ['not-installed', 'not-authenticated', 'timeout', 'bad-output']) {
      expect(HINTS[reason]).toBeTruthy();
    }
  });
});

describe('resolveWorkingCli()', () => {
  it('returns the configured CLI when it passes preflight', async () => {
    const { cli, tried } = await resolveWorkingCli({
      configured: 'mytool',
      existsFn: () => true,
      preflightFn: async (c) => ({ ok: true, cli: c }),
    });
    expect(cli).toBe('mytool');
    expect(tried.length).toBe(1);
  });

  it('falls back through candidates when earlier CLIs fail', async () => {
    const attempts = [];
    const { cli } = await resolveWorkingCli({
      configured: 'claude', // also first candidate — must be deduped
      existsFn: (c) => c !== 'gemini', // gemini not installed
      preflightFn: async (c) => {
        attempts.push(c);
        return c === 'codex'
          ? { ok: true, cli: c }
          : { ok: false, cli: c, reason: 'not-authenticated', hint: HINTS['not-authenticated'] };
      },
    });
    expect(cli).toBe('codex');
    expect(attempts).toEqual(['claude', 'codex']); // gemini skipped, claude tried once
  });

  it('returns null with full diagnostics when nothing works', async () => {
    const { cli, tried } = await resolveWorkingCli({
      existsFn: () => false,
      preflightFn: async () => { throw new Error('should not be called'); },
    });
    expect(cli).toBeNull();
    expect(tried.length).toBe(CANDIDATE_CLIS.length);
    expect(tried.every(t => t.reason === 'not-installed')).toBe(true);
  });
});
