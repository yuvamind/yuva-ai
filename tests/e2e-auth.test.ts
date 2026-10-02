import fs from 'fs';
import os from 'os';
import path from 'path';

import * as auth from '../lib/e2e-auth';
import { CANDIDATE_CLIS } from '../lib/ai-cli';
const {
  CREDENTIALS_ENV, SUBSCRIPTIONS, API_KEYS, LOCAL, CLI_TO_SUBSCRIPTION,
  credentialsPath, detectLogins, detectYuvaCli, apiKeysPresent, recommend, inspect,
} = auth;

let dir: string;

const write = (rel: string, contents: unknown) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
};

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-auth-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

/* ------------------------------------------------------------------ */

describe('the provider catalogue matches what e2e ships', () => {
  const oauthDir = path.join(__dirname, '..', 'node_modules', 'e2e', 'dist', 'oauth');
  const maybe = fs.existsSync(oauthDir) ? it : it.skip;

  maybe('every subscription maps to a real e2e/oauth module', () => {
    for (const sub of SUBSCRIPTIONS) {
      const file = path.join(oauthDir, `${sub.module}.js`);
      expect(fs.existsSync(file), `e2e ships no oauth/${sub.module}`).toBe(true);
    }
  });

  maybe('every PUBLIC oauth provider e2e exports is covered here', () => {
    // The package's `exports` map is the authoritative list of public entry
    // points. Listing the directory instead picks up plumbing (pkce, jwt, sse)
    // and would need a blocklist that rots every release.
    const pkg = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'node_modules', 'e2e', 'package.json'), 'utf8'));
    const exported = Object.keys(pkg.exports || {})
      .filter(k => k.startsWith('./oauth/'))
      .map(k => k.replace('./oauth/', ''));
    expect(exported.length, 'found no oauth exports to check against').toBeGreaterThan(0);

    const known = SUBSCRIPTIONS.map(s => s.module);
    const missing = exported.filter(m => !known.includes(m));
    expect(missing, `e2e exports oauth providers Yuva does not offer: ${missing.join(', ')}`).toEqual([]);
  });

  maybe('the Copilot module really is the one that reaches Anthropic models', () => {
    // The whole Claude-Code recommendation rests on this.
    const doc = fs.readFileSync(path.join(oauthDir, 'copilot.d.ts'), 'utf8');
    expect(doc).toMatch(/Anthropic/);
    const sub = SUBSCRIPTIONS.find(s => s.id === 'github-copilot')!;
    expect(sub.reachesAnthropic).toBe(true);
  });
});

describe('credentialsPath()', () => {
  it('honours XDG_CONFIG_HOME', () => {
    const p = credentialsPath({ XDG_CONFIG_HOME: '/custom' });
    expect(p.split(path.sep).join('/')).toBe('/custom/e2e/oauth.json');
  });

  it('falls back to ~/.config', () => {
    const p = credentialsPath({});
    expect(p).toContain(path.join('.config', 'e2e', 'oauth.json'));
  });
});

describe('detectLogins()', () => {
  it('is empty when nothing is signed in', () => {
    expect(detectLogins({ XDG_CONFIG_HOME: dir })).toEqual([]);
  });

  it('reads provider ids from the store', () => {
    write(path.join('e2e', 'oauth.json'), { 'github-copilot': { token: 'SECRET' } });
    expect(detectLogins({ XDG_CONFIG_HOME: dir })).toEqual(['github-copilot']);
  });

  it('returns only ids — never a credential value', () => {
    write(path.join('e2e', 'oauth.json'), { openai: { access_token: 'SECRET-DO-NOT-LEAK' } });
    const result = detectLogins({ XDG_CONFIG_HOME: dir });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result).toEqual(['openai']);
  });

  it('ignores unknown keys so a future provider cannot be mis-selected', () => {
    write(path.join('e2e', 'oauth.json'), { 'some-future-thing': {}, openai: {} });
    expect(detectLogins({ XDG_CONFIG_HOME: dir })).toEqual(['openai']);
  });

  it('reads the env store used on machines you cannot sign in on', () => {
    expect(detectLogins({ [CREDENTIALS_ENV]: '{"spacexai":{}}' })).toEqual(['spacexai']);
  });

  it('survives a corrupt store rather than throwing', () => {
    write(path.join('e2e', 'oauth.json'), 'not json');
    expect(detectLogins({ XDG_CONFIG_HOME: dir })).toEqual([]);
  });
});

describe('detectYuvaCli()', () => {
  it('reads the configured AI CLI', () => {
    write('.yuva/config.json', { llm: 'claude' });
    expect(detectYuvaCli(dir)).toBe('claude');
  });

  it('is null when unset', () => {
    expect(detectYuvaCli(dir)).toBeNull();
  });
});

describe('recommend() — subscription before API key', () => {
  it('uses a login e2e already holds, with nothing to set up', () => {
    const r = recommend({ logins: ['github-copilot'], env: {} });
    expect(r.kind).toBe('subscription');
    expect(r.setup).toBeNull();
    expect(r.expr).toBe("copilot('claude-sonnet-5')");
    expect(r.importLine).toContain("from 'e2e/oauth/copilot'");
  });

  it('prefers an existing login even when an API key is also present', () => {
    const r = recommend({ logins: ['openai'], env: { OPENAI_API_KEY: 'x' } });
    expect(r.kind).toBe('subscription');
  });

  it('sends a Claude Code user to Copilot, because e2e has no Claude subscription', () => {
    const r = recommend({ yuvaCli: 'claude', hasGh: false, env: {} });
    expect(r.provider.id).toBe('github-copilot');
    expect(r.expr).toContain('claude-sonnet-5');
    expect(r.reason).toMatch(/no Claude or Gemini subscription/);
    expect(r.setup).toBe('npx e2e login github-copilot');
  });

  it('reuses the GitHub CLI login when one is available', () => {
    const r = recommend({ yuvaCli: 'claude', hasGh: true, env: {} });
    expect(r.setup).toContain('--from-gh');
  });

  it('sends a Codex user to the ChatGPT sign-in they already use', () => {
    const r = recommend({ yuvaCli: 'codex', env: {} });
    expect(r.provider.id).toBe('openai');
    expect(r.reason).toMatch(/same ChatGPT sign-in/);
  });

  it('suggests Copilot on a machine with gh but no configured CLI', () => {
    const r = recommend({ hasGh: true, env: {} });
    expect(r.provider.id).toBe('github-copilot');
  });

  it('falls to a LOCAL model before ever suggesting a key', () => {
    const r = recommend({ env: {} });
    expect(r.kind).toBe('local');
    expect(r.reason).toMatch(/Nothing leaves the machine/);
  });

  it('uses an API key only when one is already set, and says why that is second best', () => {
    const r = recommend({ env: { ANTHROPIC_API_KEY: 'x' } });
    expect(r.kind).toBe('api-key');
    expect(r.reason).toMatch(/per-token/);
    expect(r.reason).toMatch(/npx e2e login/);
  });

  it('never recommends an API key when a subscription route exists', () => {
    for (const opts of [
      { logins: ['openai'], env: { OPENAI_API_KEY: 'x' } },
      { yuvaCli: 'claude', env: { ANTHROPIC_API_KEY: 'x' } },
      { hasGh: true, env: { OPENAI_API_KEY: 'x' } },
    ]) {
      expect(recommend(opts).kind).not.toBe('api-key');
    }
  });

  it('maps every AI CLI Yuva knows about to a subscription', () => {
    for (const cli of CANDIDATE_CLIS) {
      expect((CLI_TO_SUBSCRIPTION as Record<string, string>)[cli], `no subscription mapped for ${cli}`).toBeTruthy();
      const r = recommend({ yuvaCli: cli, env: {} });
      expect(r.kind).toBe('subscription-login-needed');
    }
  });
});

describe('apiKeysPresent()', () => {
  it('finds set keys in preference order', () => {
    const found = apiKeysPresent({ OPENAI_API_KEY: 'x', AI_GATEWAY_API_KEY: 'y' });
    expect(found[0].env).toBe('AI_GATEWAY_API_KEY');
  });

  it('is empty with none set', () => {
    expect(apiKeysPresent({})).toEqual([]);
  });
});

describe('inspect()', () => {
  it('gathers everything the command needs in one pass', () => {
    write('.yuva/config.json', { llm: 'claude' });
    const a = inspect(dir, { XDG_CONFIG_HOME: dir });
    expect(a).toMatchObject({ logins: [], yuvaCli: 'claude', apiKeys: [] });
    expect(a.choice.provider.id).toBe('github-copilot');
    expect(typeof a.credentialsPath).toBe('string');
  });
});

describe('the generated config is valid TypeScript shape', () => {
  it('every subscription produces an import and a call expression', () => {
    for (const sub of SUBSCRIPTIONS) {
      const r = recommend({ logins: [sub.id], env: {} });
      expect(r.importLine).toMatch(/^import \{ \w+ \} from 'e2e\/oauth\/\w+';$/);
      expect(r.expr).toMatch(/^\w+\('[\w.-]+'\)$/);
      expect(r.pkg, 'a subscription needs no extra package').toBeNull();
    }
  });

  it('the local and api-key paths name the package they need', () => {
    expect(recommend({ env: {} }).pkg).toBe(LOCAL.pkg);
    const key = recommend({ env: { ANTHROPIC_API_KEY: 'x' } });
    expect(key.pkg).toBe(API_KEYS.find(k => k.env === 'ANTHROPIC_API_KEY')!.pkg);
  });
});
