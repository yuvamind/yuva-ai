const path = require('path');
const fs = require('fs');
const { log, box } = require('../colors');
const { CostTracker } = require('../cost-tracker');

function costCommand(args = []) {
  const targetDir = process.cwd();
  const busDir = path.join(targetDir, '.yuva');
  const subcommand = args[0] || 'show';

  switch (subcommand) {
    case 'show':
    case 'status':
      return showCosts(busDir);
    case 'set-budget':
      return setBudget(busDir, args[1]);
    case 'reset':
      return resetCosts(busDir);
    default:
      return showCosts(busDir);
  }
}

function showCosts(busDir) {
  box('Cost Tracking');
  const tracker = new CostTracker(busDir);
  const summary = tracker.getSummary();

  if (summary.totalCalls === 0) {
    log('No AI calls recorded yet.\n');
    return;
  }

  log(tracker.formatSummary());

  if (summary.recentCalls.length > 0) {
    log('\nRecent Calls:', 'bright');
    for (const call of summary.recentCalls) {
      const status = call.success ? '✅' : '❌';
      const cost = call.estimatedCost > 0 ? `$${call.estimatedCost}` : 'free';
      const duration = call.durationMs ? `${Math.round(call.durationMs / 1000)}s` : '-';
      log(`  ${status} ${call.cli || 'unknown'} — ${cost} — ${duration}`);
    }
    log('');
  }
}

function setBudget(busDir, amount) {
  if (!amount) {
    log('Usage: yuva cost set-budget <amount-usd>', 'red');
    return;
  }
  const limit = parseFloat(amount);
  if (isNaN(limit) || limit <= 0) {
    log('Budget must be a positive number (in USD)', 'red');
    return;
  }
  const tracker = new CostTracker(busDir);
  tracker.setBudgetLimit(limit);
  log(`Budget set to $${limit}`, 'green');
  log(`Current spend: $${tracker.getSummary().totalEstimatedCost}`, 'bright');
  log(`Remaining: $${tracker.getRemainingBudget().toFixed(2)}\n`);
}

function resetCosts(busDir) {
  const tracker = new CostTracker(busDir);
  tracker.reset();
  log('Cost tracking reset.\n', 'green');
}

module.exports = costCommand;
