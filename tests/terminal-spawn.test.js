const { buildSpawnSpec, openTerminal } = require('../lib/terminal-spawn');
const { buildWorkerBootPrompt } = require('../lib/commands/worker');

describe('terminal-spawn', () => {
  describe('buildSpawnSpec()', () => {
    const cmd = 'yuva worker boot --role executor --cli claude';
    const opts = { title: 'yuva executor', cwd: 'C:\\proj' };

    it('windows: uses start with title and working directory', () => {
      const spec = buildSpawnSpec('win32', cmd, opts);
      expect(spec.cmd).toContain('start "yuva executor"');
      expect(spec.cmd).toContain('/D "C:\\proj"');
      expect(spec.cmd).toContain(`cmd /k "${cmd}"`);
      expect(spec.options.shell).toBe(true);
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
