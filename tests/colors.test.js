
const { colorize, log, success, warn, error, info } = require('../lib/colors');

describe('colors', () => {
  describe('colorize', () => {
    it('should wrap text in color codes', () => {
      const result = colorize('hello', 'green');
      expect(result).toContain('hello');
      // picocolors correctly disables ANSI output when the test runner is not
      // attached to a TTY; verify codes only when color output is enabled.
      if (process.stdout.isTTY || process.env.FORCE_COLOR) {
        expect(result).toContain('\x1b[');
      }
    });

    it('should handle unknown colors gracefully', () => {
      const result = colorize('hello', 'nonexistent');
      expect(result).toContain('hello');
    });
  });

  describe('log functions', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('log should output to console', () => {
      log('test message');
      expect(console.log).toHaveBeenCalled();
    });

    it('success should include message text', () => {
      success('done');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('done'));
    });

    it('warn should output warning', () => {
      warn('careful');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('careful'));
    });

    it('error should output error', () => {
      error('fail');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('fail'));
    });

    it('info should output info', () => {
      info('note');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('note'));
    });
  });
});
