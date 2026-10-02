/**
 * Design contract — the machine-readable handoff from Design to everyone after it.
 *
 * Markdown carries judgement. This carries the things an agent must not
 * re-interpret: where the token file is, which globs are application-owned UI
 * source, which token names exist, the component inventory with tiers, and the
 * accessibility target.
 *
 * That is what makes the "review only" rows of componentcontracts.md section 13
 * enforceable. A colour-literal lint is unacceptable without it — it would fire
 * on tests, SVG, docs examples, chart config and vendor code. Given declared
 * globs and declared token names, the same lint becomes precise.
 *
 * Lives at `docs/design-contract.json`, NOT under `.yuva/`: enforcement-rules
 * PROTECTED_DIRS blocks workers from writing beneath `.yuva/`, so an
 * agent-authored artifact cannot live there.
 *
 * Shape mirrors `design-audit.js` — load/validate/lint produce findings, and
 * evaluate/summarize/formatFindings roll them up — so the rules stay unit
 * testable without a filesystem fixture per rule.
 */

import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { debug } from './debug';
import * as P from './paths';

const CONTRACT_VERSION = 1;

/** Excluded from UI-source lints no matter what the contract says. */
const ALWAYS_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.stories.*',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/__snapshots__/**',
  '**/vendor/**',
  '**/*.min.*',
  '**/*.generated.*',
  '**/*.gen.*',
];

const RULE_SEVERITY = {
  // Structural — the contract itself is wrong or unusable.
  'contract-invalid': 'error',
  'contract-version': 'error',
  'missing-path': 'error',
  'missing-contract': 'error',
  // Source rules — the implementation drifted from the contract.
  'colour-literal': 'error',
  'primitive-token': 'error',
  'undeclared-token': 'warn',
  'off-scale-spacing': 'warn',
  'tier-violation': 'error',
};

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

/**
 * Load the contract.
 *
 * Deliberately NOT `fs-utils.readJSON`, which returns null for a missing file
 * and for a syntax error indistinguishably. For an authored, committed artifact
 * those are completely different situations: absent means "not adopted yet" and
 * must be silent; malformed means "someone broke it" and must be loud.
 *
 * @returns {{ status:'absent'|'ok'|'invalid', contract:object|null, findings:Array }}
 */
/**
 * docs/design-contract.json as read from disk. It is author-edited JSON, so
 * every field is optional here and validate() checks each one at runtime; the
 * index signature keeps unknown extra keys from being a type error.
 */
export interface DesignContract {
  version?: number;
  paths?: { tokens?: string; [key: string]: unknown };
  /**
   * Declared token NAMES per tier (not values): the contract lists which
   * --custom-properties exist so the linter can flag undeclared or primitive
   * ones in component CSS.
   */
  tokens?: {
    semantic?: string[];
    primitive?: string[];
    scales?: { spacing?: string[]; [key: string]: unknown };
    [key: string]: unknown;
  };
  components?: unknown;
  exclude?: string[];
  uiSource?: string[];
  json?: unknown;
  [key: string]: unknown;
}

export interface ContractFinding {
  rule: string;
  severity: string;
  file: string | null;
  line: number;
  message: string;
}

export type ContractStatus = 'absent' | 'invalid' | 'ok';

export interface LoadedContract {
  status: ContractStatus;
  contract: DesignContract | null;
  findings: ContractFinding[];
}

function load(targetDir: string): LoadedContract {
  const file = P.designContractFile(targetDir);

  if (!fs.existsSync(file)) {
    return { status: 'absent', contract: null, findings: [] };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    debug('design-contract', 'read failed', err);
    return {
      status: 'invalid',
      contract: null,
      findings: [finding('contract-invalid', file, `could not be read: ${(err as Error).message}`)],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      status: 'invalid',
      contract: null,
      findings: [finding('contract-invalid', file, `is not valid JSON: ${(err as Error).message}`)],
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      status: 'invalid',
      contract: null,
      findings: [finding('contract-invalid', file, 'must be a JSON object')],
    };
  }

  if (parsed.version !== CONTRACT_VERSION) {
    return {
      status: 'invalid',
      contract: null,
      findings: [finding('contract-version', file,
        `declares version ${JSON.stringify(parsed.version)}; this Yuva understands ${CONTRACT_VERSION}. ` +
        'Migrate the contract or upgrade Yuva — a version mismatch is not something to guess through.')],
    };
  }

  return { status: 'ok', contract: parsed, findings: [] };
}

function finding(rule: string, file: string | null, message: string, line?: number): ContractFinding {
  return {
    rule,
    severity: (RULE_SEVERITY as Record<string, string>)[rule] || 'warn',
    file: file || null,
    line: typeof line === 'number' ? line : 0,
    message,
  };
}

/* ------------------------------------------------------------------ *
 * Validation — is the contract itself coherent?
 * ------------------------------------------------------------------ */

/**
 * Validate shape and cross-check against the filesystem.
 * @returns {Array} findings
 */
function validate(contract: DesignContract, targetDir: string): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const rel = (p: string) => path.relative(targetDir, p).split(path.sep).join('/');
  const contractFile = rel(P.designContractFile(targetDir));

  const paths = contract.paths || {};
  if (!paths.tokens) {
    findings.push(finding('missing-path', contractFile,
      'paths.tokens is required — every agent and lint reads the token file location from here, ' +
      'which is what stops `src/styles/tokens.css` being hardcoded in six places'));
  } else if (!fs.existsSync(path.join(targetDir, paths.tokens))) {
    findings.push(finding('missing-path', contractFile,
      `paths.tokens points at "${paths.tokens}", which does not exist`));
  }

  if (!Array.isArray(contract.uiSource) || contract.uiSource.length === 0) {
    findings.push(finding('missing-path', contractFile,
      'uiSource must list the globs that are application-owned UI source. ' +
      'Without it the source lints cannot run without false-positiving on tests, SVG and vendor code'));
  }

  const tokens = contract.tokens || {};
  if (!Array.isArray(tokens.semantic) || tokens.semantic.length === 0) {
    findings.push(finding('contract-invalid', contractFile,
      'tokens.semantic must list the semantic token names components are allowed to use'));
  }

  const components = Array.isArray(contract.components) ? contract.components : [];
  for (const component of components) {
    if (!component || typeof component.name !== 'string' || !component.name) {
      findings.push(finding('contract-invalid', contractFile, 'every component needs a name'));
      continue;
    }
    if (![0, 1, 2].includes(component.tier)) {
      findings.push(finding('contract-invalid', contractFile,
        `${component.name}: tier must be 0 (primitive), 1 (composition) or 2 (pattern) — got ${JSON.stringify(component.tier)}`));
    }
    // A component with no contract file cannot be implemented (componentcontracts C1-C12).
    const contractsDir = paths.contracts || 'docs/components';
    const expected = component.contract || `${contractsDir}/${component.name}.md`;
    if (!fs.existsSync(path.join(targetDir, expected))) {
      findings.push(finding('missing-contract', expected,
        `${component.name} is declared in the inventory but has no contract. ` +
        'The contract is the spec — written before the implementation, not after it'));
    }
  }

  return findings;
}

/* ------------------------------------------------------------------ *
 * Source lints — did the implementation honour the contract?
 * ------------------------------------------------------------------ */

/** Resolve the declared UI source set, minus the token file and the exclusions. */
function uiSourceFiles(targetDir: string, contract: DesignContract): string[] {
  const patterns = Array.isArray(contract.uiSource) ? contract.uiSource : [];
  if (patterns.length === 0) return [];

  const ignore = [...ALWAYS_EXCLUDE, ...(Array.isArray(contract.exclude) ? contract.exclude : [])];
  const tokensPath = (contract.paths && contract.paths.tokens) || '';

  let matched = [];
  try {
    matched = globSync(patterns, {
      cwd: targetDir,
      ignore,
      nodir: true,
      dot: false,
      posix: true,
    });
  } catch (err) {
    debug('design-contract', 'glob failed', err);
    return [];
  }

  // The token file is the one place literals are allowed, so never lint it.
  return matched.filter(f => f !== tokensPath);
}

/** Strip comments and string-ish noise that would otherwise look like a literal. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') ||
    trimmed.startsWith('/*') || trimmed.startsWith('<!--');
}

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const FUNC_COLOUR_RE = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\s*\(/;
const VAR_RE = /var\(\s*(--[A-Za-z0-9_-]+)/g;
const LENGTH_RE = /(?<![\w-])(\d*\.?\d+)(px|rem|em)(?![\w-])/g;

const SPACING_PROPS = /\b(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|translate)/;

/**
 * Lint the declared UI source against the contract.
 * @returns {Array} findings
 */
function lint(targetDir: string, contract: DesignContract): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const files = uiSourceFiles(targetDir, contract);
  if (files.length === 0) return findings;

  const tokens = contract.tokens || {};
  const semantic = new Set(tokens.semantic || []);
  const primitive = new Set(tokens.primitive || []);
  const scales = tokens.scales || {};
  const spacingScale = new Set(scales.spacing || []);

  const components = Array.isArray(contract.components) ? contract.components : [];
  const lowTierNames = new Set(
    components.filter(c => c && (c.tier === 0 || c.tier === 1)).map(c => c.name),
  );

  for (const relFile of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(targetDir, relFile), 'utf8');
    } catch (err) {
      debug('design-contract', `could not read ${relFile}`, err);
      continue;
    }

    const lines = content.split('\n');
    const basename = path.basename(relFile).replace(/\.[^.]+$/, '');
    const isLowTierFile = lowTierNames.has(basename);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;
      if (isCommentLine(line)) continue;

      // --- colour literals ------------------------------------------------
      const hex = line.match(HEX_RE);
      if (hex) {
        findings.push(finding('colour-literal', relFile,
          `colour literal ${hex[0]} — only ${(contract.paths || {}).tokens || 'the token file'} may contain these`,
          lineNo));
      } else {
        const func = line.match(FUNC_COLOUR_RE);
        // `color(` also matches `color:` usage patterns, so require a real literal
        if (func && !/var\(/.test(line)) {
          findings.push(finding('colour-literal', relFile,
            `colour literal ${func[1]}(...) — reference a semantic token instead`,
            lineNo));
        }
      }

      // --- token tier + declaration --------------------------------------
      for (const match of line.matchAll(VAR_RE)) {
        const token = match[1];
        if (primitive.has(token)) {
          findings.push(finding('primitive-token', relFile,
            `${token} is a PRIMITIVE token — it hard-codes a ramp position. Use a semantic token so a palette change propagates`,
            lineNo));
        } else if (semantic.size > 0 && !semantic.has(token) && !isComponentToken(token, basename)) {
          findings.push(finding('undeclared-token', relFile,
            `${token} is not declared in the contract. Add it to tokens.semantic, or name it as a component token (--${basename.toLowerCase()}-*)`,
            lineNo));
        }
      }

      // --- spacing scale --------------------------------------------------
      // Only on spacing properties, and only when nothing justifies the value:
      // frontendstandards allows off-scale values for optical alignment WITH a
      // comment, so a commented line is explicitly permitted.
      if (spacingScale.size > 0 && SPACING_PROPS.test(line) && !/\/\/|\/\*/.test(line)) {
        for (const match of line.matchAll(LENGTH_RE)) {
          const value = `${match[1]}${match[2]}`;
          if (value === '0px' || match[1] === '0' || value === '1px') continue; // hairlines are fine
          if (!spacingScale.has(value)) {
            findings.push(finding('off-scale-spacing', relFile,
              `${value} is not on the spacing scale. Use a scale value, or add a comment saying why this one is optical`,
              lineNo));
          }
        }
      }

      // --- tier rule ------------------------------------------------------
      if (isLowTierFile && /\b(?:fetch|axios|useQuery|useSWR|XMLHttpRequest)\s*[(<]/.test(line)) {
        findings.push(finding('tier-violation', relFile,
          `${basename} is Tier 0/1 and must not fetch. Take the data as a prop; only Tier 2 patterns touch the network`,
          lineNo));
      }
    }
  }

  return findings;
}

/** A component may own tokens named after itself (componentcontracts section 7.1). */
function isComponentToken(token: string, basename: string): boolean {
  const prefix = `--${basename.toLowerCase()}-`;
  return token.toLowerCase().startsWith(prefix);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Load, validate and lint.
 *
 * Returns an empty array when no contract exists. That silence is deliberate:
 * built-in plugin gates are enabled by default, so a project that has not
 * adopted the contract must see nothing rather than a wall of advice.
 *
 * @returns {Array} findings
 */
function evaluate(targetDir: string) {
  const loaded = load(targetDir);
  if (loaded.status === 'absent') return [];
  if (loaded.status === 'invalid') return loaded.findings;

  const findings = validate(loaded.contract!, targetDir);
  try {
    findings.push(...lint(targetDir, loaded.contract!));
  } catch (err) {
    debug('design-contract', 'lint failed', err);
    findings.push(finding('contract-invalid', null, `lint failed: ${(err as Error).message}`));
  }
  return findings;
}

/** Roll findings up into a verdict. */
function summarize(findings: ContractFinding[] = []) {
  const errors = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warn');
  return {
    passed: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors,
    warnings,
  };
}

/** Human-readable report, grouped by rule. */
function formatFindings(findings: ContractFinding[] = []): string {
  if (findings.length === 0) return 'No design-contract findings.';

  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }

  const lines: string[] = [];
  for (const severity of ['error', 'warn']) {
    const rules = [...byRule.entries()].filter(([, items]) => items[0].severity === severity);
    if (rules.length === 0) continue;
    lines.push(severity === 'error' ? 'BLOCKING' : 'ADVISORY');
    for (const [rule, items] of rules) {
      lines.push(`  ${rule}`);
      for (const item of items.slice(0, 5)) {
        const where = item.file ? `${item.file}${item.line ? `:${item.line}` : ''}` : '';
        lines.push(`    - ${where ? `${where} — ` : ''}${item.message}`);
      }
      if (items.length > 5) lines.push(`    ... and ${items.length - 5} more`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export {
  CONTRACT_VERSION,
  ALWAYS_EXCLUDE,
  RULE_SEVERITY,
  load,
  validate,
  lint,
  uiSourceFiles,
  evaluate,
  summarize,
  formatFindings,
  isComponentToken,
};