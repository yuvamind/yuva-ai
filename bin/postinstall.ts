#!/usr/bin/env node

const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof COLORS = 'reset') {
  console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function postinstall() {
  // Skip for global installs
  if (process.env.npm_config_global === 'true') return;

  // Skip if not inside node_modules
  const path = require('path') as typeof import('path');
  const parentDir = path.dirname(path.dirname(__dirname));
  if (path.basename(parentDir) !== 'node_modules') return;

  log('\n  Yuva AI installed successfully!', 'green');
  log('  Run "npx yuva init" to set up your project.\n', 'cyan');
}

postinstall();
