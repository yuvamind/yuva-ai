const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CONTRACT_VERSION,
  load,
  validate,
  lint,
  uiSourceFiles,
  evaluate,
  summarize,
  formatFindings,
  isComponentToken,
} = require('../lib/design-contract');

let dir;

const write = (rel, contents) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return file;
};

/** A minimal but valid contract, with the files it points at. */
function scaffold(overrides = {}) {
  write('src/styles/tokens.css', ':root { --bg: oklch(0.985 0.003 265); }\n');
  const contract = {
    version: CONTRACT_VERSION,
    paths: { tokens: 'src/styles/tokens.css', contracts: 'docs/components' },
    uiSource: ['src/**/*.{ts,tsx,css}'],
    tokens: {
      primitive: ['--n-50', '--n-500', '--n-900'],
      semantic: ['--bg', '--text', '--text-muted', '--accent', '--space-4'],
      scales: { spacing: ['0.25rem', '0.5rem', '1rem', '2rem'] },
    },
    components: [],
    ...overrides,
  };
  write('docs/design-contract.json', contract);
  return contract;
}

const rules = (findings) => findings.map(f => f.rule);
const rulesIn = (findings, rule) => findings.filter(f => f.rule === rule);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-contract-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe('load()', () => {
  it('is silent when no contract exists — the gate must not fire on projects that have not adopted it', () => {
    const result = load(dir);
    expect(result.status).toBe('absent');
    expect(result.findings).toEqual([]);
    expect(evaluate(dir)).toEqual([]);
  });

  it('is LOUD on malformed JSON, not silent like readJSON would be', () => {
    write('docs/design-contract.json', '{ "version": 1, oops }');
    const result = load(dir);
    expect(result.status).toBe('invalid');
    expect(result.findings[0].rule).toBe('contract-invalid');
    expect(result.findings[0].severity).toBe('error');
    expect(result.findings[0].message).toMatch(/not valid JSON/);
  });

  it('is loud on a version mismatch rather than guessing through it', () => {
    write('docs/design-contract.json', { version: 99, paths: {} });
    const result = load(dir);
    expect(result.status).toBe('invalid');
    expect(result.findings[0].rule).toBe('contract-version');
    expect(result.findings[0].message).toContain('99');
    expect(result.findings[0].message).toContain(String(CONTRACT_VERSION));
  });

  it('rejects a non-object document', () => {
    write('docs/design-contract.json', '[1, 2, 3]');
    expect(load(dir).findings[0].message).toMatch(/must be a JSON object/);
  });

  it('accepts a well-formed contract', () => {
    scaffold();
    const result = load(dir);
    expect(result.status).toBe('ok');
    expect(result.contract.version).toBe(CONTRACT_VERSION);
  });
});

describe('validate()', () => {
  it('passes a complete contract', () => {
    const contract = scaffold();
    expect(validate(contract, dir)).toEqual([]);
  });

  it('requires paths.tokens, and that it exists on disk', () => {
    const contract = scaffold();
    delete contract.paths.tokens;
    expect(rules(validate(contract, dir))).toContain('missing-path');

    contract.paths.tokens = 'src/styles/nope.css';
    const findings = validate(contract, dir);
    expect(findings[0].message).toMatch(/does not exist/);
  });

  it('requires uiSource, because without it the lints cannot be precise', () => {
    const contract = scaffold();
    contract.uiSource = [];
    const findings = validate(contract, dir);
    expect(rules(findings)).toContain('missing-path');
    expect(findings.some(f => /false-positiv/i.test(f.message))).toBe(true);
  });

  it('requires a semantic token list', () => {
    const contract = scaffold();
    contract.tokens.semantic = [];
    expect(rules(validate(contract, dir))).toContain('contract-invalid');
  });

  it('rejects an invalid tier', () => {
    const contract = scaffold({ components: [{ name: 'Button', tier: 7 }] });
    const findings = validate(contract, dir);
    expect(findings.some(f => /tier must be 0/.test(f.message))).toBe(true);
  });

  it('flags a declared component with no contract file', () => {
    const contract = scaffold({ components: [{ name: 'Button', tier: 0 }] });
    const findings = rulesIn(validate(contract, dir), 'missing-contract');
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('docs/components/Button.md');
    expect(findings[0].severity).toBe('error');
  });

  it('passes once the contract file exists', () => {
    const contract = scaffold({ components: [{ name: 'Button', tier: 0 }] });
    write('docs/components/Button.md', '# Button\n');
    expect(rules(validate(contract, dir))).not.toContain('missing-contract');
  });

  it('honours an explicit contract path', () => {
    const contract = scaffold({
      components: [{ name: 'Button', tier: 0, contract: 'docs/ui/Button.md' }],
    });
    write('docs/ui/Button.md', '# Button\n');
    expect(rules(validate(contract, dir))).not.toContain('missing-contract');
  });
});

describe('uiSourceFiles() — scoping is the whole point', () => {
  it('matches only the declared globs', () => {
    const contract = scaffold();
    write('src/components/button.tsx', 'export const Button = () => null;\n');
    write('server/handler.js', 'module.exports = {};\n');
    const files = uiSourceFiles(dir, contract);
    expect(files).toContain('src/components/button.tsx');
    expect(files).not.toContain('server/handler.js');
  });

  it('never includes the token file — the one place literals are allowed', () => {
    const contract = scaffold();
    expect(uiSourceFiles(dir, contract)).not.toContain('src/styles/tokens.css');
  });

  it('always excludes tests, stories, snapshots and vendor code', () => {
    const contract = scaffold();
    for (const f of [
      'src/components/button.test.tsx',
      'src/components/button.spec.tsx',
      'src/components/button.stories.tsx',
      'src/__tests__/button.tsx',
      'src/__mocks__/button.tsx',
      'src/vendor/thing.tsx',
      'src/thing.generated.tsx',
      'src/thing.min.css',
    ]) write(f, 'const x = "#ff0000";\n');
    expect(uiSourceFiles(dir, contract)).toEqual([]);
  });

  it('honours project-specific exclusions', () => {
    const contract = scaffold({ exclude: ['src/charts/**'] });
    write('src/charts/theme.ts', 'export const c = "#ff0000";\n');
    write('src/ok.ts', 'export const x = 1;\n');
    const files = uiSourceFiles(dir, contract);
    expect(files).toEqual(['src/ok.ts']);
  });
});

describe('lint() — colour literals', () => {
  it('catches hex and functional literals in UI source', () => {
    const contract = scaffold();
    write('src/a.css', '.x { color: #3b82f6; }\n');
    write('src/b.css', '.y { color: rgb(59, 130, 246); }\n');
    const findings = rulesIn(lint(dir, contract), 'colour-literal');
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].line).toBe(1);
  });

  it('does NOT fire on a test file', () => {
    const contract = scaffold();
    write('src/a.test.tsx', 'expect(c).toBe("#3b82f6");\n');
    expect(rules(lint(dir, contract))).not.toContain('colour-literal');
  });

  it('does NOT fire on the token file itself', () => {
    const contract = scaffold();
    fs.writeFileSync(path.join(dir, 'src/styles/tokens.css'), ':root { --bg: #fafafa; }\n');
    expect(rules(lint(dir, contract))).not.toContain('colour-literal');
  });

  it('does NOT fire on a commented-out line', () => {
    const contract = scaffold();
    write('src/a.css', '/* was #3b82f6 before the redesign */\n.x { color: var(--accent); }\n');
    expect(rules(lint(dir, contract))).not.toContain('colour-literal');
  });

  it('does NOT fire on a line that uses var()', () => {
    const contract = scaffold();
    write('src/a.css', '.x { color: var(--text); }\n');
    expect(rules(lint(dir, contract))).not.toContain('colour-literal');
  });
});

describe('lint() — token tiers', () => {
  it('blocks a primitive token in component source', () => {
    const contract = scaffold();
    write('src/a.css', '.x { color: var(--n-500); }\n');
    const findings = rulesIn(lint(dir, contract), 'primitive-token');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toMatch(/hard-codes a ramp position/);
  });

  it('allows a semantic token', () => {
    const contract = scaffold();
    write('src/a.css', '.x { color: var(--text-muted); }\n');
    expect(lint(dir, contract)).toEqual([]);
  });

  it('allows a component-owned token named after its component', () => {
    const contract = scaffold();
    write('src/button.css', '.b { height: var(--button-height-sm); }\n');
    expect(rules(lint(dir, contract))).not.toContain('undeclared-token');
  });

  it('warns on a token the contract never declared', () => {
    const contract = scaffold();
    write('src/a.css', '.x { color: var(--mystery-colour); }\n');
    const findings = rulesIn(lint(dir, contract), 'undeclared-token');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });
});

describe('lint() — spacing scale', () => {
  it('warns on an off-scale spacing value', () => {
    const contract = scaffold();
    write('src/a.css', '.x { padding: 13px; }\n');
    const findings = rulesIn(lint(dir, contract), 'off-scale-spacing');
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('13px');
  });

  it('accepts a scale value', () => {
    const contract = scaffold();
    write('src/a.css', '.x { padding: 1rem; gap: 0.5rem; }\n');
    expect(rules(lint(dir, contract))).not.toContain('off-scale-spacing');
  });

  it('permits an off-scale value WITH a comment — optical alignment is legitimate', () => {
    const contract = scaffold();
    write('src/a.css', '.x { padding: 13px; /* optical centring, icon sits 3px high */ }\n');
    expect(rules(lint(dir, contract))).not.toContain('off-scale-spacing');
  });

  it('allows hairlines and zero', () => {
    const contract = scaffold();
    write('src/a.css', '.x { padding: 0; margin: 1px; inset: 0px; }\n');
    expect(rules(lint(dir, contract))).not.toContain('off-scale-spacing');
  });

  it('ignores non-spacing properties', () => {
    const contract = scaffold();
    write('src/a.css', '.x { width: 437px; height: 13px; }\n');
    expect(rules(lint(dir, contract))).not.toContain('off-scale-spacing');
  });

  it('says nothing when no scale is declared', () => {
    const contract = scaffold();
    delete contract.tokens.scales;
    write('src/a.css', '.x { padding: 13px; }\n');
    expect(rules(lint(dir, contract))).not.toContain('off-scale-spacing');
  });
});

describe('lint() — the tier rule', () => {
  it('blocks a Tier 0 component that fetches', () => {
    const contract = scaffold({ components: [{ name: 'Button', tier: 0 }] });
    write('docs/components/Button.md', '# Button\n');
    write('src/Button.tsx', 'const load = () => fetch("/api/x");\n');
    const findings = rulesIn(lint(dir, contract), 'tier-violation');
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toMatch(/only Tier 2 patterns touch the network/);
  });

  it('allows a Tier 2 pattern to fetch', () => {
    const contract = scaffold({ components: [{ name: 'TaskQueue', tier: 2 }] });
    write('docs/components/TaskQueue.md', '# TaskQueue\n');
    write('src/TaskQueue.tsx', 'const load = () => fetch("/api/tasks");\n');
    expect(rules(lint(dir, contract))).not.toContain('tier-violation');
  });

  it('catches a query hook too, not just fetch', () => {
    const contract = scaffold({ components: [{ name: 'Badge', tier: 0 }] });
    write('docs/components/Badge.md', '# Badge\n');
    write('src/Badge.tsx', 'const { data } = useQuery(["x"]);\n');
    expect(rules(lint(dir, contract))).toContain('tier-violation');
  });
});

describe('evaluate()', () => {
  it('returns nothing for a project with no contract', () => {
    expect(evaluate(dir)).toEqual([]);
  });

  it('reports only the load failure when the contract is unusable', () => {
    write('docs/design-contract.json', '{ broken');
    const findings = evaluate(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('contract-invalid');
  });

  it('combines validation and lint findings', () => {
    scaffold({ components: [{ name: 'Button', tier: 0 }] });
    write('src/a.css', '.x { color: #3b82f6; }\n');
    const found = rules(evaluate(dir));
    expect(found).toContain('missing-contract');
    expect(found).toContain('colour-literal');
  });

  it('is clean for a compliant project', () => {
    scaffold({ components: [{ name: 'Button', tier: 0 }] });
    write('docs/components/Button.md', '# Button\n');
    write('src/Button.tsx', 'export const Button = () => null;\n');
    write('src/a.css', '.x { color: var(--text); padding: 1rem; }\n');
    expect(evaluate(dir)).toEqual([]);
  });
});

describe('summarize() and formatFindings()', () => {
  it('fails on errors and passes on warnings alone', () => {
    scaffold();
    write('src/a.css', '.x { color: var(--mystery); }\n');
    const verdict = summarize(evaluate(dir));
    expect(verdict.passed).toBe(true);
    expect(verdict.warningCount).toBe(1);

    write('src/b.css', '.y { color: #fff; }\n');
    expect(summarize(evaluate(dir)).passed).toBe(false);
  });

  it('groups by severity, blocking first', () => {
    scaffold();
    write('src/a.css', '.x { color: #fff; }\n');
    write('src/b.css', '.y { color: var(--mystery); }\n');
    const report = formatFindings(evaluate(dir));
    expect(report).toContain('BLOCKING');
    expect(report).toContain('ADVISORY');
    expect(report.indexOf('BLOCKING')).toBeLessThan(report.indexOf('ADVISORY'));
    expect(report).toMatch(/src\/a\.css:1/);
  });

  it('reports when there is nothing to report', () => {
    expect(formatFindings([])).toMatch(/No design-contract findings/);
  });
});

describe('isComponentToken()', () => {
  it('matches a token named after its component', () => {
    expect(isComponentToken('--button-height-sm', 'Button')).toBe(true);
    expect(isComponentToken('--datatable-row-h', 'DataTable')).toBe(true);
  });

  it('rejects an unrelated token', () => {
    expect(isComponentToken('--text-muted', 'Button')).toBe(false);
  });
});

describe('the shipped template is a valid contract', () => {
  it('parses, and validates once its referenced files exist', () => {
    const templatePath = path.join(
      __dirname, '..', 'template', '.yuva', 'templates', 'design-contract.json',
    );
    const contract = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    expect(contract.version).toBe(CONTRACT_VERSION);

    write('src/styles/tokens.css', ':root {}\n');
    write('docs/components/Button.md', '# Button\n');
    write('docs/components/DataTable.md', '# DataTable\n');
    expect(validate(contract, dir)).toEqual([]);
  });

  it('declares no comment strings inside its glob arrays', () => {
    const templatePath = path.join(
      __dirname, '..', 'template', '.yuva', 'templates', 'design-contract.json',
    );
    const contract = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    for (const key of ['uiSource', 'exclude', 'provisional']) {
      for (const entry of contract[key] || []) {
        expect(entry, `${key} contains a comment string, which would be read as a glob`)
          .not.toMatch(/\$comment/);
      }
    }
  });
});

describe('the plugin gate wrapper', () => {
  const { BUILTIN_RULES } = require('../lib/plugin-gates');

  it('is registered as a built-in rule', () => {
    expect(BUILTIN_RULES['design-contract']).toBeDefined();
    expect(BUILTIN_RULES['design-contract'].severity).toBe('error');
    expect(typeof BUILTIN_RULES['design-contract'].run).toBe('function');
  });

  it('returns nothing for a project with no contract, despite defaulting to enabled', () => {
    expect(BUILTIN_RULES['design-contract'].run(dir)).toEqual([]);
  });

  it('emits findings in the plugin-gate shape, with the rule id in the message', () => {
    scaffold();
    write('src/a.css', '.x { color: #3b82f6; }\n');
    const findings = BUILTIN_RULES['design-contract'].run(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'src/a.css', line: 1 });
    expect(findings[0].message).toMatch(/^\[colour-literal\]/);
  });
});
