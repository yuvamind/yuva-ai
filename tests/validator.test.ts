
import { validateAgentName, validateCommand } from '../lib/validator';

describe('validator', () => {
  describe('validateAgentName', () => {
    it('should accept valid names', () => {
      expect(validateAgentName('my-agent').valid).toBe(true);
      expect(validateAgentName('test').valid).toBe(true);
      expect(validateAgentName('agent123').valid).toBe(true);
    });

    it('should reject empty names', () => {
      expect(validateAgentName('').valid).toBe(false);
      expect(validateAgentName(null).valid).toBe(false);
      expect(validateAgentName(undefined).valid).toBe(false);
    });

    it('should reject names starting with numbers', () => {
      expect(validateAgentName('123agent').valid).toBe(false);
    });

    it('should reject names with uppercase', () => {
      expect(validateAgentName('MyAgent').valid).toBe(false);
    });

    it('should reject names that are too long', () => {
      expect(validateAgentName('a'.repeat(51)).valid).toBe(false);
    });
  });

  describe('validateCommand', () => {
    it('should accept valid commands', () => {
      expect(validateCommand('init', ['init', 'help']).valid).toBe(true);
    });

    it('should reject invalid commands', () => {
      expect(validateCommand('unknown', ['init', 'help']).valid).toBe(false);
    });

    it('should reject empty commands', () => {
      expect(validateCommand('', ['init']).valid).toBe(false);
    });
  });
});
