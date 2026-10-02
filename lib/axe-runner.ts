/**
 * axe-core integration for the visual gate.
 *
 * Optional, exactly like Playwright: resolved from the project being audited,
 * never bundled. If it is absent the gate says so rather than implying coverage
 * it does not have — `componentcontracts.md` section 13 is only useful while it
 * is honest.
 *
 * The hand-written rules in `design-audit.js` and axe overlap deliberately very
 * little: those check design-system concerns (generic accents, token sprawl,
 * spacing rhythm) that axe has no opinion about, while axe checks conformance
 * detail (ARIA validity, landmark structure, name-role-value) that would be
 * absurd to reimplement.
 */

import fs from 'fs';
import path from 'path';
import { debug } from './debug';
import type { Page } from 'playwright';
import type { Severity } from './design-audit';

/**
 * A hung axe run must not consume the gate's whole budget. It should not happen
 * now that the clock is no longer paused, but a third-party rule set running
 * inside someone else's page is exactly the thing to put a bound on.
 */
const AXE_TIMEOUT_MS = 60_000;

/**
 * axe severity -> gate severity.
 *
 * `critical` and `serious` block; `moderate` and `minor` advise. A build that
 * fails on every minor finding gets switched off, and a switched-off gate
 * checks nothing.
 */
const IMPACT_SEVERITY = {
  critical: 'error',
  serious: 'error',
  moderate: 'warn',
  minor: 'warn',
};

/** Rules worth running for a design review. Keeps the report focused. */
const DEFAULT_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Locate axe-core, preferring the project's own copy.
 * @returns {{ source: string, version: string }|null}
 */
function resolveAxe(targetDir: string) {
  for (const base of [targetDir, __dirname]) {
    try {
      const entry = require.resolve('axe-core', { paths: [base] });
      const dir = path.dirname(entry);
      const minified = path.join(dir, 'axe.min.js');
      const source = fs.existsSync(minified) ? minified : entry;
      let version = 'unknown';
      try {
        version = require(path.join(dir, 'package.json')).version;
      } catch { /* version is cosmetic */ }
      return { source: fs.readFileSync(source, 'utf8'), version };
    } catch { /* try the next base */ }
  }
  return null;
}

/**
 * Run axe against a loaded page.
 *
 * @returns {Promise<{ available:boolean, version:string|null, findings:Array }>}
 */
async function runAxe(page: Page, targetDir: string, options: { tags?: string[] | null } = {}) {
  const axe = resolveAxe(targetDir);
  if (!axe) {
    return { available: false, version: null, findings: [] };
  }

  try {
    await page.evaluate(axe.source);
  } catch (err) {
    debug('axe-runner', 'could not inject axe', err);
    return { available: false, version: axe.version, findings: [] };
  }

  const tags = Array.isArray(options.tags) && options.tags.length ? options.tags : DEFAULT_TAGS;

  let results;
  try {
    results = await withTimeout(page.evaluate(
      (runTags: string[]) => (window as unknown as { axe: any }).axe.run(document, {
        runOnly: { type: 'tag', values: runTags },
        resultTypes: ['violations'],
      }).then((r: any) => ({
        violations: r.violations.map((v: any) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.slice(0, 5).map((n: any) => ({
            target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
            summary: (n.failureSummary || '').split('\n').filter(Boolean).slice(1).join('; '),
          })),
          nodeCount: v.nodes.length,
        })),
      })),
      tags,
    ), AXE_TIMEOUT_MS);
  } catch (err) {
    debug('axe-runner', 'axe.run failed', err);
    return { available: false, version: axe.version, findings: [], error: (err as Error).message };
  }

  return {
    available: true,
    version: axe.version,
    findings: toFindings(results.violations),
  };
}

/**
 * Map axe violations onto the gate's finding shape.
 * Pure, so the mapping is testable without a browser.
 */
function toFindings(violations: any[] = []) {
  return violations.map((v) => {
    const where = v.nodes.map((n: any) => n.target).join(', ');
    const extra = v.nodeCount > v.nodes.length ? ` (+${v.nodeCount - v.nodes.length} more)` : '';
    return {
      rule: `axe/${v.id}`,
      severity: (IMPACT_SEVERITY as Record<string, Severity>)[v.impact] || 'warn',
      message: `${v.help}${v.impact ? ` [${v.impact}]` : ''}`,
      detail: `${where}${extra}${v.helpUrl ? ` — ${v.helpUrl}` : ''}`,
    };
  });
}

/** Reject rather than hang, so a stuck rule set cannot stall the gate. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race<T>([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`axe.run did not finish within ${ms}ms`)), ms);
    }),
  ]);
}

export { AXE_TIMEOUT_MS, withTimeout, IMPACT_SEVERITY, DEFAULT_TAGS, resolveAxe, runAxe, toFindings };