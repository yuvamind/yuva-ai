const { log, box, success, warn, info, table } = require('../colors');
const { fileExists, readJSON, writeJSON } = require('../fs-utils');
const P = require('../paths');

function telemetryCommand(args = []) {
  const action = args[0];

  switch (action) {
    case 'on': return enableTelemetry();
    case 'off': return disableTelemetry();
    case 'status': return showStatus();
    case 'stats': return showStats();
    case 'reset': return resetStats();
    default: showTelemetryHelp();
  }
}

function showTelemetryHelp() {
  box('Yuva AI - Telemetry');
  log('Anonymous, opt-in usage analytics.\n', 'bright');
  log('Usage:', 'bright');
  log('   yuva telemetry on        Enable telemetry');
  log('   yuva telemetry off       Disable telemetry');
  log('   yuva telemetry status    Show current status');
  log('   yuva telemetry stats     Show usage statistics');
  log('   yuva telemetry reset     Reset collected data\n');
  log('All data is stored locally. Nothing is sent externally.\n', 'dim');
}

function getConfigPath() {
  return P.configFile(process.cwd());
}

function getStatsPath() {
  return P.telemetryFile(process.cwd());
}

function enableTelemetry() {
  const configPath = getConfigPath();
  const config = readJSON(configPath) || {};
  config.telemetry = true;
  writeJSON(configPath, config);

  const statsPath = getStatsPath();
  if (!fileExists(statsPath)) {
    writeJSON(statsPath, {
      enabled: true,
      startedAt: new Date().toISOString(),
      agentUsage: {},
      sessions: 0,
      totalInteractions: 0,
      workflowsRun: 0,
      lastActive: null
    });
  }

  success('Telemetry enabled. All data stays local.\n');
}

function disableTelemetry() {
  const configPath = getConfigPath();
  const config = readJSON(configPath) || {};
  config.telemetry = false;
  writeJSON(configPath, config);
  success('Telemetry disabled.\n');
}

function showStatus() {
  const configPath = getConfigPath();
  const config = readJSON(configPath) || {};
  const enabled = config.telemetry === true;

  box('Telemetry Status');
  log(`   Status: ${enabled ? '✅ Enabled' : '❌ Disabled'}`);
  log(`   Data: Stored locally only`);
  log(`   Location: .yuva/telemetry.json\n`);
}

function showStats() {
  const statsPath = getStatsPath();
  const stats = readJSON(statsPath);

  if (!stats) {
    warn('No telemetry data collected yet.');
    info('Enable with: yuva telemetry on\n');
    return;
  }

  box('Usage Statistics');

  log('📊 Overview:', 'bright');
  log(`   Sessions: ${stats.sessions || 0}`);
  log(`   Total Interactions: ${stats.totalInteractions || 0}`);
  log(`   Workflows Run: ${stats.workflowsRun || 0}`);
  log(`   Tracking Since: ${stats.startedAt ? new Date(stats.startedAt).toLocaleDateString() : 'N/A'}`);
  log(`   Last Active: ${stats.lastActive ? new Date(stats.lastActive).toLocaleDateString() : 'N/A'}\n`);

  if (stats.agentUsage && Object.keys(stats.agentUsage).length > 0) {
    log('🤖 Agent Usage:', 'bright');
    const sorted = Object.entries(stats.agentUsage)
      .sort(([, a], [, b]) => b - a);

    const rows = sorted.map(([agent, count]) => [agent, count.toString()]);
    table(['Agent', 'Uses'], rows);
    log('');
  } else {
    info('No agent usage data yet.\n');
  }
}

function resetStats() {
  const statsPath = getStatsPath();
  if (fileExists(statsPath)) {
    writeJSON(statsPath, {
      enabled: true,
      startedAt: new Date().toISOString(),
      agentUsage: {},
      sessions: 0,
      totalInteractions: 0,
      workflowsRun: 0,
      lastActive: null
    });
    success('Telemetry data reset.\n');
  } else {
    warn('No telemetry data to reset.\n');
  }
}

function recordAgentUsage(agentName) {
  const statsPath = getStatsPath();
  const stats = readJSON(statsPath);
  if (!stats || !stats.enabled) return;

  if (!stats.agentUsage) stats.agentUsage = {};
  stats.agentUsage[agentName] = (stats.agentUsage[agentName] || 0) + 1;
  stats.totalInteractions = (stats.totalInteractions || 0) + 1;
  stats.lastActive = new Date().toISOString();
  writeJSON(statsPath, stats);
}

function recordSession() {
  const statsPath = getStatsPath();
  const stats = readJSON(statsPath);
  if (!stats || !stats.enabled) return;

  stats.sessions = (stats.sessions || 0) + 1;
  stats.lastActive = new Date().toISOString();
  writeJSON(statsPath, stats);
}

module.exports = telemetryCommand;
module.exports.recordAgentUsage = recordAgentUsage;
module.exports.recordSession = recordSession;
