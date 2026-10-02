/**
 * Visual gate — boots the app, renders it, audits what actually painted.
 *
 * This is the gate that lint/typecheck/test/build cannot be: every other gate
 * in Yuva reads source text, so all four pass on UI that looks terrible. This
 * one opens a real browser, captures screenshots, and runs the design rules in
 * `design-audit.js` against the computed styles of the rendered page.
 *
 * Opt-in by design: unconfigured projects do not get a `visual` gate, so
 * existing installs are unaffected.
 *
 * Config (.yuva/config.json):
 *   "visual": {
 *     "url": "http://localhost:5173",
 *     "startCommand": "npm run dev",     // omit to auto-detect
 *     "routes": ["/", "/login"],
 *     "viewports": [{ "name": "mobile", "width": 375, "height": 812 }],
 *     "strict": false,                   // true = warnings also fail
 *     "thresholds": { "maxFontSizes": 9 },
 *
 *     // Determinism. Without these the gate renders whatever the app happens
 *     // to show, so a screenshot of an empty shell passes.
 *     "fixtures": {
 *       "seedCommand": "npm run seed:visual",
 *       "storageState": ".yuva/visual-auth.json",
 *       "mocks": [{ "url": "**\/api\/**", "file": "fixtures/api.json" }],
 *       "freezeAnimations": true,        // default; pauses, not just 0s
 *       "freezeTime": "2026-01-01T12:00:00Z",
 *       "waitFor": "[data-testid=ready]",
 *       "mask": [".timestamp"]
 *     },
 *
 *     // Regression detection. The FIRST run writes the baseline.
 *     "baseline": { "dir": ".yuva/visual-baseline", "threshold": 0.001 }
 *   }
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execSync } = require('child_process');
const { readJSON, ensureDir } = require('./fs-utils');
const { debug } = require('./debug');
const audit = require('./design-audit');
const fixturesLib = require('./visual-fixtures');
const axeRunner = require('./axe-runner');
const P = require('./paths');

// 320px, not 375, is the real floor — componentcontracts.md section 8 requires
// every contract to state its behaviour there, so the gate has to render it.
const DEFAULT_VIEWPORTS = [
  { name: 'narrow', width: 320, height: 568 },
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const DEFAULT_URL = 'http://localhost:5173';
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 750;
const PAGE_TIMEOUT_MS = 30_000;
const SETTLE_MS = 600;
/** WCAG 1.4.4 requires text to survive 200% enlargement. */
const DEFAULT_ZOOM_LEVELS = [200];

/** Marker the child runner prefixes its JSON verdict with (see visual-runner.js). */
const RESULT_PREFIX = '__YUVA_VISUAL_RESULT__';

/* ------------------------------------------------------------------ *
 * Config
 * ------------------------------------------------------------------ */

/** Guess the dev-server command from package.json scripts. */
function detectStartCommand(targetDir) {
  const pkg = readJSON(path.join(targetDir, 'package.json'));
  const scripts = (pkg && pkg.scripts) || {};
  for (const name of ['dev', 'start', 'serve', 'preview']) {
    if (scripts[name]) return `npm run ${name}`;
  }
  return null;
}

/** Resolve the effective visual-gate config, or null when not applicable. */
function resolveConfig(targetDir) {
  const cfg = (readJSON(P.configFile(targetDir)) || {}).visual;
  if (cfg === false) return null;
  if (!cfg) return null;

  const startCommand = cfg.startCommand === false
    ? null                                        // app already running
    : cfg.startCommand || detectStartCommand(targetDir);

  return {
    url: (cfg.url || DEFAULT_URL).replace(/\/+$/, ''),
    startCommand,
    routes: Array.isArray(cfg.routes) && cfg.routes.length ? cfg.routes : ['/'],
    viewports: Array.isArray(cfg.viewports) && cfg.viewports.length ? cfg.viewports : DEFAULT_VIEWPORTS,
    strict: cfg.strict === true,
    thresholds: cfg.thresholds || {},
    readyTimeoutMs: cfg.readyTimeoutMs || READY_TIMEOUT_MS,
    // Text-only zoom, per WCAG 1.4.4. `[]` switches it off.
    zoomLevels: Array.isArray(cfg.zoomLevels) ? cfg.zoomLevels.filter(Number.isFinite) : DEFAULT_ZOOM_LEVELS,
    // Must be carried through explicitly. Omitting it made `"axe": false` a
    // silent no-op: the opt-out read as `undefined`, axe ran anyway, and its
    // presence then suppressed the built-in accessible-name rule.
    axe: cfg.axe !== false,
    axeTags: Array.isArray(cfg.axeTags) ? cfg.axeTags : null,
    // Determinism and baselines. Without these the gate renders whatever the app
    // happens to show, so a screenshot of an empty shell passes.
    fixtures: fixturesLib.resolveFixtures(cfg),
  };
}

/** True when this project has the visual gate turned on. */
function isConfigured(targetDir) {
  return resolveConfig(targetDir) !== null;
}

/** Locate Playwright, preferring the target project's own install. */
function resolvePlaywright(targetDir) {
  for (const name of ['playwright', 'playwright-core', '@playwright/test']) {
    try {
      return require(require.resolve(name, { paths: [targetDir, __dirname] }));
    } catch { /* try next */ }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Dev server lifecycle
 * ------------------------------------------------------------------ */

function probe(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode > 0 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(url)) return true;
    await sleep(READY_POLL_MS);
  }
  return false;
}

/** Kill a process tree. Windows needs taskkill; POSIX gets the process group. */
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  // pid comes from Node, never from config — but assert it anyway so the
  // taskkill string below can never carry anything but digits.
  const pid = Number.parseInt(child.pid, 10);
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (err) {
    debug('visual-gate', 'killTree failed', err);
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

async function startServer(targetDir, cfg) {
  if (await probe(cfg.url)) {
    debug('visual-gate', 'server already up', cfg.url);
    return { child: null, alreadyRunning: true };
  }

  if (!cfg.startCommand) {
    return { child: null, error: `Nothing listening on ${cfg.url} and no start command could be detected. Set visual.startCommand in .yuva/config.json.` };
  }

  const logs = [];
  const child = spawn(cfg.startCommand, {
    cwd: targetDir,
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (buf) => { logs.push(buf.toString()); if (logs.length > 60) logs.shift(); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const ready = await waitForServer(cfg.url, cfg.readyTimeoutMs);
  if (!ready) {
    killTree(child);
    return { child: null, error: `Dev server did not become ready at ${cfg.url} within ${Math.round(cfg.readyTimeoutMs / 1000)}s.\n\n${logs.join('').slice(-2000)}` };
  }
  return { child, alreadyRunning: false };
}

/* ------------------------------------------------------------------ *
 * Capture + audit
 * ------------------------------------------------------------------ */

function slug(input) {
  return (input || 'root').replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'root';
}

/**
 * Render every route at every viewport, screenshot it, and audit the result.
 * @returns {Promise<{findings:Array, screenshots:Array, pagesVisited:number}>}
 */
async function captureAndAudit(playwright, cfg, outDir, targetDir) {
  const browser = await playwright.chromium.launch();
  const fx = cfg.fixtures;
  const findings = [];
  const screenshots = [];
  const warnings = [];
  const baselines = [];
  let pagesVisited = 0;
  let axeAvailable = null;

  // One blank page does all the PNG decoding, so the app's own CSP cannot block
  // the data: URLs the comparator loads.
  let compare = null;
  if (fx.baseline.enabled) {
    try {
      compare = await fixturesLib.createComparePage(browser);
    } catch (err) {
      debug('visual-gate', 'compare page failed', err);
      warnings.push('baseline comparison unavailable: could not open a comparison page');
    }
  }

  try {
    for (const viewport of cfg.viewports) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        ...fixturesLib.contextOptions(targetDir, fx),
        // Headless Chromium otherwise reports `prefers-reduced-motion: reduce`,
        // which makes a correct reduced-motion block flatten every duration and
        // hides the real motion values from the audit.
        reducedMotion: 'no-preference',
      });
      const page = await context.newPage();
      // Routes and the clock must be installed before the first navigation.
      warnings.push(...await fixturesLib.installFixtures(page, targetDir, fx));

      for (const route of cfg.routes) {
        const consoleErrors = [];
        const onConsole = (msg) => {
          if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
        };
        const onPageError = (err) => consoleErrors.push(String(err.message).slice(0, 300));
        page.on('console', onConsole);
        page.on('pageerror', onPageError);

        const target = `${cfg.url}${route.startsWith('/') ? route : `/${route}`}`;
        try {
          await page.goto(target, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
        } catch {
          // networkidle never settles on apps with long-polling; a load event is enough.
          await page.goto(target, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS }).catch(() => {});
        }
        await sleep(SETTLE_MS);
        warnings.push(...await fixturesLib.waitForReady(page, fx));
        pagesVisited++;

        const where = `${viewport.name} ${viewport.width}x${viewport.height}`;

        // ORDER IS LOAD-BEARING. Audit first, on the UNFROZEN page: the audit
        // reads transitionDuration/transitionProperty from computed style, and
        // freezing sets both to 0s, which would silently disable the
        // transition-all rule. Freeze only once the audit has its numbers.
        const observations = await page.evaluate(audit.collectObservations);
        observations.consoleErrors = consoleErrors;

        // Text-only zoom. Scaling the root font size grows rem/em while leaving
        // px alone, which is the asymmetry WCAG 1.4.4 is about — real browser
        // zoom scales px too and would hide the bug. Runs after the main audit
        // so it cannot perturb those measurements, and restores itself.
        observations.zoom = [];
        for (const level of cfg.zoomLevels) {
          try {
            observations.zoom.push(await page.evaluate(audit.collectZoomObservations, level));
          } catch (err) {
            debug('visual-gate', `zoom ${level}% failed`, err);
          }
        }

        findings.push(...audit.evaluate(observations, {
          thresholds: cfg.thresholds,
          route,
          viewport: where,
        }));

        // axe-core, if the project has it. Overlaps the hand-written rules
        // deliberately little: those cover design-system concerns axe has no
        // opinion about, axe covers conformance detail not worth reimplementing.
        if (cfg.axe !== false) {
          const axeResult = await axeRunner.runAxe(page, targetDir, { tags: cfg.axeTags });
          if (axeResult.available) {
            axeAvailable = true;
            findings.push(...axeResult.findings.map(f => ({ ...f, route, viewport: where })));
          } else {
            axeAvailable = axeAvailable || false;
          }
        }

        warnings.push(...await fixturesLib.freezeMotion(page, fx));

        const name = `${slug(route)}--${viewport.name}`;
        const file = path.join(outDir, `${name}.png`);
        await page.screenshot({ path: file, ...fixturesLib.screenshotOptions(page, fx) })
          .catch(err => { debug('visual-gate', 'screenshot failed', err); });
        screenshots.push({ route, viewport: viewport.name, file });

        if (compare) {
          const result = await fixturesLib.compareToBaseline({
            page: compare.page, targetDir, outDir, name, currentFile: file,
            baseline: fx.baseline,
          }).catch(err => {
            debug('visual-gate', 'baseline compare failed', err);
            return null;
          });
          if (result) {
            baselines.push({ name, route, viewport: viewport.name, ...result });
            const { status, message } = result.decision;
            if (status === 'regression' || status === 'size-mismatch') {
              findings.push({
                rule: 'visual-regression',
                severity: 'error',
                message,
                detail: result.diffFile ? `diff: ${path.basename(result.diffFile)}` : null,
                route,
                viewport: where,
              });
            } else if (status === 'created') {
              findings.push({
                rule: 'baseline-created',
                severity: 'warn',
                message,
                detail: null,
                route,
                viewport: where,
              });
            }
          }
        }

        page.off('console', onConsole);
        page.off('pageerror', onPageError);
      }

      await context.close();
    }
  } finally {
    if (compare) await compare.context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // axe-core's button-name / link-name / input-button-name cover the same
  // ground as our own accessible-name rule, and more thoroughly. Reporting both
  // double-counts one defect, which is the noise that teaches people to skim
  // gate output. Ours stays as the fallback for projects without axe.
  const deduped = axeAvailable === true
    ? findings.filter(f => f.rule !== 'missing-accessible-name')
    : findings;

  // Never let an absent axe read as a clean accessibility result.
  if (cfg.axe !== false && axeAvailable !== true) {
    warnings.push(
      'axe-core is not installed, so conformance rules (ARIA validity, landmarks, ' +
      'name-role-value) were NOT checked. This is unverified, not passing. ' +
      'Install with: npm install -D axe-core',
    );
  }

  return {
    findings: deduped, screenshots, pagesVisited, warnings: warnings.filter(Boolean), baselines,
    axeAvailable: axeAvailable === true,
  };
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

/**
 * The report is the handoff to the agent. Automated rules catch the mechanical
 * defects; the rubric covers what only a viewer can judge, and the screenshot
 * list is what the agent must actually open.
 */
function writeReport(outDir, { cfg, findings, screenshots, verdict, pagesVisited, warnings = [], baselines = [], axeAvailable = false }) {
  const reportPath = path.join(outDir, 'report.md');
  const lines = [
    '# Visual Gate Report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Base URL: ${cfg.url}`,
    `- Pages rendered: ${pagesVisited} (${cfg.routes.length} route(s) x ${cfg.viewports.length} viewport(s))`,
    `- Verdict: **${verdict.passed ? 'PASS' : 'FAIL'}** — ${verdict.errorCount} blocking, ${verdict.warningCount} advisory`,
    `- axe-core: ${axeAvailable ? 'ran' : '**NOT RUN** — conformance rules unverified'}`,
    '',
    '## Screenshots',
    '',
    'You MUST open these before declaring UI work done. The automated rules below',
    'cannot see composition, hierarchy, or whether this looks designed.',
    '',
  ];

  for (const shot of screenshots) {
    lines.push(`- \`${shot.route}\` @ ${shot.viewport} — ${path.relative(outDir, shot.file)}`);
  }

  lines.push('', '## Automated findings', '', '```', audit.formatFindings(findings), '```', '');

  if (warnings.length > 0) {
    lines.push(
      '## Fixture warnings',
      '',
      'The render may not be reproducible. A baseline comparison is only as',
      'trustworthy as the determinism underneath it.',
      '',
      ...warnings.map(w => `- ${w}`),
      '',
    );
  }

  if (baselines.length > 0) {
    lines.push('## Baselines', '');
    for (const b of baselines) {
      const extra = b.decision.message ? ` — ${b.decision.message}` : '';
      lines.push(`- \`${b.route}\` @ ${b.viewport}: **${b.decision.status}**${extra}`);
      if (b.diffFile) lines.push(`  - diff: ${path.basename(b.diffFile)} (magenta = changed)`);
    }
    lines.push('');
    if (baselines.some(b => b.decision.status === 'created')) {
      lines.push(
        'A `created` baseline verified nothing — it recorded what the page looks',
        'like now. Review those screenshots before trusting the next run, because',
        'whatever is wrong in them has just become the expected result.',
        '',
      );
    }
  }

  lines.push(
    '## Human-judgement rubric',
    '',
    'Answer each against the screenshots above. A `no` is work remaining.',
    '',
    '- [ ] Is there one clear focal point per screen, not three competing ones?',
    '- [ ] Does spacing group related things and separate unrelated ones?',
    '- [ ] Does the layout use more than one archetype, or is it stacked centered rows?',
    '- [ ] Does type hierarchy read at a glance, squinting?',
    '- [ ] Do loading / empty / error states exist and look as considered as the happy path?',
    '- [ ] Is the signature detail from `docs/design-brief.md` actually present?',
    '- [ ] At 320px (the floor, not 375), is anything cramped, clipped, or overlapping?',
    '- [ ] At 200% text zoom, does the layout still read? (overflow and clipping',
    '      are checked automatically; what a gate cannot judge is whether the',
    '      reflowed result is still usable)',
    '- [ ] Could this be swapped into another product unnoticed? (If yes, it is not done.)',
    '',
    '## Fixing',
    '',
    'Blocking findings must be fixed in code, never by relaxing the gate.',
    'Advisory findings are judgement calls — if a choice is deliberate, record it',
    'under "Rejected Alternatives" in `docs/design-brief.md`.',
    '',
  );

  ensureDir(outDir);
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return reportPath;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Run the visual gate.
 * @returns {Promise<{status:'passed'|'failed'|'skipped', output:string|null, ...}>}
 */
async function runVisualGate(targetDir, { only: _only } = {}) {
  const cfg = resolveConfig(targetDir);
  if (!cfg) {
    return { status: 'skipped', output: null, reason: 'visual gate not configured' };
  }

  const playwright = resolvePlaywright(targetDir);
  if (!playwright) {
    return {
      status: 'failed',
      output: [
        'The visual gate is configured but Playwright is not installed.',
        '',
        '  npm install -D playwright && npx playwright install chromium',
        '',
        'Or disable the gate with "visual": false in .yuva/config.json.',
      ].join('\n'),
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = P.runPath(targetDir, 'visual', stamp);
  ensureDir(outDir);

  // Seed before the server, so the app boots against known data. A gate that
  // renders whatever happens to be in the database is not a gate.
  const seed = fixturesLib.runSeed(targetDir, cfg.fixtures.seedCommand);
  if (!seed.ok) {
    return {
      status: 'failed',
      output: `Visual fixture seed command failed: ${cfg.fixtures.seedCommand}

${seed.output}`,
    };
  }

  const server = await startServer(targetDir, cfg);
  if (server.error) {
    return { status: 'failed', output: server.error };
  }

  try {
    const { findings, screenshots, pagesVisited, warnings, baselines, axeAvailable } =
      await captureAndAudit(playwright, cfg, outDir, targetDir);
    const verdict = audit.summarize(findings);
    const passed = cfg.strict ? findings.length === 0 : verdict.passed;
    const reportPath = writeReport(outDir, {
      cfg, findings, screenshots, verdict, pagesVisited, warnings, baselines, axeAvailable,
    });

    const output = [
      audit.formatFindings(findings),
      '',
      ...(warnings.length > 0
        ? ['FIXTURE WARNINGS (the render may not be reproducible)',
          ...warnings.map(w => `  - ${w}`), '']
        : []),
      `Screenshots + rubric: ${path.relative(targetDir, reportPath)}`,
      'Open the screenshots — the rules above cannot judge composition or hierarchy.',
    ].join('\n');

    return {
      status: passed ? 'passed' : 'failed',
      output,
      findings,
      screenshots,
      reportPath,
      verdict,
    };
  } catch (err) {
    return { status: 'failed', output: `Visual gate crashed: ${err.message}` };
  } finally {
    if (!server.alreadyRunning) killTree(server.child);
  }
}

module.exports = {
  RESULT_PREFIX,
  runVisualGate,
  isConfigured,
  resolveConfig,
  detectStartCommand,
  resolvePlaywright,
  DEFAULT_VIEWPORTS,
};
