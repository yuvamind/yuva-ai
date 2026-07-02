const path = require('path');
const { log, box, success, warn } = require('../colors');
const { readJSON, writeJSON } = require('../fs-utils');

const DEFAULTS = {
  llm: 'claude',
  theme: 'default',
  telemetry: false,
  autoUpdate: true,
  sessionPersistence: true,
  verbose: false,
  mode: 'swarm' // 'swarm' (multi-terminal, default) or 'solo'
};

function configCommand(args = []) {
  const targetDir = process.cwd();
  const configPath = path.join(targetDir, '.aiautomations', 'config.json');

  box('Yuva AI - Configuration');

  if (args.length === 0) {
    const config = readJSON(configPath) || DEFAULTS;
    log('Current configuration:\n', 'bright');
    for (const [key, value] of Object.entries({ ...DEFAULTS, ...config })) {
      log(`   ${key}: ${JSON.stringify(value)}`);
    }
    log('\nUsage:', 'bright');
    log('   yuva config set <key> <value>');
    log('   yuva config get <key>');
    log('   yuva config reset\n');
    return;
  }

  const action = args[0];

  if (action === 'set' && args.length >= 3) {
    const key = args[1];
    let value = args.slice(2).join(' ');

    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (!isNaN(value) && value !== '') value = Number(value);

    const config = readJSON(configPath) || {};
    config[key] = value;
    writeJSON(configPath, config);
    success(`Set ${key} = ${JSON.stringify(value)}\n`);
  } else if (action === 'get' && args[1]) {
    const config = readJSON(configPath) || DEFAULTS;
    const value = config[args[1]] !== undefined ? config[args[1]] : DEFAULTS[args[1]];
    log(`${args[1]}: ${JSON.stringify(value)}\n`);
  } else if (action === 'reset') {
    writeJSON(configPath, DEFAULTS);
    success('Configuration reset to defaults.\n');
  } else {
    warn('Usage: yuva config [set <key> <value> | get <key> | reset]\n');
  }
}

module.exports = configCommand;
