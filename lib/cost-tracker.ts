import fs from 'fs';
import path from 'path';
import { debug } from './debug';

/**
 * Cost tracking for AI CLI invocations.
 * Tracks token usage, estimates cost, enforces budget limits.
 */

// Approximate cost per 1M tokens (input + output averaged) for common models
const MODEL_COSTS = {
  'claude-sonnet-4': { input: 3.0, output: 15.0 },
  'claude-3.5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gemini-1.5-pro': { input: 3.5, output: 10.5 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'deepseek-v3': { input: 0.27, output: 1.1 },
  'codestral': { input: 0.3, output: 0.9 },
  'default': { input: 3.0, output: 15.0 }, // conservative estimate
};

// Approximate tokens per character (English text)
const CHARS_PER_TOKEN = 4;

/** One recorded AI CLI invocation, as persisted in costs.json. */
export interface CostCall {
  timestamp: string;
  cli: string;
  task: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  /** True when the CLI reported a real cost rather than one estimated from chars. */
  measured: boolean;
  durationMs: number | null;
  success: boolean;
}

/** The whole ledger: running totals plus the last 100 calls. */
export interface CostLedger {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  calls: CostCall[];
  budgetLimit: number | null;
  startedAt: string;
}

export interface CostTrackerOptions {
  budgetLimit?: number | null;
  model?: string;
}

export interface RecordCallInput {
  cli: string;
  promptChars?: number;
  outputChars?: number;
  task?: string | null;
  durationMs?: number | null;
  success?: boolean;
  /** Exact counts from the CLI, when it reports them; otherwise estimated. */
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ModelPricing {
  input: number;
  output: number;
}

class CostTracker {
  busDir: string;
  costFile: string;
  budgetLimit: number | null;
  model: string;
  costs: CostLedger;

  constructor(busDir: string, options: CostTrackerOptions = {}) {
    this.busDir = busDir;
    this.costFile = path.join(busDir, 'costs.json');
    this.budgetLimit = options.budgetLimit || null; // in USD
    this.model = options.model || 'default';
    this.costs = this._load();
  }

  _load(): CostLedger {
    try {
      return JSON.parse(fs.readFileSync(this.costFile, 'utf8'));
    } catch (err) {
      debug('cost-tracker', 'failed to load costs file', err);
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalEstimatedCost: 0,
        calls: [],
        budgetLimit: this.budgetLimit,
        startedAt: new Date().toISOString(),
      };
    }
  }

  _save(): void {
    try {
      fs.mkdirSync(this.busDir, { recursive: true });
      fs.writeFileSync(this.costFile, JSON.stringify(this.costs, null, 2) + '\n');
    } catch {}
  }

  /**
   * Record a CLI invocation. Estimates tokens from output length.
   */
  /**
   * Record one call.
   *
   * Characters are estimated into tokens when that is all the caller has. A
   * caller that knows the real figures — a tool that reports its own token
   * counts and spend, such as the `e2e` runner — passes `inputTokens`,
   * `outputTokens` and/or `costUsd` instead, and they are used verbatim.
   * Pushing a known cost through a character estimator would throw away the
   * one accurate number in the system.
   */
  recordCall({ cli, promptChars, outputChars, task, durationMs, success,
    inputTokens: knownInput, outputTokens: knownOutput, costUsd }: RecordCallInput) {
    const modelPricing: ModelPricing = (MODEL_COSTS as Record<string, ModelPricing>)[this.model] || MODEL_COSTS['default'];

    const inputTokens = typeof knownInput === 'number' && Number.isFinite(knownInput)
      ? knownInput
      : Math.ceil((promptChars || 0) / CHARS_PER_TOKEN);
    const outputTokens = typeof knownOutput === 'number' && Number.isFinite(knownOutput)
      ? knownOutput
      : Math.ceil((outputChars || 0) / CHARS_PER_TOKEN);

    const inputCost = (inputTokens / 1_000_000) * modelPricing.input;
    const outputCost = (outputTokens / 1_000_000) * modelPricing.output;
    // typeof guards added for the type checker only: Number.isFinite already
    // rejects undefined at runtime, but TS does not treat it as a narrowing.
    const totalCost = typeof costUsd === 'number' && Number.isFinite(costUsd) ? costUsd : inputCost + outputCost;

    this.costs.totalInputTokens += inputTokens;
    this.costs.totalOutputTokens += outputTokens;
    this.costs.totalEstimatedCost += totalCost;

    this.costs.calls.push({
      timestamp: new Date().toISOString(),
      cli,
      task: task || null,
      inputTokens,
      outputTokens,
      estimatedCost: Math.round(totalCost * 10000) / 10000,
      measured: Number.isFinite(costUsd),
      durationMs: durationMs || null,
      success: success !== false,
    });

    // Keep only last 100 calls to avoid unbounded growth
    if (this.costs.calls.length > 100) {
      this.costs.calls = this.costs.calls.slice(-100);
    }

    this._save();
    return { inputTokens, outputTokens, cost: totalCost, totalCost: this.costs.totalEstimatedCost };
  }

  /**
   * Check if budget is exceeded.
   */
  isOverBudget(): boolean {
    if (!this.costs.budgetLimit) return false;
    return this.costs.totalEstimatedCost >= this.costs.budgetLimit;
  }

  /**
   * Get remaining budget in USD.
   */
  getRemainingBudget(): number | null {
    if (!this.costs.budgetLimit) return Infinity;
    return Math.max(0, this.costs.budgetLimit - this.costs.totalEstimatedCost);
  }

  /**
   * Update the budget limit.
   */
  setBudgetLimit(limit: number | null): void {
    this.costs.budgetLimit = limit;
    this.budgetLimit = limit;
    this._save();
  }

  /**
   * Get a summary of costs.
   */
  getSummary() {
    const calls = this.costs.calls || [];
    const successfulCalls = calls.filter(c => c.success);
    const failedCalls = calls.filter(c => !c.success);
    const totalDuration = calls.reduce((sum, c) => sum + (c.durationMs || 0), 0);

    return {
      totalCalls: calls.length,
      successfulCalls: successfulCalls.length,
      failedCalls: failedCalls.length,
      totalInputTokens: this.costs.totalInputTokens,
      totalOutputTokens: this.costs.totalOutputTokens,
      totalEstimatedCost: Math.round(this.costs.totalEstimatedCost * 100) / 100,
      budgetLimit: this.costs.budgetLimit,
      remainingBudget: this.getRemainingBudget(),
      isOverBudget: this.isOverBudget(),
      totalDurationMs: totalDuration,
      avgCostPerCall: calls.length > 0 ? Math.round((this.costs.totalEstimatedCost / calls.length) * 100) / 100 : 0,
      recentCalls: calls.slice(-5),
    };
  }

  /**
   * Format cost summary as markdown.
   */
  formatSummary(): string {
    const s = this.getSummary();
    const lines = [];
    lines.push('## Cost Tracking');
    lines.push('');
    lines.push(`- **Total Calls:** ${s.totalCalls} (${s.successfulCalls} ok, ${s.failedCalls} failed)`);
    lines.push(`- **Tokens Used:** ${(s.totalInputTokens + s.totalOutputTokens).toLocaleString()} (in: ${s.totalInputTokens.toLocaleString()}, out: ${s.totalOutputTokens.toLocaleString()})`);
    lines.push(`- **Estimated Cost:** $${s.totalEstimatedCost}`);
    if (s.budgetLimit) {
      // `?? 0` is for the type checker: remainingBudget is only null when
      // budgetLimit is null, and this branch is guarded on budgetLimit above.
      lines.push(`- **Budget:** $${s.budgetLimit} ($${(s.remainingBudget ?? 0).toFixed(2)} remaining)`);
      if (s.isOverBudget) lines.push(`- **⚠️ OVER BUDGET** — further AI calls will be blocked`);
    }
    lines.push(`- **Total Duration:** ${Math.round(s.totalDurationMs / 60000)} minutes`);
    lines.push(`- **Avg Cost/Call:** $${s.avgCostPerCall}`);
    return lines.join('\n');
  }

  /**
   * Reset cost tracking.
   */
  reset(): void {
    this.costs = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalEstimatedCost: 0,
      calls: [],
      budgetLimit: this.budgetLimit,
      startedAt: new Date().toISOString(),
    };
    this._save();
  }
}

export { CostTracker, MODEL_COSTS, CHARS_PER_TOKEN };