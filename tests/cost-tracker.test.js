const fs = require('fs');
const path = require('path');
const os = require('os');
const { CostTracker } = require('../lib/cost-tracker');

describe('CostTracker', () => {
  let tmpDir;
  let tracker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
    tracker = new CostTracker(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('recordCall()', () => {
    it('should record a call with estimated cost', () => {
      const result = tracker.recordCall({
        cli: 'claude -p',
        promptChars: 10000,
        outputChars: 5000,
        task: 'test-task',
        success: true,
      });

      expect(result.inputTokens).toBeGreaterThan(0);
      expect(result.outputTokens).toBeGreaterThan(0);
      expect(result.cost).toBeGreaterThan(0);
    });

    it('should accumulate totals', () => {
      tracker.recordCall({ cli: 'claude', promptChars: 10000, outputChars: 5000, success: true });
      tracker.recordCall({ cli: 'claude', promptChars: 20000, outputChars: 10000, success: true });

      const summary = tracker.getSummary();
      expect(summary.totalCalls).toBe(2);
      expect(summary.successfulCalls).toBe(2);
      expect(summary.totalEstimatedCost).toBeGreaterThan(0);
    });
  });

  describe('budget management', () => {
    it('should track budget limits', () => {
      tracker.setBudgetLimit(10.0);
      expect(tracker.isOverBudget()).toBe(false);
      expect(tracker.getRemainingBudget()).toBe(10.0);
    });

    it('should detect over-budget', () => {
      tracker.setBudgetLimit(0.001);
      tracker.recordCall({ cli: 'claude', promptChars: 100000, outputChars: 50000, success: true });
      // Cost should exceed $0.001
      expect(tracker.isOverBudget()).toBe(true);
    });

    it('should return Infinity when no budget set', () => {
      expect(tracker.getRemainingBudget()).toBe(Infinity);
    });
  });

  describe('getSummary()', () => {
    it('should return complete summary', () => {
      tracker.recordCall({ cli: 'claude', promptChars: 5000, outputChars: 2000, success: true });
      const summary = tracker.getSummary();

      expect(summary).toHaveProperty('totalCalls');
      expect(summary).toHaveProperty('totalInputTokens');
      expect(summary).toHaveProperty('totalOutputTokens');
      expect(summary).toHaveProperty('totalEstimatedCost');
      expect(summary).toHaveProperty('avgCostPerCall');
      expect(summary).toHaveProperty('recentCalls');
    });
  });

  describe('reset()', () => {
    it('should clear all data', () => {
      tracker.recordCall({ cli: 'claude', promptChars: 5000, outputChars: 2000, success: true });
      tracker.reset();
      const summary = tracker.getSummary();
      expect(summary.totalCalls).toBe(0);
    });
  });
});
