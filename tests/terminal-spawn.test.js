const { buildSpawnSpec, openTerminal } = require('../lib/terminal-spawn');
const { buildWorkerBootPrompt } = require('../lib/commands/worker');

describe('terminal-spawn', () => {
  describe('buildSpawnSpec()', () => {
    const cmd = 'yuva worker boot --role executor --cli claude';
    const opts = { title: 'yuva executor', cwd: 'C:\\proj' };

    it('windows: passes start arguments as argv, not a pre-quoted string', () => {
      // cmd.exe /s strips only the OUTERMOST quote pair, so a hand-built
      // `start "title" /D "dir" cmd /k "command"` string arrives mangled.
      // Passing argv entries keeps every argument intact.
      const spec = buildSpawnSpec('win32', cmd, opts);
      expect(spec.cmd).toBe('cmd.exe');
      expect(spec.args).toEqual(['/c', 'start', 'yuva executor', '/D', 'C:\\proj', 'cmd.exe', '/k', cmd]);
      expect(spec.options.shell).toBeUndefined();
      expect(spec.options.detached).toBe(true);
    });

    it('windows: opens a Windows Terminal tab when wt is available', () => {
      const spec = buildSpawnSpec('win32', cmd, { ...opts, terminal: 'wt' });
      expect(spec.cmd).toBe('wt.exe');
      expect(spec.args).toEqual(['-w', '0', 'new-tab', '--title', 'yuva executor', '-d', 'C:\\proj', 'cmd.exe', '/k', cmd]);
      expect(spec.options.detached).toBe(true);
    });

    it('macos: uses osascript with cd into the project dir', () => {
      const spec = buildSpawnSpec('darwin', cmd, { cwd: '/proj' });
      expect(spec.cmd).toBe('osascript');
      expect(spec.args[1]).toContain('cd /proj && ' + cmd);
    });

    it('linux: tries common terminal emulators in the project dir', () => {
      const spec = buildSpawnSpec('linux', cmd, { cwd: '/proj' });
      expect(spec.cmd).toBe('sh');
      expect(spec.args[1]).toContain('x-terminal-emulator');
      expect(spec.args[1]).toContain('gnome-terminal');
      expect(spec.args[1]).toContain(`cd '/proj' && ${cmd}`);
    });
  });

  describe('openTerminal()', () => {
    it('rejects commands containing double quotes', () => {
      expect(() => openTerminal('echo "hi"')).toThrow(/double quotes/);
    });

    it('reports failure instead of claiming success when the launcher is missing', async () => {
      // The old version returned true whenever spawn() did not throw
      // synchronously, so terminals that never opened were reported as opened.
      const result = await openTerminal('yuva worker next', {
        terminal: 'definitely-not-a-real-terminal',
        cwd: process.cwd(),
      });
      expect(result).toHaveProperty('ok');
      if (!result.ok) expect(typeof result.reason).toBe('string');
    });
  });
});

describe('buildWorkerBootPrompt()', () => {
  it('contains the role, the worker loop, and the same-directory rule', () => {
    const prompt = buildWorkerBootPrompt('tester');
    expect(prompt).toContain('role: tester');
    expect(prompt).toContain('yuva worker next --role tester');
    expect(prompt).toContain('yuva task done');
    expect(prompt).toContain('current working directory');
  });

  it('never contains double quotes (shell-safety)', () => {
    for (const role of ['executor', 'tester', 'reviewer', 'security', 'debugger']) {
      expect(buildWorkerBootPrompt(role)).not.toContain('"');
    }
  });
});
