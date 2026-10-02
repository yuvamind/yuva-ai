/**
 * How the e2e agent authenticates — subscription first, API key last.
 *
 * Yuva drives AI *CLIs* (Claude Code, Codex, Gemini, OpenCode, Aider), which
 * people already pay for by subscription. Scaffolding an API-key config would
 * make a Yuva user buy a second, per-token way to pay for the same thing. So the
 * order here is deliberate:
 *
 *   1. a login e2e already holds        — nothing to do
 *   2. a subscription they already have — one `e2e login`, no key, no per-token bill
 *   3. a local model                    — free, offline, nothing leaves the machine
 *   4. an API key                       — last, and really only for CI
 *
 * One wrinkle worth stating plainly: e2e does **not** support Claude
 * subscriptions. A Claude Code user reaches Anthropic models through GitHub
 * Copilot instead, which serves OpenAI, Anthropic, Google and xAI models over
 * one login. That is the recommendation this module makes, rather than quietly
 * falling back to an API key.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJSON } = require('./fs-utils');
const { commandExists } = require('./ai-cli');
const { debug } = require('./debug');
const P = require('./paths');

/** Env var that stands in for the credentials file, for machines you cannot sign in on. */
const CREDENTIALS_ENV = 'E2E_OAUTH_CREDENTIALS';

/**
 * Subscriptions e2e can use. `id` is what `e2e login <id>` takes; `module` is
 * the `e2e/oauth/<module>` export the config imports.
 */
const SUBSCRIPTIONS = [
  {
    id: 'github-copilot',
    module: 'copilot',
    fn: 'copilot',
    name: 'GitHub Copilot',
    defaultModel: 'claude-sonnet-5',
    serves: 'OpenAI, Anthropic, Google and xAI models over one login',
    // The only subscription that can reach Anthropic models, which matters
    // because e2e has no Claude subscription support of its own.
    reachesAnthropic: true,
  },
  {
    id: 'openai',
    module: 'chatgpt',
    fn: 'chatgpt',
    name: 'ChatGPT Plus/Pro',
    defaultModel: 'gpt-5-mini',
    serves: 'OpenAI models — this is the same sign-in the Codex CLI uses',
    reachesAnthropic: false,
  },
  {
    id: 'spacexai',
    module: 'grok',
    fn: 'grok',
    name: 'SuperGrok / X Premium+',
    defaultModel: 'grok-4',
    serves: 'xAI models',
    reachesAnthropic: false,
  },
];

/** API keys, kept for CI and for anyone who genuinely prefers them. */
const API_KEYS = [
  { env: 'AI_GATEWAY_API_KEY', name: 'Vercel AI Gateway', pkg: null,
    import: "import { gateway } from 'ai';", expr: "gateway('openai/gpt-5-mini')" },
  { env: 'OPENROUTER_API_KEY', name: 'OpenRouter', pkg: '@openrouter/ai-sdk-provider',
    import: "import { openrouter } from '@openrouter/ai-sdk-provider';", expr: "openrouter('anthropic/claude-haiku-4.5')" },
  { env: 'ANTHROPIC_API_KEY', name: 'Anthropic', pkg: '@ai-sdk/anthropic',
    import: "import { anthropic } from '@ai-sdk/anthropic';", expr: "anthropic('claude-haiku-4-5')" },
  { env: 'OPENAI_API_KEY', name: 'OpenAI', pkg: '@ai-sdk/openai',
    import: "import { openai } from '@ai-sdk/openai';", expr: "openai('gpt-5-mini')" },
];

const LOCAL = {
  name: 'local model server',
  pkg: '@ai-sdk/openai-compatible',
  import: "import { createOpenAICompatible } from '@ai-sdk/openai-compatible';\n\n"
    + "const local = createOpenAICompatible({\n"
    + "  name: 'local',\n"
    + "  baseURL: process.env.LLM_BASE_URL ?? 'http://127.0.0.1:11434/v1',\n"
    + "  apiKey: process.env.LLM_API_KEY ?? 'not-needed',\n"
    + "});",
  expr: "local('qwen3:8b')",
};

/**
 * Which e2e subscription a given Yuva AI CLI points at.
 * `claude` and `gemini` have no subscription of their own in e2e; Copilot is how
 * their models are reached without a key.
 */
const CLI_TO_SUBSCRIPTION = {
  codex: 'openai',
  claude: 'github-copilot',
  gemini: 'github-copilot',
  opencode: 'github-copilot',
  aider: 'github-copilot',
};

/* ------------------------------------------------------------------ */

/** `$XDG_CONFIG_HOME/e2e/oauth.json`, else `~/.config/e2e/oauth.json`. */
function credentialsPath(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME;
  const base = configHome ? configHome : path.join(os.homedir(), '.config');
  return path.join(base, 'e2e', 'oauth.json');
}

/**
 * Which providers e2e already holds a login for.
 *
 * Reads the KEYS only. That file holds live credentials, so nothing in Yuva ever
 * reads, logs or copies a value out of it — knowing a provider is signed in is
 * all this needs.
 */
function detectLogins(env = process.env) {
  const fromEnv = env[CREDENTIALS_ENV];
  const raw = fromEnv || (() => {
    const file = credentialsPath(env);
    try {
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    } catch (err) {
      debug('e2e-auth', 'could not read the credential store', err);
      return null;
    }
  })();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.keys(parsed).filter(k => SUBSCRIPTIONS.some(s => s.id === k));
  } catch (err) {
    debug('e2e-auth', 'credential store did not parse', err);
    return [];
  }
}

/** Which AI CLI this project is set up to drive. */
function detectYuvaCli(targetDir) {
  const cfg = readJSON(P.configFile(targetDir)) || {};
  return typeof cfg.llm === 'string' ? cfg.llm : null;
}

/** Is the GitHub CLI available to borrow a Copilot login from? */
function hasGitHubCli(existsFn = commandExists) {
  try {
    return existsFn('gh');
  } catch {
    return false;
  }
}

function apiKeysPresent(env = process.env) {
  return API_KEYS.filter(k => env[k.env]);
}

/* ------------------------------------------------------------------ */

/**
 * Choose how the agent should authenticate, and say why.
 *
 * Pure: everything it looks at is passed in, so the policy is testable without
 * a filesystem, a network or a signed-in machine.
 *
 * @returns {{ kind, provider, reason, setup, model, importLine, expr, pkg }}
 */
function recommend({ logins = [], yuvaCli = null, hasGh = false, env = process.env } = {}) {
  // 1. Already signed in — nothing to set up.
  for (const sub of SUBSCRIPTIONS) {
    if (logins.includes(sub.id)) {
      return {
        kind: 'subscription',
        provider: sub,
        reason: `e2e already holds a ${sub.name} login — no API key, no per-token bill.`,
        setup: null,
        model: sub.defaultModel,
        importLine: `import { ${sub.fn} } from 'e2e/oauth/${sub.module}';`,
        expr: `${sub.fn}('${sub.defaultModel}')`,
        pkg: null,
      };
    }
  }

  // 2. A subscription they plausibly already have.
  const preferredId = CLI_TO_SUBSCRIPTION[yuvaCli] || (hasGh ? 'github-copilot' : null);
  const preferred = SUBSCRIPTIONS.find(s => s.id === preferredId);
  if (preferred) {
    const viaGh = preferred.id === 'github-copilot' && hasGh;
    const why = yuvaCli === 'codex'
      ? 'Your Yuva CLI is Codex, and this is the same ChatGPT sign-in.'
      : yuvaCli
        ? `e2e has no Claude or Gemini subscription support, but Copilot serves those vendors' models — so your ${yuvaCli} workflow keeps one subscription instead of gaining an API bill.`
        : 'The GitHub CLI is signed in here, so this needs no new account.';
    return {
      kind: 'subscription-login-needed',
      provider: preferred,
      reason: why,
      setup: viaGh
        ? `npx e2e login github-copilot --from-gh   # reuses your existing gh login`
        : `npx e2e login ${preferred.id}`,
      model: preferred.defaultModel,
      importLine: `import { ${preferred.fn} } from 'e2e/oauth/${preferred.module}';`,
      expr: `${preferred.fn}('${preferred.defaultModel}')`,
      pkg: null,
    };
  }

  // 3. A local model: free, offline, nothing leaves the machine.
  const keys = apiKeysPresent(env);
  if (keys.length === 0) {
    return {
      kind: 'local',
      provider: LOCAL,
      reason: 'No subscription login and no API key found, so this points at a local '
        + 'model server. Nothing leaves the machine, and nothing is billed.',
      setup: 'Start Ollama (or any OpenAI-compatible server) on 127.0.0.1:11434',
      model: 'qwen3:8b',
      importLine: LOCAL.import,
      expr: LOCAL.expr,
      pkg: LOCAL.pkg,
    };
  }

  // 4. An API key, only because one is already set.
  const key = keys[0];
  return {
    kind: 'api-key',
    provider: key,
    reason: `${key.env} is set, so it is used. A subscription (\`npx e2e login\`) avoids `
      + 'a second, per-token way to pay for what your AI CLI subscription already covers.',
    setup: null,
    model: null,
    importLine: key.import,
    expr: key.expr,
    pkg: key.pkg,
  };
}

/** Everything the command needs to describe the situation, gathered once. */
function inspect(targetDir, env = process.env) {
  const logins = detectLogins(env);
  const yuvaCli = detectYuvaCli(targetDir);
  const hasGh = hasGitHubCli();
  return {
    logins,
    yuvaCli,
    hasGh,
    apiKeys: apiKeysPresent(env).map(k => k.env),
    credentialsPath: credentialsPath(env),
    choice: recommend({ logins, yuvaCli, hasGh, env }),
  };
}

module.exports = {
  CREDENTIALS_ENV,
  SUBSCRIPTIONS,
  API_KEYS,
  LOCAL,
  CLI_TO_SUBSCRIPTION,
  credentialsPath,
  detectLogins,
  detectYuvaCli,
  hasGitHubCli,
  apiKeysPresent,
  recommend,
  inspect,
};
