/**
 * Deterministic visual fixtures, and baseline comparison.
 *
 * Without this the visual gate renders whatever the app happens to show, so a
 * screenshot of an empty shell passes while the real application is broken. The
 * gate needs the page to look the same way twice: same auth, same data, no
 * animation mid-flight, no clock drift, no un-stubbed network.
 *
 * Baseline diffing runs **inside the Chromium the gate already launched**, via
 * canvas. The alternatives were worse: `toHaveScreenshot` lives in
 * `@playwright/test` (a whole second test runner, in a repo that standardises on
 * one), and pixelmatch/pngjs would add dependencies to a package that keeps
 * Playwright itself an optional peer. The browser can already decode PNG and
 * walk pixels, so it does.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { debug } from './debug';

import type { Browser, BrowserContextOptions, Locator, Page } from 'playwright';

/** A network mock as configured by the user: a URL pattern plus a response. */
export interface FixtureMock {
  url: string;
  /** Response body inline, or ... */
  body?: string;
  /** ... a file under the project root to read it from. */
  file?: string;
  status?: number;
  contentType?: string;
  [key: string]: unknown;
}

export interface BaselineConfig {
  enabled: boolean;
  dir: string;
  threshold: number;
  pixelTolerance: number;
  update: boolean;
}

/** The validated fixtures config, with every field present and defaulted. */
export interface ResolvedFixtures {
  storageState: string | null;
  seedCommand: string | null;
  mocks: FixtureMock[];
  freezeAnimations: boolean;
  freezeTime: string | null;
  waitFor: string | null;
  mask: string[];
  baseline: BaselineConfig;
}

/** What comparePngsInPage() reports back from inside the browser. */
export interface CompareStats {
  sizeMismatch?: boolean;
  baseline?: { width: number; height: number };
  current?: { width: number; height: number };
  diffPixels: number;
  totalPixels?: number;
  ratio?: number;
  diffDataUrl?: string | null;
}

export type BaselineStatus = 'created' | 'updated' | 'unavailable' | 'size-mismatch' | 'regression' | 'match';

export interface BaselineDecision {
  status: BaselineStatus;
  message: string | null;
}

export interface CompareToBaselineInput {
  page: Page;
  targetDir: string;
  outDir: string;
  name: string;
  currentFile: string;
  baseline: BaselineConfig;
}


const DEFAULT_BASELINE_DIR = '.yuva/visual-baseline';
/** Fraction of differing pixels tolerated before a route is a regression. */
const DEFAULT_DIFF_THRESHOLD = 0.001;
/** Per-channel delta below which two pixels count as equal (anti-aliasing noise). */
const DEFAULT_PIXEL_TOLERANCE = 12;
const SEED_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Everything that makes a render non-reproducible, switched off.
 *
 * Note `animation-play-state: paused` rather than only zeroing durations: a
 * zero-duration infinite animation still advances, and a spinner frozen at an
 * arbitrary frame is exactly the flake this exists to remove.
 */
const FREEZE_CSS = `
*, *::before, *::after {
  animation-play-state: paused !important;
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  animation-iteration-count: 1 !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}
/* Blinking carets and text selection are the other two per-run differences. */
*::selection { background: transparent !important; }
`;

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

/**
 * Normalise the `visual.fixtures` and `visual.baseline` blocks.
 * Always returns an object, so callers never branch on absence.
 */
function resolveFixtures(cfg: Record<string, any> = {}): ResolvedFixtures {
  const f = cfg.fixtures && typeof cfg.fixtures === 'object' ? cfg.fixtures : {};
  const b = cfg.baseline && typeof cfg.baseline === 'object' ? cfg.baseline : {};

  return {
    storageState: typeof f.storageState === 'string' ? f.storageState : null,
    seedCommand: typeof f.seedCommand === 'string' ? f.seedCommand : null,
    mocks: Array.isArray(f.mocks) ? f.mocks.filter((m: any) => m && typeof m.url === 'string') : [],
    // Freezing is the default: a gate that flakes gets switched off.
    freezeAnimations: f.freezeAnimations !== false,
    freezeTime: typeof f.freezeTime === 'string' ? f.freezeTime : null,
    waitFor: typeof f.waitFor === 'string' ? f.waitFor : null,
    mask: Array.isArray(f.mask) ? f.mask.filter((s: unknown) => typeof s === 'string') : [],

    baseline: {
      enabled: cfg.baseline !== false && (b.enabled !== false) && Boolean(cfg.baseline),
      dir: typeof b.dir === 'string' ? b.dir : DEFAULT_BASELINE_DIR,
      threshold: Number.isFinite(b.threshold) ? b.threshold : DEFAULT_DIFF_THRESHOLD,
      pixelTolerance: Number.isFinite(b.pixelTolerance) ? b.pixelTolerance : DEFAULT_PIXEL_TOLERANCE,
      update: b.update === true,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Seeding
 * ------------------------------------------------------------------ */

/**
 * Run the seed command once, before any rendering.
 * @returns {{ ok: boolean, output: string|null }}
 */
function runSeed(targetDir: string, seedCommand: string | null): { ok: boolean; output: string | null } {
  if (!seedCommand) return { ok: true, output: null };
  const result = spawnSync(seedCommand, {
    cwd: targetDir,
    shell: true,
    encoding: 'utf8',
    timeout: SEED_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim() ||
      (result.error && result.error.message) || `exited ${result.status}`;
    return { ok: false, output: output.slice(-2000) };
  }
  return { ok: true, output: null };
}

/* ------------------------------------------------------------------ *
 * Applying fixtures to a page
 * ------------------------------------------------------------------ */

/** Context options contributed by the fixtures (auth state, mainly). */
function contextOptions(targetDir: string, fixtures: ResolvedFixtures) {
  const options: BrowserContextOptions = {};
  if (fixtures.storageState) {
    const file = path.join(targetDir, fixtures.storageState);
    if (fs.existsSync(file)) options.storageState = file;
    else debug('visual-fixtures', `storageState not found: ${file}`);
  }
  return options;
}

/**
 * Install network stubs and a fixed clock. Call before navigating.
 * @returns {Promise<string[]>} warnings worth surfacing
 */
async function installFixtures(page: Page, targetDir: string, fixtures: ResolvedFixtures) {
  const warnings: string[] = [];

  for (const mock of fixtures.mocks) {
    const bodyFile = mock.file ? path.join(targetDir, mock.file) : null;
    let body = typeof mock.body === 'string' ? mock.body : null;
    if (bodyFile) {
      try {
        body = fs.readFileSync(bodyFile, 'utf8');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        warnings.push(`mock for ${mock.url}: could not read ${mock.file} (${e.code || e.message})`);
        continue;
      }
    }
    try {
      await page.route(mock.url, (route) => route.fulfill({
        status: mock.status || 200,
        contentType: mock.contentType || 'application/json',
        body: body === null ? '{}' : body,
      }));
    } catch (err) {
      warnings.push(`mock for ${mock.url} could not be installed: ${(err as Error).message}`);
    }
  }

  if (fixtures.freezeTime) {
    // page.clock landed in Playwright 1.45. Degrade with a warning rather than
    // crashing an otherwise working gate on an older install.
    if (page.clock && typeof page.clock.install === 'function') {
      try {
        const at = new Date(fixtures.freezeTime);
        await page.clock.install({ time: at });
        // setFixedTime, NOT pauseAt. Pausing stops every timer in the page, and
        // anything that waits on one then never resolves — axe.run() deadlocks
        // this way, and so does any app that finishes loading on a timeout.
        // What this fixture is actually for is a deterministic *displayed* time,
        // which setFixedTime gives without stopping the world.
        if (typeof page.clock.setFixedTime === 'function') {
          await page.clock.setFixedTime(at);
        }
      } catch (err) {
        warnings.push(`freezeTime failed: ${(err as Error).message}`);
      }
    } else {
      warnings.push('freezeTime needs Playwright >= 1.45 (page.clock); time is not frozen');
    }
  }

  return warnings;
}

/**
 * Wait for the page's own ready signal. Runs BEFORE the design audit, so the
 * audit sees the ready state rather than a skeleton.
 */
async function waitForReady(page: Page, fixtures: ResolvedFixtures) {
  const warnings: string[] = [];
  if (!fixtures.waitFor) return warnings;
  try {
    await page.waitForSelector(fixtures.waitFor, { timeout: 15000 });
  } catch {
    warnings.push(`waitFor selector never appeared: ${fixtures.waitFor} — the page may have been captured before it was ready`);
  }
  return warnings;
}

/**
 * Stop all motion, for a reproducible screenshot.
 *
 * MUST run AFTER the design audit, never before. The audit reads
 * `transitionDuration` and `transitionProperty` from computed style, and
 * freezing sets both to `0s` — which would silently disable the `transition-all`
 * rule and make every page look compliant. Ordering is load-bearing here.
 */
async function freezeMotion(page: Page, fixtures: ResolvedFixtures) {
  const warnings: string[] = [];
  if (!fixtures.freezeAnimations) return warnings;
  try {
    await page.addStyleTag({ content: FREEZE_CSS });
  } catch (err) {
    warnings.push(`could not freeze animations: ${(err as Error).message}`);
  }
  return warnings;
}

/** Screenshot options contributed by the fixtures (masking, mainly). */
function screenshotOptions(page: Page, fixtures: ResolvedFixtures) {
  const options: { fullPage: boolean; mask?: Locator[] } = { fullPage: true };
  if (fixtures.mask.length > 0 && typeof page.locator === 'function') {
    options.mask = fixtures.mask.map(selector => page.locator(selector));
  }
  return options;
}

/* ------------------------------------------------------------------ *
 * Baseline comparison
 * ------------------------------------------------------------------ */

/**
 * Compare two PNGs, in the page.
 *
 * Serialised into the browser, so it must be self-contained. Returns raw
 * counts only — the pass/fail decision is made in Node by baselineDecision(),
 * which keeps it unit-testable.
 */
function comparePngsInPage(baselineDataUrl: string, currentDataUrl: string, pixelTolerance: number): Promise<CompareStats> {
  const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode PNG'));
    img.src = src;
  });

  return Promise.all([load(baselineDataUrl), load(currentDataUrl)]).then(([a, b]) => {
    if (a.width !== b.width || a.height !== b.height) {
      return {
        sizeMismatch: true,
        baseline: { width: a.width, height: a.height },
        current: { width: b.width, height: b.height },
        diffPixels: 0,
        totalPixels: 0,
        ratio: 1,
        diffDataUrl: null,
      };
    }

    const { width, height } = a;
    const draw = (img: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, width, height);
    };

    const left = draw(a);
    const right = draw(b);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const outCtx = out.getContext('2d')!;
    const diff = outCtx.createImageData(width, height);

    let diffPixels = 0;
    for (let i = 0; i < left.data.length; i += 4) {
      const dr = Math.abs(left.data[i] - right.data[i]);
      const dg = Math.abs(left.data[i + 1] - right.data[i + 1]);
      const db = Math.abs(left.data[i + 2] - right.data[i + 2]);
      const da = Math.abs(left.data[i + 3] - right.data[i + 3]);
      const changed = Math.max(dr, dg, db, da) > pixelTolerance;

      if (changed) {
        diffPixels++;
        // Magenta on the changed pixels, the unchanged page dimmed behind them.
        diff.data[i] = 255;
        diff.data[i + 1] = 0;
        diff.data[i + 2] = 255;
        diff.data[i + 3] = 255;
      } else {
        diff.data[i] = right.data[i];
        diff.data[i + 1] = right.data[i + 1];
        diff.data[i + 2] = right.data[i + 2];
        diff.data[i + 3] = 60;
      }
    }

    outCtx.putImageData(diff, 0, 0);
    const totalPixels = width * height;
    return {
      sizeMismatch: false,
      baseline: { width, height },
      current: { width, height },
      diffPixels,
      totalPixels,
      ratio: totalPixels === 0 ? 0 : diffPixels / totalPixels,
      diffDataUrl: out.toDataURL('image/png'),
    };
  });
}

/**
 * Decide what a comparison means. Pure, so the policy is testable without a
 * browser — which is where every interesting edge case lives.
 *
 * @returns {{ status:'created'|'updated'|'match'|'regression'|'size-mismatch'|'unavailable', message:string|null }}
 */
function baselineDecision({ baselineExisted, update, stats, threshold }: {
  baselineExisted: boolean; update: boolean; stats: CompareStats | null; threshold: number;
}): BaselineDecision {
  if (!baselineExisted) {
    return {
      status: 'created',
      message: 'baseline did not exist and has been written — this run established it rather than verifying anything',
    };
  }
  if (update) {
    return { status: 'updated', message: 'baseline overwritten because baseline.update is true' };
  }
  if (!stats) {
    return { status: 'unavailable', message: 'screenshots could not be compared' };
  }
  if (stats.sizeMismatch) {
    // Both are always populated alongside sizeMismatch by comparePngsInPage.
    const b = stats.baseline!;
    const c = stats.current!;
    return {
      status: 'size-mismatch',
      message: `page size changed: baseline ${b.width}x${b.height}, now ${c.width}x${c.height} — a layout change this large is a regression unless it was intended`,
    };
  }
  // `?? 0` for the checker only: ratio is always set once sizeMismatch is ruled
  // out above, so this fallback is never taken at runtime.
  const ratio = stats.ratio ?? 0;
  const pct = (ratio * 100).toFixed(3);
  if (ratio > threshold) {
    return {
      status: 'regression',
      message: `${stats.diffPixels} of ${stats.totalPixels} pixels differ (${pct}%), over the ${(threshold * 100).toFixed(3)}% threshold`,
    };
  }
  return { status: 'match', message: null };
}

/** Path of the baseline for one route/viewport pair. */
function baselinePath(targetDir: string, baselineDir: string, name: string): string {
  return path.join(targetDir, baselineDir, `${name}.png`);
}

/**
 * Compare a freshly captured PNG against its baseline, writing the baseline on
 * first run. Needs a page to do the decoding in — any page will do.
 *
 * @returns {Promise<{decision:object, stats:object|null, diffFile:string|null}>}
 */
async function compareToBaseline({
  page, targetDir, outDir, name, currentFile, baseline,
}: CompareToBaselineInput) {
  const file = baselinePath(targetDir, baseline.dir, name);
  const baselineExisted = fs.existsSync(file);

  let currentBuffer: Buffer;
  try {
    currentBuffer = fs.readFileSync(currentFile);
  } catch (err) {
    debug('visual-fixtures', 'could not read screenshot', err);
    return {
      decision: baselineDecision({ baselineExisted, update: false, stats: null, threshold: baseline.threshold }),
      stats: null,
      diffFile: null,
    };
  }

  if (!baselineExisted || baseline.update) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, currentBuffer);
    return {
      decision: baselineDecision({ baselineExisted, update: baseline.update, stats: null, threshold: baseline.threshold }),
      stats: null,
      diffFile: null,
    };
  }

  let stats = null;
  try {
    const toDataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString('base64')}`;
    stats = await page.evaluate(
      ([a, b, tol]) => (window as unknown as { __yuvaComparePngs: typeof comparePngsInPage }).__yuvaComparePngs(a, b, tol),
      // A tuple, not an array: without the assertion TS widens this to
      // (string | number)[] and the destructured `tol` loses its number type.
      [toDataUrl(fs.readFileSync(file)), toDataUrl(currentBuffer), baseline.pixelTolerance] as [string, string, number],
    );
  } catch (err) {
    debug('visual-fixtures', 'in-page diff failed', err);
  }

  const decision = baselineDecision({
    baselineExisted, update: false, stats, threshold: baseline.threshold,
  });

  let diffFile = null;
  if (stats && stats.diffDataUrl && decision.status === 'regression') {
    diffFile = path.join(outDir, `${name}--diff.png`);
    try {
      fs.writeFileSync(diffFile, Buffer.from(stats.diffDataUrl.split(',')[1], 'base64'));
    } catch (err) {
      debug('visual-fixtures', 'could not write diff image', err);
      diffFile = null;
    }
  }

  return { decision, stats, diffFile };
}

/**
 * Expose the comparator on a blank page.
 *
 * Deliberately a dedicated page rather than the app's: a strict
 * `img-src 'self'` CSP on the application would block the `data:` URLs the
 * comparator loads, and a CSP is not a reason for the gate to stop working.
 */
async function createComparePage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('about:blank');
  await page.addInitScript(`window.__yuvaComparePngs = ${comparePngsInPage.toString()}`);
  await page.evaluate(`window.__yuvaComparePngs = ${comparePngsInPage.toString()}`);
  return { page, context };
}

export {
  FREEZE_CSS,
  DEFAULT_BASELINE_DIR,
  DEFAULT_DIFF_THRESHOLD,
  DEFAULT_PIXEL_TOLERANCE,
  resolveFixtures,
  runSeed,
  contextOptions,
  installFixtures,
  waitForReady,
  freezeMotion,
  screenshotOptions,
  comparePngsInPage,
  baselineDecision,
  baselinePath,
  compareToBaseline,
  createComparePage,
};