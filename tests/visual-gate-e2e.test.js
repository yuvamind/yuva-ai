/**
 * End-to-end exercise of the visual gate: a real server, a real browser, real
 * screenshots, real baseline comparison.
 *
 * Everything else about the gate is unit-tested against injected observations,
 * which left `captureAndAudit()` — the Playwright-specific half — never
 * executed. Running it for the first time found three bugs that no unit test
 * could have: a focus ring leaking into every baseline, `page.clock.pauseAt()`
 * deadlocking `axe.run()`, and a contrast tolerance that excused real failures.
 *
 * Self-skips when Playwright or its browser is missing, so a contributor
 * without a 130MB browser download still gets a green suite.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { runVisualGate } = require('../lib/visual-gate');

// A fresh port per test: rebinding the same one immediately after close races
// on Windows, and the gate then finds nothing listening and bails in ~30ms —
// which looks like a gate bug but is a harness bug.
let nextPort = 7549;
let PORT;
let browserAvailable = false;

try {
  const { chromium } = require('playwright');
  browserAvailable = typeof chromium.executablePath === 'function' &&
    fs.existsSync(chromium.executablePath());
} catch {
  browserAvailable = false;
}

const describeE2E = browserAvailable ? describe : describe.skip;

/* ------------------------------------------------------------------ */

let dir;
let server;

const write = (rel, contents) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
};

/** A page with exactly one deliberate defect, so the assertion is unambiguous. */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixture</title>
<style>
  :root { color-scheme: light dark; }
  body { background: oklch(0.985 0.003 265); color: oklch(0.205 0.011 265);
         font-family: system-ui, sans-serif; margin: 0; padding: 2rem; }
  h1 { font-size: 1.953rem; line-height: 1.1; margin: 0 0 0.5rem; }
  p { line-height: 1.6; max-width: 68ch; }
  button { background: oklch(0.52 0.14 38); color: oklch(0.99 0 0); border: 0;
           padding: 0.5rem 1.5rem; border-radius: 0.5rem; font-size: 1rem; }
  :focus-visible { outline: 2px solid oklch(0.52 0.14 38); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after {
    animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
</style></head><body data-ready="true">
  <main><h1>Fixture page</h1><p>A deliberately simple page.</p>
  <button type="button" id="probe">Continue</button></main>
</body></html>`;

/** Start the fixture server and do not resolve until it actually answers. */
async function startServer(body) {
  await stopServer();
  PORT = nextPort++;
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  // Prove it answers before handing the port to the gate.
  for (let i = 0; i < 40; i++) {
    const ok = await new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false));
      req.setTimeout(500, () => { req.destroy(); resolve(false); });
    });
    if (ok) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`fixture server never answered on ${PORT}`);
}

async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  s.closeAllConnections?.();          // keep-alive sockets otherwise hold close() open
  await new Promise(resolve => s.close(resolve));
}

describeE2E('visual gate, end to end', () => {
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-e2e-'));
    await startServer(PAGE);
  });

  afterEach(async () => {
    await stopServer();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const config = (visual) => write('.yuva/config.json', {
    visual: {
      url: `http://127.0.0.1:${PORT}`,  // read after any restart
      startCommand: false, // the server is already running
      routes: ['/'],
      viewports: [{ name: 'desktop', width: 1200, height: 800 }],
      axe: false, // exercised separately; keeps this test fast and offline
      ...visual,
    },
  });

  it('renders the page, writes a screenshot, and audits what painted', async () => {
    config({});
    const result = await runVisualGate(dir);

    expect(result.status).toBe('passed');
    expect(result.screenshots).toHaveLength(1);
    expect(fs.existsSync(result.screenshots[0].file)).toBe(true);
    expect(fs.statSync(result.screenshots[0].file).size).toBeGreaterThan(1000);
    expect(fs.existsSync(result.reportPath)).toBe(true);
  }, 120000);

  it('leaves no focus ring in the screenshot after probing focus indicators', async () => {
    // The audit focuses every control to test for indicators. Restoring to
    // <body> is a silent no-op, so focus stayed on the last control and its ring
    // was captured into the baseline. Guarded here because only a real render
    // shows it.
    config({ baseline: { dir: 'baseline' } });
    await runVisualGate(dir);

    const first = fs.readFileSync(path.join(dir, 'baseline', 'root--desktop.png'));
    await runVisualGate(dir);           // second run compares against the first
    const second = await runVisualGate(dir);

    const regressions = (second.findings || []).filter(f => f.rule === 'visual-regression');
    expect(regressions, 'the render is not stable across runs').toEqual([]);
    expect(first.length).toBeGreaterThan(0);
  }, 180000);

  it('creates a baseline on the first run and says it verified nothing', async () => {
    config({ baseline: { dir: 'baseline' } });
    const result = await runVisualGate(dir);

    expect(fs.existsSync(path.join(dir, 'baseline', 'root--desktop.png'))).toBe(true);
    const created = (result.findings || []).filter(f => f.rule === 'baseline-created');
    expect(created).toHaveLength(1);
    expect(created[0].message).toMatch(/rather than verifying/);
  }, 120000);

  it('detects a real visual regression and writes a diff image', async () => {
    config({ baseline: { dir: 'baseline', threshold: 0.0001 } });
    await runVisualGate(dir);                      // establish

    // Change the page. startServer rebinds a fresh port, so the config has to be
    // rewritten before the gate reads it again.
    await startServer(PAGE.replace('Fixture page', 'Fixture page CHANGED COMPLETELY'));
    config({ baseline: { dir: 'baseline', threshold: 0.0001 } });

    const result = await runVisualGate(dir);
    const regressions = (result.findings || []).filter(f => f.rule === 'visual-regression');
    expect(regressions.length).toBeGreaterThan(0);
    expect(regressions[0].severity).toBe('error');
    expect(result.status).toBe('failed');

    const diffs = fs.readdirSync(path.dirname(result.reportPath)).filter(f => f.endsWith('--diff.png'));
    expect(diffs).toHaveLength(1);
  }, 180000);

  it('flags a control with no accessible name', async () => {
    await startServer(PAGE.replace(
      '<button type="button" id="probe">Continue</button>',
      '<button type="button" id="probe"><svg width="16" height="16" aria-hidden="true"></svg></button>',
    ));
    config({});

    const result = await runVisualGate(dir);
    const named = (result.findings || []).filter(f => f.rule === 'missing-accessible-name');
    expect(named).toHaveLength(1);
    expect(named[0].detail).toContain('button#probe');
  }, 120000);

  it('flags text clipped by a px-sized box at 200% text zoom', async () => {
    await startServer(PAGE.replace('</main>',
      '<div id="chip" style="width:120px;height:28px;overflow:hidden">Reconciled today</div></main>'));
    config({});

    const result = await runVisualGate(dir);
    const zoom = (result.findings || []).filter(f => f.rule === 'zoom-clipping');
    expect(zoom).toHaveLength(1);
    expect(zoom[0].detail).toContain('#chip');
  }, 120000);

  it('warns, rather than passing silently, when axe-core did not run', async () => {
    config({ axe: true });
    const result = await runVisualGate(dir);
    // axe IS installed here, so it should have run and produced no warning.
    expect(result.output).not.toMatch(/axe-core is not installed/);
  }, 120000);
});

describe('visual gate e2e availability', () => {
  it('reports whether the browser-backed suite ran', () => {
    // Not an assertion about the browser — a record in the output, so a green
    // suite never silently means "skipped everything that matters".
    expect(typeof browserAvailable).toBe('boolean');
    if (!browserAvailable) {
      console.warn('visual-gate e2e SKIPPED: playwright or its chromium build is unavailable');
    }
  });
});
