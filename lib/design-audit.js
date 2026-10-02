/**
 * Design audit — the rule engine behind the `visual` quality gate.
 *
 * Split in two halves on purpose:
 *
 *   collectObservations()  runs INSIDE the browser (serialised to the page by
 *                          visual-gate.js). It only *observes* — it reads the
 *                          rendered DOM and returns plain JSON. No judgement.
 *
 *   evaluate()             runs in Node on that JSON. All rules live here, so
 *                          every design rule is unit-testable without a browser.
 *
 * Rules implement the detectable subset of
 * `.yuva/standards/designsystem.md` section 11 (the anti-generic checklist).
 */

/* ------------------------------------------------------------------ *
 * Colour maths
 * ------------------------------------------------------------------ */

/** Gamma-encode one linear-light sRGB channel to 0-255. */
function encodeSrgb(linear) {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

/**
 * OKLCH -> sRGB (Bjorn Ottosson's OKLab matrices).
 *
 * Required, not optional: Chrome returns computed colours authored in `oklch()`
 * AS `oklch(...)` rather than converting to rgb. Without this, every contrast
 * rule silently skips exactly the colour space designsystem.md mandates.
 */
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const bb = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * bb;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const sc = s_ * s_ * s_;

  return {
    r: encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * sc),
    g: encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * sc),
    b: encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * sc),
  };
}

/** Read one OKLCH component, honouring `%`, `none`, and `deg`. */
function oklchComponent(raw, percentBase) {
  if (raw === undefined || raw === null) return 0;
  const token = String(raw).trim();
  if (token === 'none' || token === '') return 0;
  const value = parseFloat(token);
  if (!Number.isFinite(value)) return 0;
  return token.endsWith('%') ? (value / 100) * percentBase : value;
}

/** Parse `oklch()` / `rgb()` / `rgba()` / `#rgb` / `#rrggbb` into {r,g,b,a}. */
function parseColor(input) {
  if (!input || typeof input !== 'string') return null;
  const str = input.trim().toLowerCase();

  if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  // color(srgb r g b [/ a]) — 0-1 channels. Chrome emits this for color-mix()
  // and some wide-gamut paths; without it those colours silently skip auditing.
  const srgb = str.match(/^color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)(?:\s*\/\s*([\d.%]+))?\s*\)$/);
  if (srgb) {
    const clamp = (v) => Math.min(255, Math.max(0, Math.round(parseFloat(v) * 255)));
    let a = 1;
    if (srgb[4] !== undefined) {
      a = srgb[4].endsWith('%') ? parseFloat(srgb[4]) / 100 : parseFloat(srgb[4]);
    }
    return { r: clamp(srgb[1]), g: clamp(srgb[2]), b: clamp(srgb[3]), a: Number.isFinite(a) ? a : 1 };
  }

  // oklch(L C H), oklch(L C H / A) — space separated, optional slash alpha.
  const oklch = str.match(/^oklch\(\s*([^\s,/]+)[\s,]+([^\s,/]+)[\s,]+([^\s,/]+)(?:\s*\/\s*([^\s)]+))?\s*\)$/);
  if (oklch) {
    const L = oklchComponent(oklch[1], 1);
    const C = oklchComponent(oklch[2], 0.4);
    const H = parseFloat(String(oklch[3]).replace(/deg$/, '')) || 0;
    const alpha = oklch[4] === undefined ? 1 : oklchComponent(oklch[4], 1);
    return { ...oklchToRgb(L, C, H), a: Number.isFinite(alpha) ? alpha : 1 };
  }

  const rgb = str.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.%]+))?\s*\)$/);
  if (rgb) {
    let a = 1;
    if (rgb[4] !== undefined) {
      a = rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    }
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: Number.isFinite(a) ? a : 1 };
  }

  const hex = str.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }

  return null;
}

/** WCAG relative luminance. */
function relativeLuminance({ r, g, b }) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Composite a possibly-translucent foreground over an opaque background. */
function flatten(fg, bg) {
  if (!fg) return bg;
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/** WCAG contrast ratio between two colour strings. Returns null if unparseable. */
function contrastRatio(fgInput, bgInput) {
  const bg = parseColor(bgInput);
  const fgRaw = parseColor(fgInput);
  if (!bg || !fgRaw) return null;
  const opaqueBg = bg.a >= 1 ? bg : flatten(bg, { r: 255, g: 255, b: 255, a: 1 });
  const fg = flatten(fgRaw, opaqueBg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(opaqueBg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA threshold: large text (>=24px, or >=18.66px bold) needs only 3:1. */
function contrastThreshold(fontSizePx, fontWeight) {
  const size = parseFloat(fontSizePx) || 16;
  const weight = parseInt(fontWeight, 10) || 400;
  const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
  return isLarge ? 3 : 4.5;
}

/* ------------------------------------------------------------------ *
 * The generic-default blocklist
 * ------------------------------------------------------------------ */

/**
 * Accents that mark output as machine-generated. These are the colours an LLM
 * reaches for by default, so they are the strongest single signal of
 * undesigned UI.
 */
const BANNED_ACCENTS = [
  { rgb: 'rgb(59, 130, 246)', hex: '#3b82f6', label: 'Tailwind blue-500' },
  { rgb: 'rgb(37, 99, 235)', hex: '#2563eb', label: 'Tailwind blue-600' },
  { rgb: 'rgb(79, 70, 229)', hex: '#4f46e5', label: 'Tailwind indigo-600' },
  { rgb: 'rgb(99, 102, 241)', hex: '#6366f1', label: 'Tailwind indigo-500' },
  { rgb: 'rgb(13, 110, 253)', hex: '#0d6efd', label: 'Bootstrap primary' },
  { rgb: 'rgb(0, 123, 255)', hex: '#007bff', label: 'Bootstrap 4 primary' },
];

/** Normalise a colour string to canonical `rgb(r, g, b)` for comparison. */
function canonicalRgb(input) {
  const c = parseColor(input);
  if (!c) return null;
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

/**
 * Is this colour effectively a neutral (a grey or a barely-tinted grey)?
 *
 * Used to scope the grey-sprawl rule. Measured as ABSOLUTE channel spread rather
 * than relative saturation: relative saturation exaggerates at low lightness, so
 * `rgb(40, 42, 48)` — an ordinary tinted dark surface — reads as 17% saturated
 * and would be misclassified. Measured against the real palettes, tinted
 * neutrals span 0-14 and semantic hues span 82-187, so the threshold sits in a
 * wide empty gap.
 */
const NEUTRAL_SPREAD_MAX = 24;

function isNearNeutral(input) {
  const c = parseColor(input);
  if (!c) return false;
  const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  return spread <= NEUTRAL_SPREAD_MAX;
}

/** Identify a banned generic accent. Returns the entry, or null. */
function matchBannedAccent(input) {
  const canon = canonicalRgb(input);
  if (!canon) return null;
  return BANNED_ACCENTS.find(b => b.rgb === canon) || null;
}

/* ------------------------------------------------------------------ *
 * Rule severity
 * ------------------------------------------------------------------ */

/**
 * `error` fails the gate. `warn` is reported but does not block.
 *
 * Errors are reserved for things that are either accessibility defects or
 * unambiguous markers of undesigned output. Judgement calls stay warnings so
 * the gate never blocks a deliberate choice.
 */
const RULE_SEVERITY = {
  'generic-accent': 'error',
  'low-contrast': 'error',
  'focus-suppressed': 'error',
  'horizontal-overflow': 'error',
  'heading-order': 'error',
  'missing-alt': 'error',
  'missing-accessible-name': 'error',
  'zoom-overflow': 'error',
  'zoom-clipping': 'error',
  'pure-surface': 'warn',
  'type-scale-sprawl': 'warn',
  'grey-sprawl': 'warn',
  'flat-shadow': 'warn',
  'transition-all': 'warn',
  'uniform-spacing': 'warn',
  'radius-sprawl': 'warn',
  'no-tabular-nums': 'warn',
  'div-as-button': 'warn',
  'no-reduced-motion': 'warn',
  'console-error': 'error',
};

const DEFAULTS = {
  maxFontSizes: 9,
  maxTextColors: 8,
  maxRadii: 6,
  uniformSpacingRatio: 0.85,
  minSpacingSamples: 8,
};

/* ------------------------------------------------------------------ *
 * The rule engine
 * ------------------------------------------------------------------ */

/**
 * Evaluate observations collected from one rendered page/viewport.
 *
 * @param {object} obs      output of collectObservations()
 * @param {object} options  { thresholds, strict, route, viewport }
 * @returns {Array<{rule,severity,message,detail}>}
 */
function evaluate(obs = {}, options = {}) {
  const t = { ...DEFAULTS, ...(options.thresholds || {}) };
  const findings = [];
  const add = (rule, message, detail) => {
    findings.push({ rule, severity: RULE_SEVERITY[rule] || 'warn', message, detail: detail || null });
  };

  // --- Generic defaults -------------------------------------------------
  for (const used of obs.accentColors || []) {
    const banned = matchBannedAccent(used.color);
    if (banned) {
      add('generic-accent',
        `${banned.label} (${banned.hex}) used as an accent — this is the single strongest marker of undesigned UI`,
        `${used.count} element(s), e.g. ${used.sample}`);
      break; // one finding is enough; the fix is the same
    }
  }

  const bodyBg = canonicalRgb(obs.bodyBackground);
  if (bodyBg === 'rgb(255, 255, 255)') {
    add('pure-surface', 'Body background is pure #ffffff — designsystem.md §10 calls for a tinted neutral');
  } else if (bodyBg === 'rgb(0, 0, 0)') {
    add('pure-surface', 'Body background is pure #000000 — causes halation with light text (§10.1)');
  }

  // --- Typography -------------------------------------------------------
  const sizes = obs.fontSizes || [];
  if (sizes.length > t.maxFontSizes) {
    add('type-scale-sprawl',
      `${sizes.length} distinct font sizes rendered (max ${t.maxFontSizes}) — suggests no modular scale`,
      sizes.join(', '));
  }

  // Count only NEAR-NEUTRAL text colours. The defect this rule exists to catch
  // is nine undifferentiated greys, not legitimate semantic variety: a status
  // table plus syntax highlighting genuinely needs a dozen text colours, and
  // counting those produced a confident finding against a correct page.
  const textColors = obs.textColors || [];
  const neutrals = textColors.filter(isNearNeutral);
  if (neutrals.length > t.maxTextColors) {
    add('grey-sprawl',
      `${neutrals.length} distinct near-neutral text colours (max ${t.maxTextColors}) — neutral tokens are not being reused`,
      neutrals.slice(0, 12).join(', '));
  }

  // --- Contrast ---------------------------------------------------------
  const seen = new Set();
  for (const pair of obs.textPairs || []) {
    const ratio = contrastRatio(pair.color, pair.background);
    if (ratio === null) continue;
    const needed = contrastThreshold(pair.fontSize, pair.fontWeight);
    // Epsilon for float noise only. This was 0.05, which silently passed
    // 4.47:1 against a 4.5 requirement — a real AA failure that axe-core
    // caught and this rule did not. Contrast is deterministic to ~1e-9, so a
    // tolerance anywhere near 0.05 is not absorbing noise, it is excusing bugs.
    if (ratio < needed - 0.005) {
      const key = `${pair.color}|${pair.background}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add('low-contrast',
        `Contrast ${ratio.toFixed(2)}:1 is below the required ${needed}:1`,
        `${pair.color} on ${pair.background} at ${pair.fontSize}/${pair.fontWeight}${pair.sample ? ` — "${pair.sample}"` : ''}`);
    }
  }

  // --- Depth and shape --------------------------------------------------
  for (const shadow of obs.flatShadows || []) {
    add('flat-shadow',
      'Single-layer neutral shadow detected — §6.1 requires multi-layer, hue-tinted shadows',
      shadow);
    break;
  }

  const radii = obs.radii || [];
  if (radii.length > t.maxRadii) {
    add('radius-sprawl',
      `${radii.length} distinct border-radius values (max ${t.maxRadii}) — no radius scale`,
      radii.join(', '));
  }

  // --- Spacing ----------------------------------------------------------
  const gaps = obs.spacingValues || [];
  if (gaps.length >= t.minSpacingSamples) {
    const counts = new Map();
    for (const g of gaps) counts.set(g, (counts.get(g) || 0) + 1);
    let topValue = null;
    let topCount = 0;
    for (const [value, count] of counts) {
      if (count > topCount) { topCount = count; topValue = value; }
    }
    const ratio = topCount / gaps.length;
    if (ratio >= t.uniformSpacingRatio && counts.size <= 2) {
      add('uniform-spacing',
        `${Math.round(ratio * 100)}% of spacing values are ${topValue} — §4.2 requires relatedness-proportional spacing`,
        `${counts.size} distinct value(s) across ${gaps.length} samples`);
    }
  }

  // --- Motion -----------------------------------------------------------
  if (obs.transitionAllCount > 0) {
    add('transition-all',
      `\`transition: all\` used ${obs.transitionAllCount} time(s) — animates layout properties and janks (§7.3)`);
  }
  if (obs.hasReducedMotionQuery === false) {
    add('no-reduced-motion', 'No `prefers-reduced-motion` block found (§7.4 — always required)');
  }

  // --- Accessibility ----------------------------------------------------
  // Measured by focusing each element, not by reading CSS: computed
  // `outline-width` reports a value even when `outline-style: none` hides it.
  const offenders = (obs.focus && obs.focus.offenders) || [];
  if (offenders.length > 0) {
    add('focus-suppressed',
      `${offenders.length} focusable element(s) show no visible indicator when focused — keyboard users cannot see where they are (§8)`,
      offenders.join(', '));
  }
  const unnamed = obs.unnamedControls || [];
  if (unnamed.length > 0) {
    add('missing-accessible-name',
      `${unnamed.length} interactive element(s) have no accessible name — a screen reader announces them as just "button" or "link"`,
      unnamed.join(', '));
  }
  if (obs.imagesMissingAlt > 0) {
    add('missing-alt', `${obs.imagesMissingAlt} <img> element(s) without an alt attribute (§13)`);
  }
  if (obs.headings) {
    if (obs.headings.h1Count > 1) {
      add('heading-order', `${obs.headings.h1Count} <h1> elements — exactly one per page (§13)`);
    } else if (obs.headings.h1Count === 0 && obs.headings.total > 0) {
      add('heading-order', 'No <h1> on a page that has headings (§13)');
    }
    if (obs.headings.skips && obs.headings.skips.length > 0) {
      add('heading-order', 'Heading levels skip', obs.headings.skips.join('; '));
    }
  }
  if (obs.pointerNonSemantic > 0) {
    add('div-as-button',
      `${obs.pointerNonSemantic} clickable non-semantic element(s) — use <button>/<a> (§13)`);
  }

  // --- Layout -----------------------------------------------------------
  if (obs.overflowX) {
    add('horizontal-overflow',
      `Page scrolls horizontally at ${options.viewport || 'this viewport'} (${obs.scrollWidth}px content in ${obs.clientWidth}px viewport)`);
  }

  // --- Data display -----------------------------------------------------
  if (obs.numericCellsWithoutTabularNums > 0) {
    add('no-tabular-nums',
      `${obs.numericCellsWithoutTabularNums} numeric table cell(s) without \`tabular-nums\` — columns will jitter (§3.3)`);
  }

  // --- Text zoom (WCAG 1.4.4) -------------------------------------------
  for (const zoom of obs.zoom || []) {
    if (zoom.overflowX) {
      add('zoom-overflow',
        `Page scrolls horizontally at ${zoom.percent}% text zoom (${zoom.scrollWidth}px in ${zoom.clientWidth}px) — text grew but a px-sized layout did not`);
    }
    if (zoom.clipped && zoom.clipped.length > 0) {
      add('zoom-clipping',
        `${zoom.clipped.length} element(s) clip their content at ${zoom.percent}% text zoom — px-sized boxes with rem text lose the overflow`,
        zoom.clipped.join(', '));
    }
  }

  // --- Runtime ----------------------------------------------------------
  for (const msg of obs.consoleErrors || []) {
    add('console-error', 'Console error on load', msg);
  }

  return findings.map(f => ({
    ...f,
    route: options.route || null,
    viewport: options.viewport || null,
  }));
}

/** Roll findings up into a pass/fail verdict. */
function summarize(findings = []) {
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
function formatFindings(findings = []) {
  if (findings.length === 0) return 'No design-audit findings.';

  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }

  const order = ['error', 'warn'];
  const lines = [];
  for (const severity of order) {
    const rules = [...byRule.entries()].filter(([, items]) => items[0].severity === severity);
    if (rules.length === 0) continue;
    lines.push(severity === 'error' ? 'BLOCKING' : 'ADVISORY');
    for (const [rule, items] of rules) {
      lines.push(`  ${rule}`);
      for (const item of items.slice(0, 5)) {
        const where = [item.route, item.viewport].filter(Boolean).join(' @ ');
        lines.push(`    - ${item.message}${where ? `  [${where}]` : ''}`);
        if (item.detail) lines.push(`      ${item.detail}`);
      }
      if (items.length > 5) lines.push(`    ... and ${items.length - 5} more`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/* ------------------------------------------------------------------ *
 * Browser-side collector
 * ------------------------------------------------------------------ */

/**
 * Runs inside the page. Observes only — every judgement lives in evaluate().
 *
 * Serialised and injected by visual-gate.js, so it must be fully
 * self-contained: no closures over Node scope, no imports.
 */
function collectObservations() {
  const MAX_ELEMENTS = 4000;
  const all = Array.from(document.querySelectorAll('*')).slice(0, MAX_ELEMENTS);

  const isVisible = (el, cs) =>
    cs.display !== 'none' &&
    cs.visibility !== 'hidden' &&
    parseFloat(cs.opacity) > 0.05 &&
    el.getClientRects().length > 0;

  const fontSizes = new Set();
  const textColors = new Set();
  const radii = new Set();
  const spacingValues = [];
  const flatShadows = new Set();
  const accentUse = new Map();
  const textPairs = [];
  let pointerNonSemantic = 0;
  let numericCellsWithoutTabularNums = 0;

  // Walk up for the nearest non-transparent background.
  const effectiveBackground = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return bg;
      node = node.parentElement;
    }
    const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    return htmlBg && htmlBg !== 'transparent' ? htmlBg : 'rgb(255, 255, 255)';
  };

  const hasOwnText = (el) =>
    Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim().length > 1);

  const SEMANTIC = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION']);

  for (const el of all) {
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;

    radii.add(cs.borderTopLeftRadius);

    for (const prop of ['gap', 'rowGap', 'columnGap', 'paddingTop', 'paddingLeft']) {
      const v = cs[prop];
      if (v && v !== 'normal' && parseFloat(v) > 0) spacingValues.push(v);
    }

    // A single `0 Npx Mpx rgba(0,0,0,a)` layer with no hue is the tutorial shadow.
    const shadow = cs.boxShadow;
    if (shadow && shadow !== 'none' && shadow.split(/\),/).length === 1) {
      const m = shadow.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (m && m[1] === m[2] && m[2] === m[3]) flatShadows.add(shadow);
    }

    if (cs.cursor === 'pointer' && !SEMANTIC.has(el.tagName) && !el.getAttribute('role')) {
      pointerNonSemantic++;
    }

    if (hasOwnText(el)) {
      fontSizes.add(cs.fontSize);
      textColors.add(cs.color);
      const sample = (el.textContent || '').trim().slice(0, 40);
      // WCAG 1.4.3 exempts inactive controls from the contrast minimum, and a
      // correctly-styled disabled control is deliberately low-contrast. Without
      // this the gate flags every greyed-out button it finds.
      const inactive = el.disabled === true ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.closest('[disabled], [aria-disabled="true"], fieldset:disabled') !== null;
      if (!inactive && textPairs.length < 300) {
        textPairs.push({
          color: cs.color,
          background: effectiveBackground(el),
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          sample,
        });
      }
    }

    for (const prop of ['backgroundColor', 'borderTopColor', 'color']) {
      const value = cs[prop];
      if (!value || value === 'transparent') continue;
      const entry = accentUse.get(value) || { color: value, count: 0, sample: el.tagName.toLowerCase() };
      entry.count++;
      accentUse.set(value, entry);
    }
  }

  for (const cell of Array.from(document.querySelectorAll('td, th')).slice(0, 500)) {
    const text = (cell.textContent || '').trim();
    if (!text || !/^[\d\s.,%$€£+-]+$/.test(text)) continue;
    if (!/tabular-nums/.test(getComputedStyle(cell).fontVariantNumeric)) {
      numericCellsWithoutTabularNums++;
    }
  }

  // Accessible names. The single most common real-world accessibility failure
  // is an icon-only control with no name: it is announced as "button" and the
  // user has no idea what it does. Cheap to detect, so there is no excuse.
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, ' +
    '[role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [role="switch"]';

  const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

  const accessibleName = (el) => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const named = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id))
        .filter(Boolean)
        .map(textOf)
        .filter(Boolean);
      if (named.length) return named.join(' ');
    }

    // A <label> wrapping or pointing at the control.
    if (typeof el.labels === 'object' && el.labels && el.labels.length) {
      const fromLabel = Array.from(el.labels).map(textOf).filter(Boolean);
      if (fromLabel.length) return fromLabel.join(' ');
    }

    const own = textOf(el);
    if (own) return own;

    // Submit/button inputs carry their name in `value`.
    if (el.tagName === 'INPUT' && el.value && /^(submit|button|reset)$/i.test(el.type)) {
      return String(el.value).trim();
    }
    // An image button is named by its alt text.
    const img = el.querySelector && el.querySelector('img[alt]');
    if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim();

    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    return '';
  };

  const unnamedControls = [];
  for (const el of Array.from(document.querySelectorAll(INTERACTIVE)).slice(0, 300)) {
    const cs = getComputedStyle(el);
    if (!isVisible(el, cs)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (accessibleName(el)) continue;
    if (unnamedControls.length < 12) {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls = el.classList.length ? `.${el.classList[0]}` : '';
      unnamedControls.push(`${tag}${id}${cls}`);
    }
  }

  // Heading order
  const headingEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const levels = headingEls.map(h => parseInt(h.tagName[1], 10));
  const skips = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] - levels[i - 1] > 1) {
      skips.push(`h${levels[i - 1]} -> h${levels[i]}`);
    }
  }

  // Reduced-motion is the one thing only a stylesheet scan can answer: it is a
  // media query, so no element's computed style reveals whether it exists.
  let hasReducedMotionQuery = false;
  let hasFocusVisible = false;

  const scanRules = (rules) => {
    for (const rule of rules) {
      if (rule.media && /prefers-reduced-motion/.test(rule.media.mediaText || '')) {
        hasReducedMotionQuery = true;
      }
      if (/:focus-visible/.test(rule.selectorText || '')) hasFocusVisible = true;
      if (rule.cssRules) scanRules(Array.from(rule.cssRules));
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      scanRules(Array.from(sheet.cssRules || []));
    } catch { /* cross-origin sheet - not inspectable */ }
  }

  // `transition: all` must be read from COMPUTED style, never from cssText:
  // Chrome serialises `transition: all 0.3s ease` as `transition: 0.3s`,
  // dropping `all` because it is the initial value. Text matching cannot see it.
  // A duration floor matters: a correct `prefers-reduced-motion` block sets
  // every duration to ~0.01ms, and headless browsers often report that
  // preference — without the floor, good pages report dozens of violations.
  const MIN_MEANINGFUL_SECONDS = 0.05;
  const durationSeconds = (value) => {
    const first = String(value || '').split(',')[0].trim();
    const n = parseFloat(first);
    if (!Number.isFinite(n)) return 0;
    return first.endsWith('ms') ? n / 1000 : n;
  };

  let transitionAllCount = 0;
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.transitionProperty === 'all' &&
        durationSeconds(cs.transitionDuration) >= MIN_MEANINGFUL_SECONDS) {
      transitionAllCount++;
    }
  }

  // Focus suppression, measured empirically rather than parsed. Computed
  // `outline-width` reports a value even when `outline-style: none` hides it,
  // so the only trustworthy test is to focus the element and see whether any
  // indicator actually appears.
  const focusable = Array.from(
    document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter(el => {
    if (el.disabled) return false;
    const cs = getComputedStyle(el);
    return isVisible(el, cs);
  }).slice(0, 15);

  const indicator = (cs) => ({
    outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
    shadow: cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : '',
    border: cs.borderColor,
    bg: cs.backgroundColor,
  });

  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList.length ? `.${el.classList[0]}` : '';
    return `${tag}${id}${cls}`;
  };

  const previouslyFocused = document.activeElement;
  const focusOffenders = [];
  let elementsChecked = 0;

  for (const el of focusable) {
    const before = indicator(getComputedStyle(el));
    try { el.focus({ preventScroll: true }); } catch { continue; }
    if (document.activeElement !== el) continue;
    const after = indicator(getComputedStyle(el));
    elementsChecked++;
    // Any observable change counts: a ring, a glow, a border or fill shift.
    const gained = after.outline ||
      after.shadow !== before.shadow ||
      after.border !== before.border ||
      after.bg !== before.bg;
    if (!gained && focusOffenders.length < 8) focusOffenders.push(describe(el));
  }

  // ALWAYS blur first. `previouslyFocused` is normally <body>, which HAS a
  // .focus() method but is not focusable, so calling it is a silent no-op and
  // focus stays on the last control probed above. That left a focus ring baked
  // into every screenshot — and, worse, into every visual-regression baseline.
  try {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const restorable = previouslyFocused &&
      previouslyFocused !== document.body &&
      previouslyFocused !== document.documentElement &&
      typeof previouslyFocused.focus === 'function';
    if (restorable) previouslyFocused.focus({ preventScroll: true });
  } catch { /* nothing focusable to restore */ }

  const docEl = document.documentElement;

  return {
    // effectiveBackground, not the raw value: a body with no background of its
    // own computes to rgba(0,0,0,0), which naively canonicalises to pure black
    // and produced a confident "pure #000000" finding on a light page.
    bodyBackground: effectiveBackground(document.body),
    fontSizes: Array.from(fontSizes).sort(),
    textColors: Array.from(textColors),
    radii: Array.from(radii),
    spacingValues,
    flatShadows: Array.from(flatShadows),
    accentColors: Array.from(accentUse.values()).sort((a, b) => b.count - a.count).slice(0, 40),
    textPairs,
    pointerNonSemantic,
    numericCellsWithoutTabularNums,
    imagesMissingAlt: Array.from(document.images).filter(i => !i.hasAttribute('alt')).length,
    headings: {
      h1Count: headingEls.filter(h => h.tagName === 'H1').length,
      total: headingEls.length,
      skips,
    },
    focus: { hasFocusVisible, elementsChecked, offenders: focusOffenders },
    unnamedControls,
    transitionAllCount,
    hasReducedMotionQuery,
    overflowX: docEl.scrollWidth > docEl.clientWidth + 1,
    scrollWidth: docEl.scrollWidth,
    clientWidth: docEl.clientWidth,
  };
}

/**
 * Observe the page under TEXT-only zoom.
 *
 * Serialised into the page. Scales the root font size, which grows rem/em text
 * while leaving `px` untouched — and that asymmetry IS the WCAG 1.4.4 failure
 * worth catching: a px-sized container whose rem text no longer fits. Browser
 * zoom (and CSS `zoom`) scales px too, so it would hide exactly this bug.
 *
 * Restores the original size before returning, so nothing leaks into the
 * screenshot taken afterwards.
 */
function collectZoomObservations(percent) {
  const root = document.documentElement;
  const original = root.style.fontSize;
  const base = parseFloat(getComputedStyle(root).fontSize) || 16;
  root.style.fontSize = `${(base * percent) / 100}px`;

  // Force layout before measuring.
  void root.offsetHeight;

  const clipped = [];
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.classList.length ? `.${el.classList[0]}` : '';
    return `${tag}${id}${cls}`;
  };

  for (const el of Array.from(document.querySelectorAll('*')).slice(0, 3000)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    // Only hidden/clip overflow actually loses content; scroll/auto is legitimate.
    const hiddenX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    const hiddenY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    if (!hiddenX && !hiddenY) continue;

    const overX = hiddenX && el.scrollWidth > el.clientWidth + 1;
    const overY = hiddenY && el.scrollHeight > el.clientHeight + 1;
    if ((overX || overY) && clipped.length < 10) clipped.push(describe(el));
  }

  const result = {
    percent,
    overflowX: root.scrollWidth > root.clientWidth + 1,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    clipped,
  };

  root.style.fontSize = original;
  void root.offsetHeight;
  return result;
}

module.exports = {
  collectZoomObservations,
  parseColor,
  oklchToRgb,
  relativeLuminance,
  contrastRatio,
  contrastThreshold,
  canonicalRgb,
  isNearNeutral,
  matchBannedAccent,
  evaluate,
  summarize,
  formatFindings,
  collectObservations,
  BANNED_ACCENTS,
  RULE_SEVERITY,
  DEFAULTS,
};
