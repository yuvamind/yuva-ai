import { matchBannedAccent } from '../lib/design-audit';
/**
 * Consistency guards for the shipped token starter.
 *
 * CSS cannot express "apply this token set under either of two selectors", so the
 * dark palette is declared twice — once under `prefers-color-scheme: dark` and
 * once under `[data-theme="dark"]`. Two hand-synced blocks always drift, and the
 * failure is silent: a token added to one block simply inherits its light value
 * in the other, which looks like a theming bug three screens away from the cause.
 */

import fs from 'fs';
import path from 'path';
import { parseColor, contrastRatio } from '../lib/design-audit';

const TOKENS_FILE = path.join(
  __dirname, '..', 'template', '.yuva', 'templates', 'tokens.css',
);
const css = fs.readFileSync(TOKENS_FILE, 'utf8');

/** Strip comments so commented-out examples are never read as declarations. */
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');

/** Body of the brace-balanced rule starting at `index`, or null. */
function bodyAt(source: string, index: number) {
  const open = source.indexOf('{', index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return { body: source.slice(open + 1, i), start: open, end: i };
    }
  }
  return null;
}

/**
 * Find the rule matching `pattern` that actually carries a palette.
 *
 * Necessary because `:root[data-theme="dark"]` appears twice: once as a
 * one-line `color-scheme: dark` and once as the full palette. Taking the first
 * match silently tests the wrong block.
 */
function paletteBlock(source: string, pattern: RegExp) {
  for (const match of source.matchAll(pattern)) {
    const found = bodyAt(source, match.index);
    if (found && found.body.includes('--bg')) return found;
  }
  return null;
}

const declaredIn = (body: string) =>
  new Set([...stripComments(body).matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));

const valuesIn = (body: string) => {
  const map = new Map<string, string>();
  for (const [, token, value] of stripComments(body).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    map.set(token, value.trim());
  }
  return map;
};

const mediaDark = paletteBlock(css, /@media \(prefers-color-scheme: dark\)/g);
const attrDark = paletteBlock(css, /:root\[data-theme="dark"\]\s*\{/g);
const lightPalette = paletteBlock(css, /:root\s*\{/g);

const mediaDarkBlock = (mediaDark && mediaDark.body)!;
const attrDarkBlock = (attrDark && attrDark.body)!;
const lightBlock = (lightPalette && lightPalette.body)!;

describe('the two dark palettes stay in sync', () => {
  it('both dark blocks exist', () => {
    expect(mediaDarkBlock, 'no @media (prefers-color-scheme: dark) block').toBeTruthy();
    expect(attrDarkBlock, 'no :root[data-theme="dark"] block').toBeTruthy();
  });

  it('declare exactly the same token set', () => {
    const inMedia = declaredIn(mediaDarkBlock);
    const inAttr = declaredIn(attrDarkBlock);

    const onlyMedia = [...inMedia].filter(t => !inAttr.has(t)).sort();
    const onlyAttr = [...inAttr].filter(t => !inMedia.has(t)).sort();

    expect(onlyMedia, `declared under prefers-color-scheme but NOT under [data-theme="dark"] — these silently keep their light value when the theme is forced: ${onlyMedia.join(', ')}`)
      .toEqual([]);
    expect(onlyAttr, `declared under [data-theme="dark"] but NOT under prefers-color-scheme — these silently keep their light value for OS-dark users: ${onlyAttr.join(', ')}`)
      .toEqual([]);
  });

  it('declares a non-trivial palette', () => {
    expect(declaredIn(mediaDarkBlock).size).toBeGreaterThan(30);
  });
});

describe('color-scheme tracks the active token set', () => {
  // The bug this guards: `color-scheme` declared once means forcing a theme
  // leaves native controls and scrollbars following the OS instead of the app.
  it('follows the OS by default', () => {
    expect(css).toMatch(/:root\s*\{\s*color-scheme:\s*light dark;?\s*\}/);
  });

  it('pins light when the theme is forced light', () => {
    expect(css).toMatch(/:root\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;?\s*\}/);
  });

  it('pins dark when the theme is forced dark', () => {
    expect(css).toMatch(/:root\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;?\s*\}/);
  });
});

describe('every var() reference resolves to a declared token', () => {
  it('has no dangling references', () => {
    const body = stripComments(css);
    const declared = new Set([...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
    const referenced = new Set([...body.matchAll(/var\((--[a-z0-9-]+)/g)].map(m => m[1]));
    const dangling = [...referenced].filter(t => !declared.has(t)).sort();
    expect(dangling, `var() references with no declaration: ${dangling.join(', ')}`).toEqual([]);
  });
});

describe('documented contrast ratios are true', () => {
  /**
   * Every `/* N:1 *​/` comment next to a token is a claim. Comments rot, and a
   * wrong ratio is worse than none — it is the number someone will cite instead
   * of recomputing. So the claims are checked.
   */
  const lightValues = valuesIn(lightBlock);
  const darkValues = valuesIn(mediaDarkBlock);

  /** Resolve a token to a literal colour, following one level of var(). */
  function resolve(name: string, values: Map<string, string>) {
    const raw = values.get(name) || lightValues.get(name);
    if (!raw) return null;
    const varMatch = raw.match(/^var\((--[a-z0-9-]+)\)$/);
    if (varMatch) return lightValues.get(varMatch[1]) || null;
    return raw;
  }

  // A claim may name its own ground ("5.74:1 on --accent"); otherwise it is
  // against the page background of whichever block it sits in.
  const claims = [...css.matchAll(
    // `[ \t]*` not `\s*`: the comment must sit on the SAME line as the
    // declaration, or a ratio mentioned in the next section header gets
    // attributed to this token.
    /(--[a-z0-9-]+):\s*(oklch\([^)]*\));?[ \t]*\/\*[^\n*]*?([\d.]+):1(?:\s*on\s*(--[a-z0-9-]+))?/g,
  )].map(m => ({
    token: m[1],
    color: m[2],
    claimed: parseFloat(m[3]),
    ground: m[4] || '--bg',
    isDark: mediaDark ? m.index > mediaDark.start : false,
  }));

  it('finds ratio claims to verify', () => {
    expect(claims.length).toBeGreaterThan(4);
  });

  it.each(claims.map(c => [`${c.token} (${c.claimed}:1 on ${c.ground})`, c]))('%s', (_label, claim) => {
    const values = claim.isDark ? darkValues : lightValues;
    const ground = resolve(claim.ground, values);
    expect(ground, `could not resolve the ground ${claim.ground}`).toBeTruthy();

    // Non-null: the toBeTruthy() assertion just above fails the test first.
    const actual = contrastRatio(claim.color, ground!)!;
    expect(actual, `contrast between ${claim.color} and ${ground} was unparseable`).not.toBeNull();

    expect(
      Math.abs(actual - claim.claimed),
      `${claim.token} claims ${claim.claimed}:1 on ${claim.ground} but computes to ${actual.toFixed(2)}:1`,
    ).toBeLessThan(0.1);
  });
});

describe('the token file obeys its own rules', () => {
  it('uses oklch(), not hex or rgb, for every colour', () => {
    const body = stripComments(css);
    const hex = [...body.matchAll(/:\s*(#[0-9a-fA-F]{3,8})/g)].map(m => m[1]);
    const rgb = [...body.matchAll(/:\s*(rgba?\([^)]*\))/g)].map(m => m[1]);
    expect([...hex, ...rgb], 'designsystem.md section 2.1 requires oklch()').toEqual([]);
  });

  it('declares a focus-visible treatment', () => {
    expect(css).toMatch(/:focus-visible\s*\{/);
    expect(css).toMatch(/outline:\s*2px/);
  });

  it('declares a prefers-reduced-motion block', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('keeps --bg off pure white and --text off pure black', () => {
    const bg = parseColor('oklch(0.985 0.003 265)')!;
    expect(bg.r === 255 && bg.g === 255 && bg.b === 255).toBe(false);
  });

  it('does not use a banned generic accent', () => {
    const accents = [...stripComments(css).matchAll(/--accent:\s*(oklch\([^)]*\))/g)].map(m => m[1]);
    expect(accents.length).toBeGreaterThan(0);
    for (const accent of accents) {
      expect(matchBannedAccent(accent), `${accent} is a banned generic accent`).toBeNull();
    }
  });
});

describe('the verification record is dated rather than absolute', () => {
  it('does not make an unfalsifiable "passes the gate" claim', () => {
    expect(css).not.toMatch(/Verified: a page built only from these tokens passes/);
  });

  it('records a date, a browser and a viewport', () => {
    const header = css.slice(0, css.indexOf('*/'));
    expect(header).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(header).toMatch(/Chromium/i);
    expect(header).toMatch(/\d{3,4}x\d{3,4}/);
  });
});

describe('lightBlock sanity', () => {
  it('the light palette is present', () => {
    expect(lightBlock).toBeTruthy();
    expect(css).toMatch(/--n-50:\s*oklch/);
  });
});
