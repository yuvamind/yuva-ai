const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveConfig, isConfigured, detectStartCommand, DEFAULT_VIEWPORTS } = require('../lib/visual-gate');
const { detectGates, GATE_ORDER, NATIVE_VISUAL } = require('../lib/gate-runner');

let dir;

const write = (rel, contents) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-visual-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('resolveConfig()', () => {
  it('returns null when the project has no yuva config at all', () => {
    expect(resolveConfig(dir)).toBeNull();
    expect(isConfigured(dir)).toBe(false);
  });

  it('returns null when config exists but omits "visual"', () => {
    write('.yuva/config.json', { llm: 'claude' });
    expect(resolveConfig(dir)).toBeNull();
  });

  it('returns null when the gate is explicitly disabled', () => {
    write('.yuva/config.json', { visual: false });
    expect(resolveConfig(dir)).toBeNull();
    expect(isConfigured(dir)).toBe(false);
  });

  it('fills in defaults for an empty visual block', () => {
    write('.yuva/config.json', { visual: {} });
    write('package.json', { scripts: { dev: 'vite' } });
    const cfg = resolveConfig(dir);
    expect(cfg.url).toBe('http://localhost:5173');
    expect(cfg.routes).toEqual(['/']);
    expect(cfg.viewports).toEqual(DEFAULT_VIEWPORTS);
    expect(cfg.strict).toBe(false);
    expect(cfg.startCommand).toBe('npm run dev');
  });

  it('honours explicit values and strips a trailing slash from the url', () => {
    write('.yuva/config.json', {
      visual: {
        url: 'http://localhost:3000/',
        routes: ['/', '/pricing'],
        viewports: [{ name: 'wide', width: 1920, height: 1080 }],
        strict: true,
        thresholds: { maxFontSizes: 5 },
      },
    });
    const cfg = resolveConfig(dir);
    expect(cfg.url).toBe('http://localhost:3000');
    expect(cfg.routes).toEqual(['/', '/pricing']);
    expect(cfg.viewports).toHaveLength(1);
    expect(cfg.strict).toBe(true);
    expect(cfg.thresholds.maxFontSizes).toBe(5);
  });

  it('treats startCommand:false as "the app is already running"', () => {
    write('package.json', { scripts: { dev: 'vite' } });
    write('.yuva/config.json', { visual: { startCommand: false } });
    expect(resolveConfig(dir).startCommand).toBeNull();
  });

  it('falls back to defaults for empty arrays rather than rendering nothing', () => {
    write('.yuva/config.json', { visual: { routes: [], viewports: [] } });
    const cfg = resolveConfig(dir);
    expect(cfg.routes).toEqual(['/']);
    expect(cfg.viewports).toEqual(DEFAULT_VIEWPORTS);
  });

  it('carries the axe opt-out through, so `axe: false` actually disables it', () => {
    // This was omitted from the resolved config, which made the opt-out a silent
    // no-op — axe ran regardless, and then deduped away the built-in
    // accessible-name rule.
    write('.yuva/config.json', { visual: { axe: false } });
    expect(resolveConfig(dir).axe).toBe(false);

    write('.yuva/config.json', { visual: {} });
    expect(resolveConfig(dir).axe).toBe(true);

    write('.yuva/config.json', { visual: { axeTags: ['wcag2aa'] } });
    expect(resolveConfig(dir).axeTags).toEqual(['wcag2aa']);
  });

  it('defaults text zoom to 200% and allows switching it off', () => {
    write('.yuva/config.json', { visual: {} });
    expect(resolveConfig(dir).zoomLevels).toEqual([200]);
    write('.yuva/config.json', { visual: { zoomLevels: [] } });
    expect(resolveConfig(dir).zoomLevels).toEqual([]);
  });

  it('reads the legacy .aiautomations layout too', () => {
    write('.aiautomations/config.json', { visual: { url: 'http://localhost:4321' } });
    expect(resolveConfig(dir).url).toBe('http://localhost:4321');
  });
});

describe('detectStartCommand()', () => {
  it('prefers dev over start, serve and preview', () => {
    write('package.json', { scripts: { preview: 'vite preview', start: 'node .', dev: 'vite' } });
    expect(detectStartCommand(dir)).toBe('npm run dev');
  });

  it('falls through the preference order', () => {
    write('package.json', { scripts: { serve: 'http-server' } });
    expect(detectStartCommand(dir)).toBe('npm run serve');
  });

  it('returns null when nothing looks like a server', () => {
    write('package.json', { scripts: { test: 'vitest' } });
    expect(detectStartCommand(dir)).toBeNull();
    expect(detectStartCommand(path.join(dir, 'nope'))).toBeNull();
  });
});

describe('gate-runner integration', () => {
  it('lists visual last, after the text-only gates', () => {
    expect(GATE_ORDER).toEqual(['lint', 'typecheck', 'test', 'build', 'visual']);
  });

  it('does NOT add a visual gate to a project that has not opted in', () => {
    // The upgrade-safety guarantee: existing installs see no new gate.
    write('package.json', { scripts: { lint: 'eslint .', build: 'vite build' } });
    const names = detectGates(dir).map(g => g.name);
    expect(names).toEqual(['lint', 'build']);
    expect(names).not.toContain('visual');
  });

  it('adds the visual gate once configured, marked native', () => {
    write('package.json', { scripts: { lint: 'eslint .', dev: 'vite' } });
    write('.yuva/config.json', { visual: { url: 'http://localhost:5173' } });
    const gates = detectGates(dir);
    const visual = gates.find(g => g.name === 'visual');
    expect(visual).toBeDefined();
    expect(visual.native).toBe('visual');
    expect(visual.command).toBe(NATIVE_VISUAL);
    expect(gates[gates.length - 1].name).toBe('visual');
  });

  it('does not mark the ordinary gates as native', () => {
    write('package.json', { scripts: { lint: 'eslint .' } });
    const lint = detectGates(dir).find(g => g.name === 'lint');
    expect(lint.native).toBeUndefined();
  });

  it('respects visual:false even when everything else is present', () => {
    write('package.json', { scripts: { dev: 'vite' } });
    write('.yuva/config.json', { visual: false });
    expect(detectGates(dir).map(g => g.name)).not.toContain('visual');
  });

  it('lets a string override replace the native gate with a shell command', () => {
    write('package.json', { scripts: { dev: 'vite' } });
    write('.yuva/config.json', { gates: { visual: 'npm run my-visual-check' }, visual: {} });
    const visual = detectGates(dir).find(g => g.name === 'visual');
    expect(visual.command).toBe('npm run my-visual-check');
    expect(visual.native).toBeUndefined();
  });

  it('can still be skipped by name with the "only" filter', () => {
    write('package.json', { scripts: { lint: 'eslint .', dev: 'vite' } });
    write('.yuva/config.json', { visual: {} });
    const names = detectGates(dir).filter(g => ['lint'].includes(g.name)).map(g => g.name);
    expect(names).toEqual(['lint']);
  });
});
