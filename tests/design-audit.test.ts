import {
  parseColor,
  oklchToRgb,
  contrastRatio,
  contrastThreshold,
  canonicalRgb,
  isNearNeutral,
  matchBannedAccent,
  evaluate,
  summarize,
  formatFindings,
  collectObservations,
  RULE_SEVERITY,
} from '../lib/design-audit';
import type { Finding } from '../lib/design-audit';

const rulesOf = (findings: Finding[]) => findings.map(f => f.rule);

describe('parseColor()', () => {
  it('parses rgb and rgba', () => {
    expect(parseColor('rgb(59, 130, 246)')).toEqual({ r: 59, g: 130, b: 246, a: 1 });
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
  });

  it('parses space-separated and slash-alpha modern syntax', () => {
    expect(parseColor('rgb(10 20 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('parses 3-, 6- and 8-digit hex', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#3b82f6')).toEqual({ r: 59, g: 130, b: 246, a: 1 });
    expect(parseColor('#00000080')!.a).toBeCloseTo(0.502, 2);
  });

  it('treats transparent as fully clear', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('returns null for values it cannot read', () => {
    expect(parseColor('')).toBeNull();
    expect(parseColor(null)).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('lab(50% 40 59)')).toBeNull();      // not supported yet
    expect(parseColor('var(--accent)')).toBeNull();        // never resolved
  });
});

describe('oklch parsing', () => {
  // Ground truth captured from Chrome's own oklch -> sRGB conversion. Chrome
  // serialises computed oklch() colours AS oklch(), so without this the
  // contrast rules silently skip the colour space designsystem.md mandates.
  const CHROME_TRUTH = [
    ['oklch(0 0 0)', 0, 0, 0],
    ['oklch(1 0 0)', 255, 255, 255],
    ['oklch(0.52 0.14 38)', 169, 69, 36],
    ['oklch(0.985 0.003 265)', 249, 250, 252],
    ['oklch(0.205 0.011 265)', 21, 23, 28],
    ['oklch(0.58 0.19 262)', 54, 114, 233],
    ['oklch(0.7 0.2 145)', 48, 189, 68],
    ['oklch(50% 0.1 300)', 108, 85, 148],
  ];

  it.each(CHROME_TRUTH)('matches Chrome for %s', (input, r, g, b) => {
    const parsed = parseColor(input as string)!;
    expect(parsed.r).toBe(r);
    expect(parsed.g).toBe(g);
    expect(parsed.b).toBe(b);
    expect(parsed.a).toBe(1);
  });

  it('reads slash alpha', () => {
    const parsed = parseColor('oklch(0.6 0.15 38 / 0.5)')!;
    expect(parsed).toMatchObject({ r: 201, g: 90, b: 55 });
    expect(parsed.a).toBeCloseTo(0.5, 3);
  });

  it('treats a `none` component as zero', () => {
    expect(parseColor('oklch(0.5 none 0)')).toMatchObject(parseColor('oklch(0.5 0 0)')!);
  });

  it('accepts a deg suffix on hue', () => {
    expect(parseColor('oklch(0.52 0.14 38deg)')).toMatchObject({ r: 169, g: 69, b: 36 });
  });

  it('exposes the conversion directly and clamps out-of-gamut values', () => {
    expect(oklchToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    const wild = oklchToRgb(0.9, 0.9, 120); // far outside sRGB
    for (const channel of ['r', 'g', 'b']) {
      expect(wild[channel as keyof typeof wild]).toBeGreaterThanOrEqual(0);
      expect(wild[channel as keyof typeof wild]).toBeLessThanOrEqual(255);
    }
  });

  it('computes contrast on oklch pairs instead of skipping them', () => {
    // The real bug this guards: unparseable colours were silently ignored.
    const ratio = contrastRatio('oklch(0.205 0.011 265)', 'oklch(0.985 0.003 265)');
    expect(ratio).not.toBeNull();
    expect(ratio).toBeGreaterThan(4.5);
  });

  it('flags a failing oklch pair', () => {
    const findings = evaluate({
      textPairs: [{
        color: 'oklch(0.75 0.01 265)',
        background: 'oklch(0.985 0.003 265)',
        fontSize: '14px',
        fontWeight: '400',
      }],
    });
    expect(rulesOf(findings)).toContain('low-contrast');
  });
});

describe('color(srgb ...) parsing', () => {
  it('reads 0-1 channels, with and without alpha', () => {
    expect(parseColor('color(srgb 0 0 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor('color(srgb 0.66447 0.271058 0.143084)')).toMatchObject({ r: 169, g: 69, b: 36 });
    expect(parseColor('color(srgb 1 1 1 / 0.5)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
  });
});

describe('contrastRatio()', () => {
  it('computes the known extremes', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 2);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#333', '#fff')).toBeCloseTo(contrastRatio('#fff', '#333')!, 5);
  });

  it('flattens a translucent foreground over its background', () => {
    const solid = contrastRatio('rgb(128, 128, 128)', '#fff');
    const half = contrastRatio('rgba(0, 0, 0, 0.5)', '#fff');
    expect(half).toBeLessThan(contrastRatio('#000', '#fff')!);
    expect(half).toBeGreaterThan(1);
    expect(solid).toBeGreaterThan(1);
  });

  it('flags the classic grey-on-white failure', () => {
    // #999 on white is ~2.8:1 — the most common real-world contrast bug
    expect(contrastRatio('#999999', '#ffffff')).toBeLessThan(4.5);
  });

  it('returns null when either colour is unparseable', () => {
    expect(contrastRatio('nonsense', '#fff')).toBeNull();
  });
});

describe('contrastThreshold()', () => {
  it('requires 4.5:1 for body text', () => {
    expect(contrastThreshold('16px', '400')).toBe(4.5);
    expect(contrastThreshold('18px', '700')).toBe(4.5);
  });

  it('relaxes to 3:1 for large text', () => {
    expect(contrastThreshold('24px', '400')).toBe(3);
    expect(contrastThreshold('19px', '700')).toBe(3);
  });
});

describe('matchBannedAccent()', () => {
  it('catches Tailwind blue-500 in any notation', () => {
    expect(matchBannedAccent('#3b82f6')!.label).toBe('Tailwind blue-500');
    expect(matchBannedAccent('rgb(59, 130, 246)')!.label).toBe('Tailwind blue-500');
    expect(matchBannedAccent('rgba(59, 130, 246, 1)')!.label).toBe('Tailwind blue-500');
  });

  it('catches the other default accents', () => {
    expect(matchBannedAccent('#4f46e5')!.label).toMatch(/indigo-600/);
    expect(matchBannedAccent('#0d6efd')!.label).toMatch(/Bootstrap/);
  });

  it('passes a deliberate accent', () => {
    expect(matchBannedAccent('rgb(201, 108, 42)')).toBeNull();
    expect(matchBannedAccent('not-a-colour')).toBeNull();
  });
});

describe('canonicalRgb()', () => {
  it('normalises notations to one comparable form', () => {
    expect(canonicalRgb('#3b82f6')).toBe('rgb(59, 130, 246)');
    expect(canonicalRgb('rgba(59,130,246,0.4)')).toBe('rgb(59, 130, 246)');
  });
});

describe('evaluate() — generic defaults', () => {
  it('fails on a Tailwind-blue accent', () => {
    const findings = evaluate({ accentColors: [{ color: 'rgb(59, 130, 246)', count: 12, sample: 'button' }] });
    expect(rulesOf(findings)).toContain('generic-accent');
    expect(summarize(findings).passed).toBe(false);
  });

  it('reports a generic accent only once, however many elements use it', () => {
    const findings = evaluate({
      accentColors: [
        { color: 'rgb(59, 130, 246)', count: 9, sample: 'button' },
        { color: 'rgb(37, 99, 235)', count: 4, sample: 'a' },
      ],
    });
    expect(rulesOf(findings).filter((r: string) => r === 'generic-accent')).toHaveLength(1);
  });

  it('warns on pure white and pure black surfaces', () => {
    expect(rulesOf(evaluate({ bodyBackground: 'rgb(255, 255, 255)' }))).toContain('pure-surface');
    expect(rulesOf(evaluate({ bodyBackground: '#000' }))).toContain('pure-surface');
    expect(rulesOf(evaluate({ bodyBackground: 'rgb(250, 250, 252)' }))).not.toContain('pure-surface');
  });

  it('passes a clean page with no findings', () => {
    const findings = evaluate({
      bodyBackground: 'rgb(250, 250, 252)',
      accentColors: [{ color: 'rgb(201, 108, 42)', count: 3, sample: 'button' }],
      fontSizes: ['12px', '14px', '16px', '24px'],
      textColors: ['rgb(20, 20, 24)', 'rgb(110, 110, 120)'],
      textPairs: [{ color: 'rgb(20, 20, 24)', background: 'rgb(250, 250, 252)', fontSize: '16px', fontWeight: '400' }],
      headings: { h1Count: 1, total: 4, skips: [] },
      focus: { elementsChecked: 3, offenders: [] },
      hasReducedMotionQuery: true,
      overflowX: false,
    });
    expect(findings).toEqual([]);
    expect(summarize(findings).passed).toBe(true);
  });
});

describe('evaluate() — typography and colour sprawl', () => {
  it('flags more font sizes than a modular scale would produce', () => {
    const sizes = ['10px', '11px', '12px', '13px', '14px', '15px', '16px', '17px', '18px', '19px', '21px'];
    expect(rulesOf(evaluate({ fontSizes: sizes }))).toContain('type-scale-sprawl');
  });

  it('respects a custom threshold', () => {
    const sizes = ['10px', '12px', '14px', '16px', '18px'];
    expect(rulesOf(evaluate({ fontSizes: sizes }, { thresholds: { maxFontSizes: 3 } }))).toContain('type-scale-sprawl');
    expect(rulesOf(evaluate({ fontSizes: sizes }))).not.toContain('type-scale-sprawl');
  });

  it('flags nine greys', () => {
    const colors = Array.from({ length: 11 }, (_, i) => `rgb(${i * 20}, ${i * 20}, ${i * 20})`);
    expect(rulesOf(evaluate({ textColors: colors }))).toContain('grey-sprawl');
  });

  it('counts only NEAR-NEUTRAL text colours, not semantic variety', () => {
    // A status table plus syntax highlighting legitimately needs a dozen text
    // colours. Counting those produced a finding against a correct page.
    const semantic = [
      'oklch(0.205 0.011 265)', 'oklch(0.48 0.010 265)',  // 2 neutrals
      'oklch(0.52 0.13 150)', 'oklch(0.54 0.14 75)', 'oklch(0.52 0.18 25)',
      'oklch(0.50 0.12 230)', 'oklch(0.50 0.15 255)', 'oklch(0.48 0.13 300)',
      'oklch(0.48 0.16 300)', 'oklch(0.48 0.13 150)', 'oklch(0.50 0.14 38)',
      'oklch(0.48 0.14 255)',
    ];
    expect(semantic.length).toBeGreaterThan(8);
    expect(rulesOf(evaluate({ textColors: semantic }))).not.toContain('grey-sprawl');
  });

  it('still flags neutral sprawl hidden among semantic colours', () => {
    const greys = Array.from({ length: 10 }, (_, i) => `oklch(${0.3 + i * 0.06} 0.008 265)`);
    const mixed = [...greys, 'oklch(0.52 0.13 150)', 'oklch(0.52 0.18 25)'];
    const findings = evaluate({ textColors: mixed });
    const sprawl = findings.find(f => f.rule === 'grey-sprawl')!;
    expect(sprawl).toBeDefined();
    expect(sprawl.message).toContain('near-neutral');
  });
});

describe('isNearNeutral()', () => {
  it('treats greys and barely-tinted greys as neutral', () => {
    for (const c of ['oklch(0.556 0.010 265)', 'oklch(0.95 0.005 265)', 'oklch(0 0 0)',
      'oklch(1 0 0)', '#999999', 'rgb(40, 42, 48)']) {
      expect(isNearNeutral(c), `${c} should be neutral`).toBe(true);
    }
  });

  it('treats saturated semantic colours as not neutral', () => {
    for (const c of ['oklch(0.52 0.14 38)', 'oklch(0.7 0.12 150)', 'oklch(0.74 0.14 300)',
      '#3b82f6', 'rgb(201, 108, 42)']) {
      expect(isNearNeutral(c), `${c} should NOT be neutral`).toBe(false);
    }
  });

  it('is false for anything unparseable rather than guessing', () => {
    expect(isNearNeutral('lab(50% 40 59)')).toBe(false);
    expect(isNearNeutral(null)).toBe(false);
  });
});

describe('evaluate() — contrast', () => {
  it('fails text below its required ratio', () => {
    const findings = evaluate({
      textPairs: [{ color: '#999999', background: '#ffffff', fontSize: '14px', fontWeight: '400', sample: 'Muted label' }],
    });
    const contrast = findings.filter(f => f.rule === 'low-contrast');
    expect(contrast).toHaveLength(1);
    expect(contrast[0].severity).toBe('error');
    expect(contrast[0].detail).toContain('Muted label');
  });

  it('deduplicates identical colour pairs', () => {
    const pair = { color: '#999999', background: '#ffffff', fontSize: '14px', fontWeight: '400' };
    const findings = evaluate({ textPairs: [pair, { ...pair }, { ...pair }] });
    expect(findings.filter(f => f.rule === 'low-contrast')).toHaveLength(1);
  });

  it('catches a near-miss that an over-generous tolerance used to excuse', () => {
    // 4.47:1 against a 4.5 requirement is a real AA failure. A 0.05 tolerance
    // passed it; axe-core caught it and this rule did not.
    const findings = evaluate({
      textPairs: [{
        color: 'oklch(0.56 0.010 265)',
        background: 'oklch(0.985 0.003 265)',
        fontSize: '12px',
        fontWeight: '400',
      }],
    });
    expect(rulesOf(findings)).toContain('low-contrast');
    expect(findings[0].message).toContain('4.47');
  });

  it('still tolerates float noise at exactly the threshold', () => {
    const findings = evaluate({
      textPairs: [{ color: '#767676', background: '#ffffff', fontSize: '16px', fontWeight: '400' }],
    });
    // #767676 on white is 4.54:1 — comfortably passing, must not flap.
    expect(rulesOf(findings)).not.toContain('low-contrast');
  });

  it('allows large text at 3:1', () => {
    const findings = evaluate({
      textPairs: [{ color: '#767676', background: '#ffffff', fontSize: '32px', fontWeight: '400' }],
    });
    expect(rulesOf(findings)).not.toContain('low-contrast');
  });

  it('ignores pairs it cannot parse rather than guessing', () => {
    const findings = evaluate({ textPairs: [{ color: 'lab(50% 40 59)', background: '#fff', fontSize: '16px', fontWeight: '400' }] });
    expect(rulesOf(findings)).not.toContain('low-contrast');
  });
});

describe('evaluate() — spacing', () => {
  it('flags uniform spacing as a grouping failure', () => {
    const findings = evaluate({ spacingValues: Array(12).fill('16px') });
    expect(rulesOf(findings)).toContain('uniform-spacing');
  });

  it('accepts a relatedness-proportional rhythm', () => {
    const gaps = ['8px', '8px', '16px', '16px', '16px', '32px', '32px', '64px', '4px', '48px'];
    expect(rulesOf(evaluate({ spacingValues: gaps }))).not.toContain('uniform-spacing');
  });

  it('does not judge on too few samples', () => {
    expect(rulesOf(evaluate({ spacingValues: ['16px', '16px', '16px'] }))).not.toContain('uniform-spacing');
  });
});

describe('evaluate() — accessibility', () => {
  it('fails elements that gain no indicator when focused, and names them', () => {
    const findings = evaluate({ focus: { elementsChecked: 4, offenders: ['button.cta', 'a#skip'] } });
    const focus = findings.find(f => f.rule === 'focus-suppressed')!;
    expect(focus.severity).toBe('error');
    expect(focus.detail).toBe('button.cta, a#skip');
    expect(summarize(findings).passed).toBe(false);
  });

  it('passes when every focusable element gains an indicator', () => {
    expect(rulesOf(evaluate({ focus: { elementsChecked: 6, offenders: [] } })))
      .not.toContain('focus-suppressed');
  });

  it('makes no claim when nothing focusable was measured', () => {
    expect(rulesOf(evaluate({ focus: { elementsChecked: 0, offenders: [] } })))
      .not.toContain('focus-suppressed');
  });

  it('fails missing alt attributes', () => {
    expect(rulesOf(evaluate({ imagesMissingAlt: 3 }))).toContain('missing-alt');
  });

  it('fails multiple h1 elements, a missing h1, and skipped levels', () => {
    expect(rulesOf(evaluate({ headings: { h1Count: 2, total: 5, skips: [] } }))).toContain('heading-order');
    expect(rulesOf(evaluate({ headings: { h1Count: 0, total: 3, skips: [] } }))).toContain('heading-order');
    expect(rulesOf(evaluate({ headings: { h1Count: 1, total: 3, skips: ['h2 -> h4'] } }))).toContain('heading-order');
  });

  it('says nothing about headings on a page that has none', () => {
    expect(rulesOf(evaluate({ headings: { h1Count: 0, total: 0, skips: [] } }))).not.toContain('heading-order');
  });

  it('warns about clickable non-semantic elements', () => {
    expect(rulesOf(evaluate({ pointerNonSemantic: 4 }))).toContain('div-as-button');
  });
});

describe('evaluate() — layout, motion, depth, data', () => {
  it('fails horizontal overflow and names the viewport', () => {
    const findings = evaluate(
      { overflowX: true, scrollWidth: 520, clientWidth: 375 },
      { viewport: 'mobile 375x812' },
    );
    const overflow = findings.find(f => f.rule === 'horizontal-overflow')!;
    expect(overflow.severity).toBe('error');
    expect(overflow.message).toContain('375');
    expect(overflow.viewport).toBe('mobile 375x812');
  });

  it('warns on transition:all and a missing reduced-motion block', () => {
    expect(rulesOf(evaluate({ transitionAllCount: 7 }))).toContain('transition-all');
    expect(rulesOf(evaluate({ hasReducedMotionQuery: false }))).toContain('no-reduced-motion');
    expect(rulesOf(evaluate({ hasReducedMotionQuery: true }))).not.toContain('no-reduced-motion');
  });

  it('warns on the tutorial shadow, once', () => {
    const findings = evaluate({
      flatShadows: ['rgba(0, 0, 0, 0.1) 0px 1px 3px 0px', 'rgba(0, 0, 0, 0.08) 0px 2px 4px 0px'],
    });
    expect(findings.filter(f => f.rule === 'flat-shadow')).toHaveLength(1);
  });

  it('warns on radius sprawl', () => {
    const radii = ['2px', '4px', '6px', '8px', '10px', '12px', '14px'];
    expect(rulesOf(evaluate({ radii }))).toContain('radius-sprawl');
  });

  it('warns on numeric cells without tabular figures', () => {
    expect(rulesOf(evaluate({ numericCellsWithoutTabularNums: 18 }))).toContain('no-tabular-nums');
  });

  it('fails on console errors', () => {
    const findings = evaluate({ consoleErrors: ['TypeError: x is not a function'] });
    expect(summarize(findings).passed).toBe(false);
    expect(findings[0].detail).toContain('TypeError');
  });
});

describe('evaluate() — bookkeeping', () => {
  it('tolerates an empty observation object', () => {
    expect(evaluate()).toEqual([]);
    expect(evaluate({})).toEqual([]);
  });

  it('stamps route and viewport onto every finding', () => {
    const findings = evaluate({ imagesMissingAlt: 1 }, { route: '/pricing', viewport: 'desktop' });
    expect(findings[0].route).toBe('/pricing');
    expect(findings[0].viewport).toBe('desktop');
  });

  it('gives every rule a declared severity', () => {
    for (const [rule, severity] of Object.entries(RULE_SEVERITY)) {
      expect(['error', 'warn']).toContain(severity);
      expect(rule).toMatch(/^[a-z-]+$/);
    }
  });
});

describe('summarize()', () => {
  it('passes only when there are no errors', () => {
    const warnOnly = evaluate({ bodyBackground: '#fff', transitionAllCount: 1 });
    const result = summarize(warnOnly);
    expect(result.passed).toBe(true);
    expect(result.warningCount).toBeGreaterThan(0);
    expect(result.errorCount).toBe(0);
  });

  it('handles no findings', () => {
    expect(summarize()).toMatchObject({ passed: true, errorCount: 0, warningCount: 0 });
  });
});

describe('formatFindings()', () => {
  it('reports when there is nothing to report', () => {
    expect(formatFindings([])).toMatch(/No design-audit findings/);
  });

  it('separates blocking from advisory and groups by rule', () => {
    const findings = evaluate({
      imagesMissingAlt: 2,
      bodyBackground: '#ffffff',
      transitionAllCount: 3,
    });
    const report = formatFindings(findings);
    expect(report).toContain('BLOCKING');
    expect(report).toContain('ADVISORY');
    expect(report).toContain('missing-alt');
    expect(report.indexOf('BLOCKING')).toBeLessThan(report.indexOf('ADVISORY'));
  });
});

describe('collectObservations()', () => {
  it('is a self-contained function, serialisable into a page', () => {
    expect(typeof collectObservations).toBe('function');
    const source = collectObservations.toString();
    // No closure over Node scope — it is injected as a string into the browser.
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).toMatch(/getComputedStyle/);
    expect(source).toMatch(/styleSheets/);
  });

  it('reads transition:all from computed style, not from cssText', () => {
    // Chrome serialises `transition: all 0.3s ease` as `transition: 0.3s`,
    // dropping `all` — so a cssText match can never see it.
    const source = collectObservations.toString();
    // Quote-agnostic: the .ts source is transformed by esbuild before this
    // assertion sees it, and esbuild re-prints string literals with double
    // quotes. The behaviour under test is that transition:all is read from
    // COMPUTED style, which is what the property access proves.
    expect(source).toMatch(/transitionProperty === ['"]all['"]/);
    expect(source).not.toMatch(/transition\(-property\)\?\s\*:/);
  });

  it('applies a duration floor so reduced-motion blocks are not false positives', () => {
    // Headless browsers report `prefers-reduced-motion: reduce`, which makes a
    // correct reduced-motion block flatten every duration to ~1e-05s.
    const source = collectObservations.toString();
    expect(source).toMatch(/MIN_MEANINGFUL_SECONDS/);
    expect(source).toMatch(/endsWith\(['"]ms['"]\)/);
  });

  it('excludes inactive controls from contrast pairs', () => {
    // WCAG 1.4.3 exempts inactive controls, and a correctly-styled disabled
    // button is deliberately low-contrast — the gate must not flag it.
    const source = collectObservations.toString();
    expect(source).toMatch(/aria-disabled/);
    expect(source).toMatch(/fieldset:disabled/);
  });

  it('reads the body background through effectiveBackground', () => {
    // A body with no background computes to rgba(0,0,0,0), which naively
    // canonicalises to pure black and produced a false "pure #000000" finding.
    const source = collectObservations.toString();
    expect(source).toMatch(/bodyBackground: effectiveBackground\(document\.body\)/);
  });

  it('blurs unconditionally, so no focus ring leaks into the screenshot', () => {
    // <body> has a .focus() method but is not focusable, so restoring to it is a
    // silent no-op — focus stayed on the last probed control and the ring was
    // captured into the baseline. Found by running the gate end to end.
    const source = collectObservations.toString();
    expect(source).toMatch(/document\.activeElement\.blur\(\)/);
    expect(source).toMatch(/previouslyFocused !== document\.body/);
  });

  it('measures focus indicators by focusing elements, not by parsing CSS', () => {
    const source = collectObservations.toString();
    expect(source).toMatch(/\.focus\(\{ preventScroll: true \}\)/);
    expect(source).toMatch(/document\.activeElement/);
  });
});
