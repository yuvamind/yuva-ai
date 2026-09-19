const { log, box, info } = require('../colors');
const { readJSON } = require('../fs-utils');
const P = require('../paths');

function analyticsCommand() {
  const statsPath = P.telemetryFile(process.cwd());
  const stats = readJSON(statsPath);

  if (!stats) {
    info('No analytics data. Enable telemetry first: yuva telemetry on\n');
    return;
  }

  box('Yuva AI - Analytics Dashboard');

  const usage = stats.agentUsage || {};
  const totalUses = Object.values(usage).reduce((a, b) => a + b, 0);

  log('📈 Summary:', 'bright');
  log(`   Total agent activations: ${totalUses}`);
  log(`   Unique agents used: ${Object.keys(usage).length}`);
  log(`   Sessions started: ${stats.sessions || 0}`);
  log(`   Avg interactions/session: ${stats.sessions ? Math.round(totalUses / stats.sessions) : 0}\n`);

  if (totalUses > 0) {
    log('🏆 Top Agents:', 'bright');
    const sorted = Object.entries(usage).sort(([, a], [, b]) => b - a).slice(0, 10);
    const maxCount = sorted[0][1];
    const barWidth = 30;

    sorted.forEach(([agent, count]) => {
      const bar = '█'.repeat(Math.round((count / maxCount) * barWidth));
      const pct = Math.round((count / totalUses) * 100);
      log(`   ${agent.padEnd(20)} ${bar} ${count} (${pct}%)`);
    });
    log('');
  }

  const devAgents = ['requirements', 'riskassessment', 'planner', 'execution',
    'continuity', 'tester', 'reviewer', 'security', 'debugger', 'refactor', 'statemanager'];

  let devUses = 0, lifeUses = 0;
  for (const [agent, count] of Object.entries(usage)) {
    if (devAgents.some(d => agent.toLowerCase().includes(d))) {
      devUses += count;
    } else {
      lifeUses += count;
    }
  }

  if (totalUses > 0) {
    log('📊 Category Breakdown:', 'bright');
    const devPct = Math.round((devUses / totalUses) * 100);
    const lifePct = 100 - devPct;
    log(`   Development:    ${'█'.repeat(Math.round(devPct / 3))} ${devPct}% (${devUses} uses)`);
    log(`   Life/Personal:  ${'█'.repeat(Math.round(lifePct / 3))} ${lifePct}% (${lifeUses} uses)\n`);
  }
}

module.exports = analyticsCommand;
