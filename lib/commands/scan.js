const path = require('path');
const { log, box, table } = require('../colors');
const { analyzeCodebase, formatAnalysis } = require('../code-analyzer');
const { NeuralGraph } = require('../neural-graph');
const { GraphBuilder } = require('../graph-builder');
const { runSecurityScan, formatSecurityReport } = require('../security-scanner');

function scanCommand(args = []) {
  const targetDir = process.cwd();
  const subcommand = args[0] || 'all';

  switch (subcommand) {
    case 'code':
    case 'analyze':
      return runCodeAnalysis(targetDir);
    case 'security':
    case 'sec':
      return runSecScan(targetDir);
    case 'all':
    default:
      return runCodeAnalysis(targetDir) + runSecScan(targetDir);
  }
}

function runCodeAnalysis(targetDir) {
  box('Codebase Analysis');
  try {
    const analysis = analyzeCodebase(targetDir);
    const report = formatAnalysis(analysis);
    log(report);

    // Feed analysis into the neural graph
    try {
      const graph = new NeuralGraph(targetDir);
      graph.load();
      graph.learnFromAnalysis(analysis);
      graph.save();
      log('\n✅ Neural graph updated with analysis results.', 'green');
    } catch {}

    return report;
  } catch (err) {
    log(`Analysis failed: ${err.message}`, 'red');
    return '';
  }
}

function runSecScan(targetDir) {
  box('Security Scan');
  try {
    const scan = runSecurityScan(targetDir);
    const report = formatSecurityReport(scan);
    log(report);

    if (scan.summary.critical > 0) {
      log(`\n⚠️  ${scan.summary.critical} CRITICAL findings — fix before deploying!\n`, 'red');
    } else if (scan.summary.high > 0) {
      log(`\n⚠️  ${scan.summary.high} HIGH severity findings found.\n`, 'yellow');
    } else if (scan.summary.total === 0) {
      log('\n✅ No security issues found.\n', 'green');
    }
    return report;
  } catch (err) {
    log(`Security scan failed: ${err.message}`, 'red');
    return '';
  }
}

module.exports = scanCommand;
