const hookCommand = require('../lib/commands/hook');
const { decide } = hookCommand;

describe('hook decide() — PreToolUse decision logic', () => {
  it('denies Write into a protected directory', () => {
    const reason = decide({ tool_name: 'Write', tool_input: { file_path: '.yuva/run/tasks/1.json' }, cwd: 'C:/project' });
    expect(reason).toMatch(/protected yuva-ai directory/);
  });

  it('denies the forbidden bus-clearing commands', () => {
    const reason = decide({ tool_name: 'Bash', tool_input: { command: 'yuva swarm clear' }, cwd: 'C:/project' });
    expect(reason).toMatch(/wipes the shared task bus/);
  });

  it('allows a normal Edit to an ordinary source file', () => {
    const reason = decide({ tool_name: 'Edit', tool_input: { file_path: 'src/app.js', new_string: 'x' }, cwd: 'C:/project' });
    expect(reason).toBeNull();
  });

  it('allows tools it does not police (e.g. Read)', () => {
    const reason = decide({ tool_name: 'Read', tool_input: { file_path: '.yuva/run/loop.json' }, cwd: 'C:/project' });
    expect(reason).toBeNull();
  });

  it('falls back to process.cwd() when payload has no cwd', () => {
    expect(() => decide({ tool_name: 'Bash', tool_input: { command: 'ls' } })).not.toThrow();
  });
});
