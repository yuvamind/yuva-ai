const { getWorkerRunFailure } = require('../lib/commands/worker');

describe('worker run result handling', () => {
  it('rejects a non-zero CLI exit even when the result has a success flag', () => {
    expect(getWorkerRunFailure({
      success: true,
      cliResult: { code: 1, error: 'CLI crashed' },
    })).toBe('CLI crashed');
  });

  it('rejects an isolated worker failure without a nested CLI result', () => {
    expect(getWorkerRunFailure({
      success: false,
      error: 'CLI exit code 1',
    })).toBe('CLI exit code 1');
  });

  it('accepts a zero exit code', () => {
    expect(getWorkerRunFailure({
      success: true,
      cliResult: { code: 0, error: null },
    })).toBeNull();
  });
});
