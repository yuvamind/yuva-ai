#!/usr/bin/env node
/**
 * Child-process entry point for the visual gate.
 *
 * `runGates()` is synchronous and every caller depends on that, but the visual
 * gate is inherently async (spawn a server, drive a browser). Rather than make
 * the whole gate API async — a breaking change for hooks, swarm workers and
 * task completion — the parent runs this file with execFileSync and reads the
 * JSON verdict off stdout.
 *
 *   node lib/visual-runner.js <targetDir>
 *
 * Exit 0 = passed or skipped, 1 = failed. The final stdout line is JSON.
 */

const { runVisualGate, RESULT_PREFIX } = require('./visual-gate');

async function main() {
  const targetDir = process.argv[2] || process.cwd();
  let result;
  try {
    result = await runVisualGate(targetDir);
  } catch (err) {
    result = { status: 'failed', output: `Visual gate crashed: ${err && err.message}` };
  }

  // Screenshots/findings arrays stay out of the payload — the report file holds
  // them, and stdout is only a verdict channel.
  const payload = {
    status: result.status,
    output: result.output || null,
    reportPath: result.reportPath || null,
    errorCount: result.verdict ? result.verdict.errorCount : 0,
    warningCount: result.verdict ? result.verdict.warningCount : 0,
  };

  process.stdout.write(`\n${RESULT_PREFIX}${JSON.stringify(payload)}\n`);
  process.exit(result.status === 'failed' ? 1 : 0);
}

// Guard so the parent can require this file for its path without running it.
if (require.main === module) main();
