const { spawnSync } = require('child_process');
const { runPrompt, extractJSON, ensurePrintMode } = require('./loop-engine');

// Fallback order when no CLI is forced: most common headless-capable first.
const CANDIDATE_CLIS = ['claude', 'gemini', 'codex', 'opencode', 'aider'];

const PREFLIGHT_PROMPT = 'Reply with ONLY this exact JSON and nothing else: {"pong":true}';
const PREFLIGHT_TIMEOUT_MS = 2 * 60 * 1000;

const HINTS = {
  'not-installed': 'Install the CLI (or pick another with --cli <command>).',
  'not-authenticated': 'Open the CLI once interactively and log in / set the API key, then retry.',
  'timeout': 'The CLI started but never answered — check network/model access, or raise the timeout.',
  'bad-output': 'The CLI ran but returned no parseable JSON — it may not support headless print mode; try --cli "<tool> -p".',
};

/** Is the first token of a CLI command on PATH? */
function commandExists(cli) {
  const cmd = String(cli).trim().split(/\s+/)[0];
  if (!cmd) return false;
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    return spawnSync(probe, [cmd], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

/** Classify a failed runPrompt result into a reason + actionable hint. */
function diagnose(result) {
  const err = String(result.error || '');
  const combined = `${result.stdout || ''}\n${result.stderr || ''}\n${err}`;
  if (/ENOENT|not recognized|command not found|no such file/i.test(combined)) {
    return 'not-installed';
  }
  if (/log ?in|logged in|authenticat|unauthorized|forbidden|api.?key|credential|billing|credit/i.test(combined)) {
    return 'not-authenticated';
  }
  if (/timed out/i.test(err)) {
    return 'timeout';
  }
  return 'bad-output';
}

/**
 * Test that an AI CLI actually works headlessly: pipe a ping prompt through
 * print mode and expect JSON back. Returns { ok, cli, reason?, hint? }.
 */
async function preflight(cli, { cwd = process.cwd(), timeoutMs = PREFLIGHT_TIMEOUT_MS } = {}) {
  const command = ensurePrintMode(cli);
  const result = await runPrompt(command, PREFLIGHT_PROMPT, { cwd, timeoutMs });
  if (extractJSON(result.stdout)) {
    return { ok: true, cli };
  }
  const reason = diagnose(result);
  return { ok: false, cli, reason, hint: HINTS[reason] };
}

/**
 * Find a working headless AI CLI. Tries `configured` first, then the
 * candidate list, skipping CLIs that aren't installed and preflighting the
 * rest until one answers. Returns { cli|null, tried: [{cli, source, ok, reason?, hint?}] }.
 * existsFn/preflightFn are injectable for tests.
 */
async function resolveWorkingCli({
  configured = null,
  cwd = process.cwd(),
  timeoutMs = PREFLIGHT_TIMEOUT_MS,
  onEvent = () => {},
  existsFn = commandExists,
  preflightFn = preflight,
} = {}) {
  const tried = [];
  const seen = new Set();
  const candidates = [];
  if (configured) candidates.push({ cli: configured, source: 'configured tool' });
  for (const cli of CANDIDATE_CLIS) candidates.push({ cli, source: 'fallback' });

  for (const { cli, source } of candidates) {
    if (seen.has(cli)) continue;
    seen.add(cli);

    if (!existsFn(cli)) {
      tried.push({ cli, source, ok: false, reason: 'not-installed', hint: HINTS['not-installed'] });
      onEvent('warn', `${cli} — not installed, skipping`);
      continue;
    }

    onEvent('info', `testing ${cli} headlessly (${source})...`);
    const result = await preflightFn(cli, { cwd, timeoutMs });
    tried.push({ cli, source, ...result });
    if (result.ok) {
      return { cli, tried };
    }
    onEvent('warn', `${cli} failed preflight (${result.reason}) — ${result.hint || 'trying next'}`);
  }

  return { cli: null, tried };
}

module.exports = {
  CANDIDATE_CLIS,
  PREFLIGHT_PROMPT,
  PREFLIGHT_TIMEOUT_MS,
  HINTS,
  commandExists,
  diagnose,
  preflight,
  resolveWorkingCli,
};
