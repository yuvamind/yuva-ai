import { GATE_ORDER } from '../lib/gate-runner';
import * as P from '../lib/paths';
/**
 * Reference hygiene for the shipped docs.
 *
 * Four separate bugs of this exact shape shipped during the design-system work:
 *   - `yuva gate run --only visual` (no such gate; "run" is not a gate name)
 *   - `frontendstandards.md` referenced but present only outside the package
 *   - `testingstandards.md` referenced but present only outside the package
 *   - `docs/design-system.md` vs `designsystem.md` collapsing into one reference
 *
 * Prose is free and code is not, so docs drift away from the thing they
 * describe unless something fails. That is what this file is for.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(ROOT, 'template');

/* ------------------------------------------------------------------ *
 * Collecting the docs
 * ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const DOC_FILES = walk(TEMPLATE).filter(f => f.endsWith('.md'));
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');

/* ------------------------------------------------------------------ *
 * What counts as a resolvable reference
 * ------------------------------------------------------------------ */

/**
 * Paths an agent is instructed to CREATE in the target project. These must not
 * exist in this repo — they are outputs, not shipped files.
 */
const AGENT_OUTPUT_PREFIXES = ['docs/', 'src/', '.yuva/run/'];

/** Config an agent edits, or files owned elsewhere, rather than ones we ship. */
const EXTERNAL_OR_GENERATED = new Set([
  '.yuva/config.json', '.yuva/gates/', 'package.json', 'package-lock.json',
  'tsconfig.json', 'vitest.config.js', 'eslint.config.js', '.env.example',
  // `yuva init` writes these native config files into the target project
  'CLAUDE.md', 'GEMINI.md', 'AGENTS.md',
  // generated into .yuva/run/visual/<timestamp>/ by the visual gate
  'report.md',
]);

/** Placeholder spellings that are not real paths. */
const isPlaceholder = (p: string) => /[<>*]/.test(p) || p.includes('...');

/**
 * Paths outside the project entirely — a user's home directory, or an absolute
 * system path. These are real and documented, just not ours to ship.
 */
const isExternalPath = (p: string) => p.startsWith('~/') || p.startsWith('/etc/') || /^[A-Za-z]:[\/]/.test(p);

/**
 * Illustrative filenames inside naming-convention tables and code examples
 * (`DataTable.tsx`, `useAuth.ts`, `API_ENDPOINTS.ts`) are not references to
 * anything. Every doc this repo actually ships has an all-lowercase basename, so
 * any uppercase letter marks the token as an example rather than a citation.
 */
function isIllustrative(ref: string) {
  const base = ref.split('/').pop();
  return /[A-Z]/.test(base ?? '');
}

/**
 * A reference resolves if it ships under template/, is a declared agent output,
 * or is agent-writable config.
 */
function classify(ref: string) {
  if (isPlaceholder(ref)) return 'placeholder';
  if (isExternalPath(ref)) return 'external-path';
  if (isIllustrative(ref)) return 'example';
  if (EXTERNAL_OR_GENERATED.has(ref)) return 'external';
  if (AGENT_OUTPUT_PREFIXES.some(p => ref.startsWith(p))) return 'agent-output';

  // `.yuva/standards/x.md` ships as `template/.yuva/standards/x.md`
  const candidates = [
    path.join(TEMPLATE, ref),
    path.join(TEMPLATE, '.yuva', ref),
    path.join(TEMPLATE, '.yuva', 'standards', ref),
    path.join(TEMPLATE, '.yuva', 'prompts', ref),
    path.join(TEMPLATE, '.yuva', 'templates', ref),
    path.join(ROOT, ref),
  ];
  return candidates.some(c => fs.existsSync(c)) ? 'ships' : 'BROKEN';
}

/**
 * Extract backtick-quoted file references. Backticks only, deliberately: bare
 * prose produces false positives like "...able.md" from a table cell.
 */
function extractFileRefs(text: string) {
  const refs = new Set<string>();
  for (const [, inner] of text.matchAll(/`([^`\n]+)`/g)) {
    const token = inner.trim();
    if (/\s/.test(token)) continue;                       // a command, not a path
    if (!/\.(md|css|json|js|cjs|mjs|tsx?|jsx?)$/.test(token)) continue;
    refs.add(token.replace(/^\.\//, ''));
  }
  return [...refs];
}

/* ------------------------------------------------------------------ *
 * Valid CLI surface, read from the CLI itself
 * ------------------------------------------------------------------ */

const cliSource = fs.readFileSync(path.join(ROOT, 'bin', 'cli.ts'), 'utf8');
const VALID_COMMANDS = new Set(
  // Digits allowed: `e2e` is a command, and `[a-z-]+` silently parsed it as `e`.
  [...cliSource.matchAll(/^\s*case '([a-z0-9-]+)':/gm)].map(m => m[1]),
);

const VALID_GATE_ARGS = new Set([...GATE_ORDER, 'list', 'help']);

const sessionSource = fs.readFileSync(path.join(ROOT, 'lib', 'commands', 'session.ts'), 'utf8');
const VALID_SESSION_SUBS = new Set(
  [...sessionSource.matchAll(/case '([a-z0-9-]+)':/g)].map(m => m[1]),
);

const agentSource = fs.readFileSync(path.join(ROOT, 'lib', 'commands', 'agent.ts'), 'utf8');
const AGENT_MAP_BLOCK = agentSource.slice(
  agentSource.indexOf('const AGENT_MAP'),
  agentSource.indexOf('const AGENT_DESCRIPTIONS'),
);
const VALID_AGENT_NAMES = new Set(
  [...AGENT_MAP_BLOCK.matchAll(/'([a-z0-9]+)':/g)].map(m => m[1]),
);

/** Extract `yuva <command> [sub]` invocations from backticks and code fences. */
function extractCommands(text: string) {
  const found = new Set<string>();
  for (const [, inner] of text.matchAll(/(?:^|[`\s])yuva ([a-z0-9-]+(?: [a-z0-9-]+)?)/gm)) {
    found.add(inner.trim());
  }
  return [...found];
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('shipped docs reference real files', () => {
  it('finds docs to check', () => {
    expect(DOC_FILES.length).toBeGreaterThan(5);
  });

  it.each(DOC_FILES.map(f => [rel(f), f]))('%s', (_name, file) => {
    const broken = extractFileRefs(fs.readFileSync(file, 'utf8'))
      .filter(ref => classify(ref) === 'BROKEN');

    expect(broken, `${rel(file)} references files that neither ship in template/ nor are declared agent outputs: ${broken.join(', ')}`)
      .toEqual([]);
  });
});

describe('shipped docs reference real CLI commands', () => {
  it('reads a plausible command surface from bin/cli.ts', () => {
    expect(VALID_COMMANDS.has('gate')).toBe(true);
    expect(VALID_COMMANDS.has('agent')).toBe(true);
    expect(VALID_COMMANDS.has('session')).toBe(true);
  });

  it.each(DOC_FILES.map(f => [rel(f), f]))('%s', (_name, file) => {
    const bad = [];
    for (const invocation of extractCommands(fs.readFileSync(file, 'utf8'))) {
      const [command, sub] = invocation.split(' ');

      if (!VALID_COMMANDS.has(command)) {
        bad.push(`yuva ${invocation} (unknown command "${command}")`);
        continue;
      }
      if (!sub) continue;

      // Subcommand checks for the groups the design docs actually drive.
      if (command === 'gate' && !VALID_GATE_ARGS.has(sub)) {
        bad.push(`yuva ${invocation} ("${sub}" is not a gate name or subcommand)`);
      }
      if (command === 'session' && !VALID_SESSION_SUBS.has(sub)) {
        bad.push(`yuva ${invocation} ("${sub}" is not a session subcommand)`);
      }
      if (command === 'agent' && !['show', 'list', 'orchestrate', 'help'].includes(sub)) {
        bad.push(`yuva ${invocation} ("${sub}" is not an agent subcommand)`);
      }
    }

    expect(bad, `${rel(file)} references commands that do not resolve: ${bad.join('; ')}`).toEqual([]);
  });
});

describe('every agent named in the docs resolves to a prompt file', () => {
  it('agent.js AGENT_MAP points at files that exist', () => {
    const missing = [];
    for (const name of VALID_AGENT_NAMES) {
      const match = AGENT_MAP_BLOCK.match(new RegExp(`'${name}':\\s*'([^']+)'`));
      if (!match) continue;
      const file = path.join(TEMPLATE, '.yuva', 'prompts', match[1]);
      if (!fs.existsSync(file)) missing.push(`${name} -> ${match[1]}`);
    }
    expect(missing, `AGENT_MAP entries with no prompt file: ${missing.join(', ')}`).toEqual([]);
  });

  it('includes the design and visualqa agents', () => {
    expect(VALID_AGENT_NAMES.has('design')).toBe(true);
    expect(VALID_AGENT_NAMES.has('visualqa')).toBe(true);
  });
});

describe('runtime directories are registered for migration', () => {
  it('every P.runPath() directory used in lib/ is in RUNTIME_ENTRIES', () => {
    const libFiles = walk(path.join(ROOT, 'lib')).filter(f => f.endsWith('.ts'));
    const used = new Set<string>();
    for (const file of libFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const [, name] of src.matchAll(/runPath\([^,]+,\s*'([a-z-]+)'/g)) used.add(name);
      for (const [, name] of src.matchAll(/resolveRun\([^,]+,\s*'([a-z-.]+)'/g)) used.add(name);
    }
    const unregistered = [...used].filter(n => !P.RUNTIME_ENTRIES.includes(n));
    expect(unregistered, `runtime dirs written by lib/ but absent from RUNTIME_ENTRIES (so migrate() will never move them): ${unregistered.join(', ')}`)
      .toEqual([]);
  });
});
