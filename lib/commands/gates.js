const path = require('path');
const { log, box, table } = require('../colors');
const { runPluginGates, formatPluginGates, BUILTIN_RULES } = require('../plugin-gates');

function gatesCommand(args = []) {
  const targetDir = process.cwd();
  const subcommand = args[0] || 'run';

  switch (subcommand) {
    case 'run':
      return runGates(targetDir);
    case 'list':
      return listGates(targetDir);
    default:
      return runGates(targetDir);
  }
}

function runGates(targetDir) {
  box('Plugin Gate Results');
  try {
    const result = runPluginGates(targetDir);
    const report = formatPluginGates(result);
    log(report);

    if (result.passed) {
      log('\n✅ All plugin gates passed.\n', 'green');
    } else {
      const failed = result.gates.filter(g => !g.passed);
      log(`\n❌ ${failed.length} gate(s) failed.\n`, 'red');
    }
  } catch (err) {
    log(`Plugin gates failed: ${err.message}\n`, 'red');
  }
}

function listGates(targetDir) {
  box('Available Plugin Gates');

  const rows = [];
  for (const [id, rule] of Object.entries(BUILTIN_RULES)) {
    rows.push([id, rule.name, rule.severity, 'built-in']);
  }

  // Check for custom gates
  const fs = require('fs');
  const gatesDir = path.join(targetDir, '.aiautomations', 'gates');
  if (fs.existsSync(gatesDir)) {
    const custom = fs.readdirSync(gatesDir).filter(f => f.endsWith('.js'));
    for (const f of custom) {
      try {
        const rule = require(path.join(gatesDir, f));
        rows.push([f.replace('.js', ''), rule.name || f, rule.severity || 'warning', 'custom']);
      } catch {
        rows.push([f.replace('.js', ''), f, 'error', 'custom (failed to load)']);
      }
    }
  }

  table(['ID', 'Name', 'Severity', 'Source'], rows);
  log('');
  log('To create a custom gate:', 'bright');
  log('  1. Create .aiautomations/gates/<name>.js');
  log('  2. Export: { name, description, severity, run(targetDir) => findings[] }');
  log('  3. Enable/disable in .aiautomations/config.json: { "pluginGates": { "<name>": true } }\n');
}

module.exports = gatesCommand;
