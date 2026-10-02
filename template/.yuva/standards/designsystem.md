# Design System Standards

Load this BEFORE writing any UI code. This is the taste layer.

`frontendstandards.md` tells you how to *organise* frontend code.
This file tells you how to make it **look like someone designed it**.

---

## 0. Why Generic UI Happens

An agent asked to "build a login page" that jumps straight to markup will
produce this, every time:

- white or `#f9fafb` background
- a centered card, `max-width: 400px`, `border-radius: 8px`, soft grey shadow
- `#3b82f6` primary button (Tailwind `blue-500`)
- `Inter` or system font at `16px`, default line-height
- labels above inputs, `1rem` gaps everywhere

That output is *correct* and *worthless*. It is the statistical average of
every tutorial. It signals "a machine made this."

**The cause is sequencing, not capability.** Design decisions got made
implicitly, as defaults, while attention was on behaviour. The fix is to make
them explicitly, first, as a written artifact.

> **RULE 0 — No component code until a design brief exists.**
> Write `docs/design-brief.md` plus a token file. Then build.

### 0.1 Precedence — clarity beats novelty, always

This document exists to stop *undesigned* output. It is not a mandate for
*novel* output, and the two are easy to confuse.

**When a rule in this file conflicts with the product's actual job, the product
wins.** An operations console that needs dense predictable tables, boring
alignment, and fast unremarkable interactions is a correct design outcome, not a
failure of imagination. "Different" is not "better."

The rules most often misapplied this way, and what they do NOT mean:

| Rule | Does NOT mean |
|------|---------------|
| §5.1 break the centered-column reflex | every screen must be asymmetric |
| §6.1 layered tinted shadows | depth must be dramatic |
| §3.2 deliberate typography | one excellent family is wrong |
| §7 custom easing curves | motion must be noticeable |
| §12 a signature detail | invent a flourish where none belongs |

Section 0.2 makes this concrete: declare a **profile** and whole groups of these
rules switch off.

**Override protocol.** Any rule here may be overridden when the product requires
it. The cost of an override is one line in the "Rejected Alternatives" section
of `docs/design-brief.md` saying what you chose and why. An override that is
recorded is a design decision; an unrecorded one is drift — and that
distinction, not the rule itself, is what this standard actually enforces.

### 0.2 Profile — which half of this document applies

Declare a **profile** in `docs/design-contract.json`. It decides which rules here
are active, because an operations console and a marketing page want opposite
things and a single default serves neither.

| | `operations` | `marketing` | `consumer` |
|---|---|---|---|
| Optimise for | scanning and throughput | persuasion and recall | delight and clarity |
| §5.1 layout archetypes | **predictable and repeated.** Stable column positions beat variety — a row that moves between screens costs the user their place | asymmetry, bento, full-bleed bands, overlap | moderate variety, generous spacing |
| §4 density | compact; 32-36px rows; 13-14px body | spacious; `space-24` sections | comfortable |
| §3 type scale | ratio **1.2**, few sizes | 1.333, wide range | 1.25 |
| §7 motion | **minimal.** Hover and focus only, 100-150ms. Nothing that delays a keystroke | expressive, scroll-linked, spring | moderate |
| §12 signature detail | a *behaviour* — ownership visible at a glance, a diff that highlights the one line that matters. Often "none" | a visual moment | one memorable interaction |
| Primary input | **keyboard** | pointer and touch | touch |
| Hardest constraint | information density without noise | load time | first-run comprehension |

**For `operations`, these rules in this document are explicitly relaxed:**

- §5.1 "break the centered-column reflex" does not apply. Predictability is the
  feature. A settings page that looks like every other settings page is doing its
  job.
- §12 does not require a signature detail. "None — the clarity is the signature"
  is the expected answer, not a cop-out.
- §11's swap test is **not** a defect check here (see below).

### 0.3 The swap test is a signal, not a gate

§11 ends with *"could this be swapped into another product unnoticed?"* That
detects **missing product identity**. It does not detect a defect, and it is not
automatically a failure.

Familiarity is frequently the correct choice. A login form, a settings page, a
date picker or a data table that behaves exactly as users already expect is
better than a novel one, because the user spends no attention learning it. The
honest reading is:

- **Marketing or consumer surface, and it swaps cleanly** → a real problem. The
  product has no identity where identity is the point.
- **Operational surface, and it swaps cleanly** → usually fine, and worth one
  line in the brief saying the familiarity is deliberate.
- **Anything that swaps cleanly AND the team cannot say what makes it theirs** →
  a problem regardless of profile.

Use it to start that conversation, never to reject a screen on its own.

---

## 1. The Briefs (mandatory first artifacts)

### 1.0 The product brief comes FIRST

A visual brief answered without a product brief produces a beautiful surface
that does not help anyone operate the thing. Answer these before the visual
questions, in `docs/product-brief.md`:

| # | Question | Why it changes the design |
|---|----------|---------------------------|
| P1 | **Primary user**, and what they already know | sets vocabulary and how much explanation the UI must carry |
| P2 | **The main job** they came to complete | decides what gets the primary action |
| P3 | **The critical workflow**, step by step | decides screen order and what must persist between steps |
| P4 | **Core objects** and their relationships | decides navigation and the component inventory |
| P5 | **What must be readable in 3 seconds** | the one thing hierarchy is built around |
| P6 | **Data volume and shape** — 5 rows or 50,000? | decides density, pagination, virtualisation, table vs cards |
| P7 | **Which actions are dangerous or irreversible** | decides confirmation, undo, and visual weight |
| P8 | **Failure consequences** — what breaks if the user misreads this? | decides how loud errors must be |
| P9 | **Permissions and roles** | decides what is hidden vs disabled vs absent |
| P10 | **Performance and technical constraints** | decides whether personality is affordable at all |

Avoiding three visual revisions only to cause three functional ones is not a
win. If P2, P5, or P7 are unknown, stop and ask — those three determine more of
the layout than every rule in section 5.

### 1.1 The visual brief

Then produce `docs/design-brief.md` answering all eight. Sections are numbered
`B1`-`B8` so a cross-reference from another file cannot be mistaken for a section
of this standard:

| # | Question | Bad answer | Good answer |
|---|----------|-----------|-------------|
| B1 | **Reference points** - 2-3 real products this should feel adjacent to | "modern and clean" | "Linear's density, Stripe's typographic restraint" |
| B2 | **One adjective** you are optimising for | "professional" | "precise" / "warm" / "editorial" / "brutal" |
| B3 | **Who** uses it, in what state of mind | "users" | "ops staff scanning 200 rows at 7am, tired" |
| B4 | **Density** - comfortable, compact, or spacious | unstated | "compact: 32px rows, 13px body" |
| B5 | **Dominant surface** - light, dark, or tinted | unstated | "dark, `oklch(0.18 0.01 260)` base" |
| B6 | **Accent strategy** - one hue, duo, or neutral+signal | unstated | "neutral UI, single amber signal for state" |
| B7 | **Type personality** - what the headline font says | unstated | "geometric sans headline, humanist body" |
| B8 | **The one memorable thing** a user would describe to a friend | none | "the sidebar collapses into an icon rail with spring" |

If the user has not given you enough to answer B1, B2, B5 or B8 - **ask**.
Three questions up front beats three rounds of "make it look better."

---

## 2. Color - by formula, never by vibes

### 2.1 Build in a perceptual space

Use `oklch()`. Hex and HSL lie about brightness: `hsl(60 100% 50%)` (yellow)
and `hsl(240 100% 50%)` (blue) claim identical lightness and differ by roughly
4x perceived. A ramp built in HSL will have muddy mid-tones and a washed top end.

```css
/* A neutral ramp with genuinely even perceptual steps */
--n-50:  oklch(0.985 0.003 265);
--n-100: oklch(0.967 0.004 265);
--n-200: oklch(0.922 0.005 265);
--n-300: oklch(0.860 0.006 265);
--n-400: oklch(0.708 0.008 265);
--n-500: oklch(0.556 0.010 265);
--n-600: oklch(0.440 0.011 265);
--n-700: oklch(0.360 0.012 265);
--n-800: oklch(0.270 0.012 265);
--n-900: oklch(0.205 0.011 265);
--n-950: oklch(0.145 0.010 265);
```

**Generation rule for an N-step ramp:** hold chroma and hue, step lightness
evenly in OKLCH from about `0.985` down to about `0.145`. For *tinted* neutrals
(recommended - pure grey reads cheap), carry chroma `0.004` to `0.012` at your
brand hue.

#### 2.1.1 Gamut — what the formula does not handle

Holding chroma constant while sweeping lightness **will leave the sRGB gamut**
at the light and dark ends for any chroma above roughly `0.1`. The neutral ramp
above is safe by construction because its chroma stays under `0.013`. A
saturated accent ramp is not.

Required once chroma exceeds ~`0.1`:

- **Reduce chroma toward both ends** — a chroma arc, not a constant. Verify
  every stop renders as intended instead of assuming it.
- **Clamping is not gamut mapping.** Clipping each channel independently — what
  naive conversion does, Yuva's own `oklchToRgb()` included — shifts hue on
  out-of-gamut colours. For any colour that matters, ship an explicit in-gamut
  fallback rather than trusting the clip.
- **Declare a browser-support floor.** `oklch()` is unsupported before Chrome
  111 / Safari 15.4 / Firefox 113. If older browsers are in scope:

```css
--accent: #a94524;                      /* fallback, in-gamut by definition */
@supports (color: oklch(0 0 0)) {
  :root { --accent: oklch(0.52 0.14 38); }
}
```

- **Interpolation space.** Gradients and `color-mix()` interpolate differently
  per space. State `in oklch` or `in srgb` explicitly rather than inheriting a
  default that silently changes the result.
- **Forced colors.** Under `forced-colors: active` the palette is replaced
  wholesale. Never encode meaning in colour alone (§2.4), and test that mode —
  tokens do not protect you there.
- **Verify contrast by computation, per pair, and record the number.** Section
  11 treats an estimated ratio as a defect for a reason: a palette that looks
  obviously fine fails AA more often than not.

### 2.2 Accent scarcity

The familiar "60-30-10" split is a **heuristic, not a measurement**. Nobody
agrees whether it means pixel area, viewport area, visual weight, or component
count, so as a rule it generates review arguments instead of decisions. Keep it
as intuition — dominant surface, secondary surfaces, rare accent — and hold
yourself to the parts that are actually checkable:

- **One primary action per view.** Everything else is `ghost`, `outline`, or
  plain text. If a view genuinely has two equal primary actions, it is doing two
  jobs — justify that in the brief or split the view.
- **The accent is never a surface.** It does not fill page or card backgrounds.
- **The accent is never decorative.** It marks the primary action, the active
  state, and focus. Nothing else.

If every button is the accent colour, nothing is primary.

### 2.3 Semantic tokens, never raw values in components

```css
/* tokens.css - the ONLY file with colour literals */
:root {
  --bg:            var(--n-50);
  --bg-subtle:     var(--n-100);
  --bg-elevated:   oklch(1 0 0);
  --border:        var(--n-200);
  --border-strong: var(--n-300);
  --text:          var(--n-900);
  --text-muted:    var(--n-500);
  --text-subtle:   var(--n-400);
  --accent:        oklch(0.58 0.19 262);
  --accent-hover:  oklch(0.52 0.19 262);
  --accent-fg:     oklch(0.99 0 0);
  --focus:         var(--accent);
}
```

Components reference `var(--text-muted)`. **A colour literal outside the token
file is a defect** - it is how a codebase ends up with nine different greys.

### 2.4 Contrast is non-negotiable

- body text at least **4.5:1**; large text (18.66px bold or 24px+) at least **3:1**
- UI borders and icons that carry meaning at least **3:1**
- **never** convey state by hue alone - pair with icon, weight, or text

---

## 3. Typography - the highest-leverage lever

Type does more for perceived quality than any other single choice. Most generic
UI is generic because it uses one font at three sizes.

### 3.1 Pick a modular scale, then never free-hand a size

Ratio **1.2** (minor third) for dense UI, **1.25** for apps, **1.333** for
marketing. Generate the scale; do not improvise sizes.

```css
--text-xs:   0.75rem;   /* 12px - meta, badges */
--text-sm:   0.875rem;  /* 14px - secondary, table cells */
--text-base: 1rem;      /* 16px - body */
--text-lg:   1.125rem;  /* 18px - lead */
--text-xl:   1.5rem;    /* 24px - section heading */
--text-2xl:  1.953rem;  /* 31px - page title */
--text-3xl:  2.441rem;  /* 39px - hero */
--text-4xl:  3.815rem;  /* 61px - display */
```

### 3.2 One deliberate family, or two with real contrast

Three or more families reads chaotic. Past that, the count is not the point —
**deliberateness** is. A single excellent variable family across several weights
and optical sizes is frequently the better answer, and for dense product UI it
usually is: one UI family plus a monospace face for technical data is more
coherent than manufacturing headline/body contrast the product never needed.

What is actually wrong is *accidental* typography: the default stack, at one
weight, at sizes picked ad hoc.

Decide and record each of these in the brief, because each carries a cost:

| Decision | Cost if ignored |
|----------|-----------------|
| **Loading budget** — families x weights x subsets | every extra face is a blocking request or a flash |
| **`font-display`** | `swap` causes reflow; `optional` can silently never load |
| **Fallback metrics** — `size-adjust`, `ascent-override` | layout shift when the real font arrives |
| **Subsetting** | shipping Latin-Extended + Cyrillic for an English UI |
| **Licensing** | webfont licences are per-domain and per-pageview — a legal cost |
| **Non-Latin coverage** | a family with no CJK/Devanagari/Arabic breaks localisation later |
| **Variable vs static** | one variable file usually beats four static weights |

If the answer to P10 (performance constraints) is tight, **a system font stack
is a legitimate and sometimes correct choice** — `ui-sans-serif, system-ui`
costs zero bytes. Personality then comes from scale, weight, spacing and
colour, which are free.

| Pairing strategy | Headline | Body |
|------------------|----------|------|
| Geometric + humanist | Space Grotesk, Outfit | Inter, Source Sans |
| Editorial + neutral | Fraunces, Instrument Serif | Inter, Satoshi |
| Technical + neutral | JetBrains Mono (as headline) | Inter |
| Single family, multi-weight | Inter 700, tight tracking | Inter 400 |

Pairing two similar sans-serifs (Inter + Roboto) is worse than using one - it
reads as a mistake rather than a choice.

### 3.3 Optical corrections that separate pro from amateur

```css
h1, h2, h3 {
  letter-spacing: -0.02em;  /* large type needs negative tracking */
  line-height: 1.1;         /* headlines tighten */
  text-wrap: balance;       /* no orphan words */
}
body { line-height: 1.6; }  /* body breathes */
p    { text-wrap: pretty; max-width: 68ch; }  /* measure */
.caps { letter-spacing: 0.08em; }  /* small caps need POSITIVE tracking */
.num  { font-variant-numeric: tabular-nums; }  /* ALWAYS in tables */
```

- **Measure:** 45-75 characters per line. Full-width paragraphs are the single
  most common readability failure.
- **Tabular numerals in every table, timer, and price.** Proportional digits
  make columns jitter as values change.
- Headline line-height tightens as size grows; body line-height stays 1.5-1.65.

### 3.4 Hierarchy via weight and colour, not size alone

Three sizes times three weights times three text colours gives nine distinct
levels. Nine sizes gives nine fights.

---

## 4. Spacing - one scale, geometric

```css
--space-1: 0.25rem;  --space-2: 0.5rem;   --space-3: 0.75rem;
--space-4: 1rem;     --space-6: 1.5rem;   --space-8: 2rem;
--space-12: 3rem;    --space-16: 4rem;    --space-24: 6rem;
```

**Rules:**

1. Every gap, padding, and margin comes from the scale **by default**. A value
   off the scale needs a reason, and the legitimate reasons are narrow:
   *optical* alignment (nudging an icon so it looks centred when it is not),
   hairlines and `1px` borders, chart and axis geometry, matching a platform
   control's intrinsic metrics, and compensating for a font's side bearings.
   Write the reason in a comment. `padding: 13px` alone is a defect;
   `padding: 13px /* optical centring, icon baseline sits 3px high */` is craft.
2. **Space is proportional to relatedness.** Label to input `space-2`; field to
   field `space-4`; group to group `space-8`; section to section `space-16` or
   more. Uniform `1rem` everywhere destroys grouping - this is exactly why
   generic forms feel like undifferentiated lists.
3. **Vertical rhythm matters more than horizontal.** Readers scan downward. Get
   the vertical sequence right first.
4. Section padding on marketing pages is bigger than you think: `space-24`
   (96px) vertical, not `space-8`.

---

## 5. Layout and composition

### 5.1 Break the centered-column reflex

A single centered `max-w-4xl` column for everything is the layout equivalent of
grey-on-white. Reach for:

- **Asymmetric split** - 2fr/1fr, content plus rail
- **Bento grid** - mixed-span cards on a 12-column grid
- **Full-bleed band** - one section escapes the container entirely
- **Sticky sidebar** with scrolling content
- **Overlap** - a card that straddles two background bands

### 5.2 Use grid, and let items span unequally

```css
.grid    { display: grid; grid-template-columns: repeat(12, 1fr); gap: var(--space-6); }
.feature { grid-column: span 7; }
.aside   { grid-column: span 5; }
```

Equal-width cards in a 3-up row are the default everyone reaches for. Unequal
spans signal intent.

### 5.3 Fluid without breakpoint soup

```css
/* intrinsically responsive, zero media queries */
.cards { grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); }
.hero  { font-size: clamp(2rem, 5vw + 1rem, 4rem); }
.shell { width: min(100% - 2rem, 72rem); margin-inline: auto; }
```

### 5.4 Alignment is binary

Every element aligns to a shared edge or it does not. Pick few alignment lines
and hold them absolutely. One stray 4px indent reads as broken.

---

## 6. Depth, borders, radius

### 6.1 Shadows: layered, tinted, directional

```css
/* WRONG - the tutorial shadow */
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

/* RIGHT - multi-layer, hue-tinted, ambient plus direct */
--shadow-sm: 0 1px 2px oklch(0.2 0.03 265 / 0.04),
             0 1px 3px oklch(0.2 0.03 265 / 0.06);
--shadow-md: 0 2px 4px oklch(0.2 0.03 265 / 0.04),
             0 4px 8px oklch(0.2 0.03 265 / 0.06),
             0 8px 16px oklch(0.2 0.03 265 / 0.04);
--shadow-lg: 0 4px 8px oklch(0.2 0.03 265 / 0.04),
             0 12px 24px oklch(0.2 0.03 265 / 0.08),
             0 24px 48px oklch(0.2 0.03 265 / 0.06);
```

Real shadows are tinted toward the surface hue and spread across two or three
layers. Pure-black single-layer shadows look like 2014.

### 6.2 Elevation must be a *system*

Define 3-4 levels and map each to a meaning: `0` flush, `1` card, `2` dropdown,
`3` modal. A component picks a level; it never invents an ad-hoc shadow.

### 6.3 Borders often beat shadows

Dense, information-rich UI (Linear, Notion) uses hairline borders
(`1px solid var(--border)`) rather than shadows. Shadow-heavy UI reads consumer;
border-heavy reads professional.

**Commit per elevation level, not globally.** It is entirely correct for a data
table to be delimited by borders while a modal three levels up uses elevation —
they solve different problems, and a floating surface must read as detached in a
way a table row must not. What is wrong is *ad-hoc* mixing: two components at
the same elevation level treated differently.

So define the treatment for each level in §6.2 and hold it. A table and a card
both at level 1 must match each other.

### 6.4 Radius consistency, with nesting correction

```css
--radius-sm: 0.375rem; --radius-md: 0.5rem;
--radius-lg: 0.75rem;  --radius-xl: 1rem; --radius-full: 9999px;
```

**Nesting rule:** inner radius equals outer radius minus padding. A `radius-xl`
card with `space-4` padding needs inner elements at about `radius-md`, or the
corners look wrong in a way most people feel but cannot name.

---

## 7. Motion

### 7.1 Ease curves - never `ease` or `linear` for UI

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);      /* entrances - decelerate */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);     /* state-to-state moves */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);  /* playful overshoot */
--dur-fast: 150ms; --dur-base: 250ms; --dur-slow: 400ms;
```

Entrances decelerate (`ease-out`). Exits accelerate and run faster (about
`150ms`) - the user has already decided, so do not make them wait.

### 7.2 Budget

- hover and focus: **100-150ms**
- dropdown, tooltip, accordion: **200-250ms**
- modal, drawer, page transition: **300-400ms**
- anything over **500ms** feels broken

### 7.3 Animate compositor properties only

`transform` and `opacity` run on the GPU. Animating `width`, `height`, `top`, or
`margin` triggers layout on every frame and janks. Use `transform: scale()` and
`translate()` instead.

### 7.4 Reduced motion is a design, not a duration override

The blanket override is the floor, not the goal. It stops motion; it does not
produce a considered experience.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Flattening durations leaves real problems unsolved. Handle each deliberately:

| Pattern | Reduced-motion behaviour |
|---------|--------------------------|
| **Infinite animations** (spinners, pulses) | a static or text indicator, not a 0.01ms loop |
| **Loading shimmer** | a static placeholder — shimmer at 0.01ms flickers |
| **Auto-playing video / GIF** | do not autoplay; poster plus a play control |
| **Parallax, scroll-linked motion** | disable entirely — the most common trigger |
| **Spring overshoot** | plain cut; overshoot is vestibular, not decorative |
| **Focus movement, scroll-into-view** | jump instantly, never smooth-scroll |
| **Layout transitions** | cross-fade or nothing — do not animate geometry |
| **Toast / drawer entrances** | appear in place, no slide |

`prefers-reduced-motion` is a vestibular-disorder accommodation, not a
preference for subtlety. Treat "no motion at all" as a fully supported mode.

### 7.5 Transforms cannot express every transition

"Animate compositor properties only" (§7.3) is the right default and an
incomplete rule. Geometry changes — a card growing, a list reordering, a panel
expanding — cannot be done with `transform` alone without distorting content.

For those use a FLIP technique (measure, invert with a transform, play) or the
View Transitions API where available, rather than animating `width`/`height`
directly. Where neither is practical, a cross-fade beats a janking layout
animation.

---

## 8. State - the half nobody builds

A screen is not done when the happy path renders. **Every data surface needs
five states**, and missing them is the most common cause of "it looks
unfinished":

| State | Requirement |
|-------|-------------|
| **Loading** | Skeleton matching the final layout. Never a centered spinner on an empty page - it causes layout shift and reveals nothing. |
| **Empty** | Icon or illustration, plus one line explaining *why* it is empty. "No data" alone is a dead end. Offer the action that resolves *this* emptiness — often not a create action: "Clear filters" for a filtered-to-zero result, "Request access" for a permissions block, nothing at all for a read-only audit log or a legitimately finished queue. Never invent a primary action to satisfy a checklist. |
| **Error** | What failed, in plain language, plus a retry affordance. Never a raw stack trace or a bare "Something went wrong." |
| **Partial** | Some rows loaded, more coming. Preserve scroll position. |
| **Populated** | The happy path. |

Also required on every interactive element: `:hover`, `:focus-visible`,
`:active`, `:disabled`, and `aria-busy` during async work.

**Focus rings are mandatory.** `outline: none` with no replacement is an
accessibility defect, not a style choice.

```css
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
```

---

## 9. Density and data display

- **Table rows:** compact 32-36px, comfortable 44-48px. Pick from the brief.
- Right-align numbers, left-align text, always with `tabular-nums`.
- Sticky header on any table taller than the viewport.
- **Zebra striping is usually wrong** - a hairline bottom border is cleaner.
- Truncate with `text-overflow: ellipsis` **plus** a `title` or tooltip.
- Minimum touch target **44x44px** on any touch-reachable control.

---

## 10. Dark mode is a redesign, not an inversion

```css
:root { color-scheme: light dark; }
```

Rules that genuinely differ in dark:

1. **Never pure black.** Use `oklch(0.17 0.01 265)` as the base. Pure `#000`
   with white text causes halation - the text appears to vibrate.
2. **Never pure white text.** Use `oklch(0.95 0.005 265)`, not `#fff`.
3. **Elevation inverts.** In light, higher means more shadow. In dark, higher
   means a **lighter surface** - shadows are nearly invisible on dark grounds.
4. **Desaturate accents 10-15%.** The same chroma that reads confident on white
   screams on dark.
5. Borders need *more* relative contrast in dark, not less.

Define the full light palette on bare `:root`, then override **only tokens**
inside `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`. A colour
whose only definition lives inside a media query is a bug.

---

## 11. The Anti-Generic Checklist

Run this before declaring UI work done. **Every `yes` needs a reason** — and an
unreasoned `yes` is a defect.

These detect *accidents*, not crimes. A single centered column is right for a
login page; equal cards are right for genuinely equal options; a Tailwind-sized
value is right when it happens to sit on your scale. What this catches is not
"you made this choice" but "you did not make a choice." Where the answer is
deliberate, record it under Rejected Alternatives (§0.1) and move on.

```
[ ] Is the primary accent Tailwind blue-500 / #3b82f6 (or indigo-600)?
[ ] Is every font-size a Tailwind default, with no documented scale?
[ ] Is the typography accidental — the default stack, one weight, ad-hoc sizes?
[ ] Is every shadow a single-layer rgba(0,0,0,0.1)?
[ ] Is every radius the same value, with no nesting correction?
[ ] Is every section a centered max-w container of the same width, down the page?
[ ] Are all cards in a row the same span, in a 3-up grid?
[ ] Is every gap 1rem / gap-4?
[ ] Are transitions `ease`, `linear`, or `transition: all`?
[ ] Do numbers in tables use proportional figures?
[ ] Are loading / empty / error states missing?
[ ] Is `outline: none` used without a focus-visible replacement?
[ ] Is the background pure #fff (light) or pure #000 (dark)?
[ ] Could you swap this UI into a different product and nobody would notice?
```

That last one is the real test.

---

## 12. Signature Detail (one, if the product earns it)

Aim for **one** deliberate, memorable detail. Not five. Possibly not any.

Examples: a gradient-mesh or noise-texture hero; a custom cursor inside one
zone; a spring-collapsing sidebar; numbers that count up on reveal; a hand-drawn
underline on the key heading; a scroll-linked progress indicator; an
unexpectedly beautiful empty state.

Name it in the design brief (B8). Build it **last**, after the workflow
works — and only if it emerges from what the product actually does.

The best signature details are behaviours, not ornaments: a queue that shows you
exactly where your job sits, a diff that highlights the one line you care about,
a gate failure that tells you the fix. Those are memorable because they are
*useful*.

A mandatory flourish produces gimmicks — animated sidebars, decorative graph
effects, custom cursors bolted on after the real problem was solved. If nothing
has emerged by the time the workflow is finished, write "none — the clarity is
the signature" in the brief. That is an acceptable answer, and for tools it is
often the right one.

---

## 13. Accessibility floor (never negotiable)

- Semantic HTML first. `<button>` for actions, `<a>` for navigation. A
  `<div onClick>` is a defect.
- One `<h1>` per page; heading levels never skip.
- Every input has a programmatically associated `<label>`.
- Keyboard-operable: logical tab order, `Escape` closes overlays, focus trapped
  in modals and **restored** on close.
- All images: meaningful `alt`, or `alt=""` if purely decorative.
- Live regions (`aria-live`) for async status changes.
- Test at **200% zoom** and **320px width** before declaring done.

---

## 14. Hard references

- `docs/design-brief.md` - the brief from section 1, written before any code
- `src/styles/tokens.css` - the only file containing colour literals
- `frontendstandards.md` - code organisation (complements this file)
- Visual QA gate - `yuva gate visual` (runs the audit in section 11 against
  the rendered page; `yuva gate` runs it with every other gate)
