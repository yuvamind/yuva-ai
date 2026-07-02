const { parseFlags } = require('../lib/arg-utils');

describe('parseFlags', () => {
  it('separates positionals from flag values', () => {
    const { positional, flags } = parseFlags(['add', 'Build login', '--role', 'executor', '--priority', '5']);
    expect(positional).toEqual(['add', 'Build login']);
    expect(flags.role).toBe('executor');
    expect(flags.priority).toBe('5');
  });

  it('treats trailing flags without values as booleans', () => {
    const { flags } = parseFlags(['start', '--auto']);
    expect(flags.auto).toBe(true);
  });

  it('does not consume the next arg for declared boolean flags', () => {
    const { positional, flags } = parseFlags(['start', '--auto', 'extra'], { booleans: ['auto'] });
    expect(flags.auto).toBe(true);
    expect(positional).toEqual(['start', 'extra']);
  });

  it('handles empty input', () => {
    expect(parseFlags([])).toEqual({ positional: [], flags: {} });
    expect(parseFlags()).toEqual({ positional: [], flags: {} });
  });
});
