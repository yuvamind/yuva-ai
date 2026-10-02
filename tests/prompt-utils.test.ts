import { confirm, select } from '../lib/prompt-utils';

describe('prompt-utils', () => {
  describe('confirm', () => {
    it('should return true for "y" input', async () => {
      const result = await confirm('Use this?', { testInput: 'y' });
      expect(result).toBe(true);
    });

    it('should return true for empty input (default yes)', async () => {
      const result = await confirm('Use this?', { testInput: '' });
      expect(result).toBe(true);
    });

    it('should return false for "n" input', async () => {
      const result = await confirm('Use this?', { testInput: 'n' });
      expect(result).toBe(false);
    });
  });

  describe('select', () => {
    it('should return the selected option id', async () => {
      const options = [
        { id: 'claude', name: 'Claude Code', category: 'Commercial' },
        { id: 'cursor', name: 'Cursor', category: 'Commercial' },
      ];
      const result = await select('Pick a tool:', options, { testInput: '1' });
      expect(result).toBe('claude');
    });

    it('should return null for invalid input', async () => {
      const options = [
        { id: 'claude', name: 'Claude Code', category: 'Commercial' },
      ];
      const result = await select('Pick:', options, { testInput: '99' });
      expect(result).toBe(null);
    });
  });
});
