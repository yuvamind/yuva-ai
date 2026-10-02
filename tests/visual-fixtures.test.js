const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  FREEZE_CSS,
  DEFAULT_BASELINE_DIR,
  DEFAULT_DIFF_THRESHOLD,
  DEFAULT_PIXEL_TOLERANCE,
  resolveFixtures,
  runSeed,
  contextOptions,
  baselineDecision,
  baselinePath,
  comparePngsInPage,
} = require('../lib/visual-fixtures');
const { resolveConfig } = require('../lib/visual-gate');

let dir;

const write = (rel, contents) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return file;
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-fixtures-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */

describe('resolveFixtures()', () => {
  it('returns a usable object for an empty config, so callers never branch on absence', () => {
    const fx = resolveFixtures({});
    expect(fx.mocks).toEqual([]);
    expect(fx.mask).toEqual([]);
    expect(fx.storageState).toBeNull();
    expect(fx.seedCommand).toBeNull();
    expect(fx.freezeTime).toBeNull();
    expect(fx.waitFor).toBeNull();
  });

  it('freezes animations by default — a flaky gate gets switched off', () => {
    expect(resolveFixtures({}).freezeAnimations).toBe(true);
    expect(resolveFixtures({ fixtures: { freezeAnimations: false } }).freezeAnimations).toBe(false);
  });

  it('leaves baselines OFF until a baseline block is present', () => {
    expect(resolveFixtures({}).baseline.enabled).toBe(false);
    expect(resolveFixtures({ baseline: {} }).baseline.enabled).toBe(true);
    expect(resolveFixtures({ baseline: false }).baseline.enabled).toBe(false);
    expect(resolveFixtures({ baseline: { enabled: false } }).baseline.enabled).toBe(false);
  });

  it('applies baseline defaults', () => {
    const b = resolveFixtures({ baseline: {} }).baseline;
    expect(b.dir).toBe(DEFAULT_BASELINE_DIR);
    expect(b.threshold).toBe(DEFAULT_DIFF_THRESHOLD);
    expect(b.pixelTolerance).toBe(DEFAULT_PIXEL_TOLERANCE);
    expect(b.update).toBe(false);
  });

  it('honours explicit baseline values, including a zero threshold', () => {
    const b = resolveFixtures({
      baseline: { dir: 'snapshots', threshold: 0, pixelTolerance: 0, update: true },
    }).baseline;
    expect(b.dir).toBe('snapshots');
    expect(b.threshold).toBe(0);
    expect(b.pixelTolerance).toBe(0);
    expect(b.update).toBe(true);
  });

  it('drops malformed mocks rather than crashing on them later', () => {
    const fx = resolveFixtures({
      fixtures: { mocks: [{ url: '**/api/**' }, { noUrl: true }, null, 'nope'] },
    });
    expect(fx.mocks).toHaveLength(1);
    expect(fx.mocks[0].url).toBe('**/api/**');
  });

  it('drops non-string mask selectors', () => {
    expect(resolveFixtures({ fixtures: { mask: ['.a', 42, null] } }).mask).toEqual(['.a']);
  });

  it('ignores a non-object fixtures block', () => {
    expect(resolveFixtures({ fixtures: 'yes' }).freezeAnimations).toBe(true);
  });
});

describe('visual-gate config carries fixtures through', () => {
  it('exposes resolved fixtures on the gate config', () => {
    write('.yuva/config.json', {
      visual: {
        url: 'http://localhost:3000',
        fixtures: { seedCommand: 'npm run seed', waitFor: '[data-ready]' },
        baseline: { threshold: 0.002 },
      },
    });
    const cfg = resolveConfig(dir);
    expect(cfg.fixtures.seedCommand).toBe('npm run seed');
    expect(cfg.fixtures.waitFor).toBe('[data-ready]');
    expect(cfg.fixtures.baseline.enabled).toBe(true);
    expect(cfg.fixtures.baseline.threshold).toBe(0.002);
  });

  it('still resolves for a project with no fixtures block at all', () => {
    write('.yuva/config.json', { visual: {} });
    const cfg = resolveConfig(dir);
    expect(cfg.fixtures.baseline.enabled).toBe(false);
    expect(cfg.fixtures.freezeAnimations).toBe(true);
  });
});

describe('baselineDecision() — the policy, without a browser', () => {
  const threshold = 0.001;

  it('reports a first run as created, and is explicit that it verified nothing', () => {
    const d = baselineDecision({ baselineExisted: false, update: false, stats: null, threshold });
    expect(d.status).toBe('created');
    expect(d.message).toMatch(/established it rather than verifying/);
  });

  it('reports an explicit update', () => {
    const d = baselineDecision({ baselineExisted: true, update: true, stats: null, threshold });
    expect(d.status).toBe('updated');
  });

  it('prefers created over updated on a first run', () => {
    expect(baselineDecision({ baselineExisted: false, update: true, stats: null, threshold }).status)
      .toBe('created');
  });

  it('passes an identical render', () => {
    const stats = { sizeMismatch: false, diffPixels: 0, totalPixels: 10000, ratio: 0 };
    expect(baselineDecision({ baselineExisted: true, update: false, stats, threshold }).status)
      .toBe('match');
  });

  it('tolerates sub-threshold noise', () => {
    const stats = { sizeMismatch: false, diffPixels: 5, totalPixels: 10000, ratio: 0.0005 };
    expect(baselineDecision({ baselineExisted: true, update: false, stats, threshold }).status)
      .toBe('match');
  });

  it('fails above the threshold, quoting both counts and the percentage', () => {
    const stats = { sizeMismatch: false, diffPixels: 500, totalPixels: 10000, ratio: 0.05 };
    const d = baselineDecision({ baselineExisted: true, update: false, stats, threshold });
    expect(d.status).toBe('regression');
    expect(d.message).toContain('500');
    expect(d.message).toContain('10000');
    expect(d.message).toContain('5.000%');
  });

  it('treats exactly-at-threshold as a pass, not a failure', () => {
    const stats = { sizeMismatch: false, diffPixels: 10, totalPixels: 10000, ratio: 0.001 };
    expect(baselineDecision({ baselineExisted: true, update: false, stats, threshold }).status)
      .toBe('match');
  });

  it('reports a size change as its own status, with both sizes', () => {
    const stats = {
      sizeMismatch: true,
      baseline: { width: 375, height: 800 },
      current: { width: 375, height: 1200 },
      ratio: 1,
    };
    const d = baselineDecision({ baselineExisted: true, update: false, stats, threshold });
    expect(d.status).toBe('size-mismatch');
    expect(d.message).toContain('375x800');
    expect(d.message).toContain('375x1200');
  });

  it('says so when the comparison could not run, rather than passing', () => {
    const d = baselineDecision({ baselineExisted: true, update: false, stats: null, threshold });
    expect(d.status).toBe('unavailable');
    expect(d.message).toMatch(/could not be compared/);
  });

  it('a zero threshold means any difference at all fails', () => {
    const stats = { sizeMismatch: false, diffPixels: 1, totalPixels: 10000, ratio: 0.0001 };
    expect(baselineDecision({ baselineExisted: true, update: false, stats, threshold: 0 }).status)
      .toBe('regression');
  });
});

describe('baselinePath()', () => {
  it('builds a stable per-route-per-viewport path', () => {
    const p = baselinePath(dir, '.yuva/visual-baseline', 'pricing--mobile');
    expect(p.split(path.sep).join('/')).toContain('.yuva/visual-baseline/pricing--mobile.png');
  });
});

describe('contextOptions()', () => {
  it('passes storageState through when the file exists', () => {
    write('auth.json', { cookies: [], origins: [] });
    const options = contextOptions(dir, resolveFixtures({ fixtures: { storageState: 'auth.json' } }));
    expect(options.storageState).toBeTruthy();
  });

  it('omits storageState when the file is missing, rather than failing the whole run', () => {
    const options = contextOptions(dir, resolveFixtures({ fixtures: { storageState: 'nope.json' } }));
    expect(options.storageState).toBeUndefined();
  });

  it('is empty with no auth configured', () => {
    expect(contextOptions(dir, resolveFixtures({}))).toEqual({});
  });
});

describe('runSeed()', () => {
  it('is a no-op with no seed command', () => {
    expect(runSeed(dir, null)).toEqual({ ok: true, output: null });
  });

  it('succeeds on a command that exits 0', () => {
    const result = runSeed(dir, 'node -e "process.exit(0)"');
    expect(result.ok).toBe(true);
  });

  it('fails loudly on a non-zero exit, carrying the output', () => {
    const result = runSeed(dir, 'node -e "console.error(\'seed blew up\'); process.exit(3)"');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('seed blew up');
  });
});

describe('FREEZE_CSS', () => {
  it('pauses animations rather than only zeroing their duration', () => {
    // A zero-duration infinite animation still advances, so a spinner would
    // freeze on an arbitrary frame and the diff would flake every run.
    expect(FREEZE_CSS).toMatch(/animation-play-state:\s*paused/);
    expect(FREEZE_CSS).toMatch(/animation-duration:\s*0s/);
  });

  it('kills the other per-run differences: caret, smooth scroll, selection', () => {
    expect(FREEZE_CSS).toMatch(/caret-color:\s*transparent/);
    expect(FREEZE_CSS).toMatch(/scroll-behavior:\s*auto/);
    expect(FREEZE_CSS).toMatch(/::selection/);
  });
});

describe('comparePngsInPage() contract', () => {
  it('is self-contained, so it can be serialised into the page', () => {
    const source = comparePngsInPage.toString();
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).toMatch(/document\.createElement\('canvas'\)/);
    expect(source).toMatch(/getImageData/);
  });

  it('short-circuits on a size mismatch instead of comparing mismatched buffers', () => {
    const source = comparePngsInPage.toString();
    expect(source).toMatch(/sizeMismatch:\s*true/);
  });

  it('returns raw counts and leaves the verdict to Node', () => {
    const source = comparePngsInPage.toString();
    expect(source).toMatch(/diffPixels/);
    expect(source).toMatch(/totalPixels/);
    // No threshold logic in the browser half — that lives in baselineDecision.
    expect(source).not.toMatch(/threshold/);
  });

  it('uses willReadFrequently, because getImageData on a GPU canvas is slow', () => {
    expect(comparePngsInPage.toString()).toMatch(/willReadFrequently/);
  });
});
