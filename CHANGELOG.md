# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Design capability — the gap between Yuva and Lovable/Bolt/v0

Yuva could build correct software and not design it. Twelve dev agents, eight
standards, four quality gates — and nothing in the chain owned *visual outcome*.
`frontendstandards.md` covered folder naming and hooks order; nothing covered
type scales, colour systems, or composition. And every gate read source text, so
`lint`, `typecheck`, `test` and `build` all passed on UI that looked terrible.

**`.yuva/standards/designsystem.md`** — the taste layer. Formula-based rules an
agent can actually follow: OKLCH ramp generation, modular type scales, 60-30-10
colour allocation, relatedness-proportional spacing, layered shadows, motion
budgets, the five required data states, and a 14-item anti-generic checklist
whose items are all machine-detectable.

**Design agent** (`yuva agent show design`) — runs between Risk and Planner,
because design decisions made *during* implementation get made as framework
defaults, and framework defaults are what generic UI is. Produces
`docs/design-system.md` (including rejected alternatives, so Execution cannot
regress a deliberate choice) and `src/styles/tokens.css`.

**Visual QA agent** (`yuva agent show visualqa`) — runs the gate, then opens the
screenshots and works a 10-item human-judgement rubric the automated rules
cannot cover.

#### `visual` quality gate

```bash
yuva gate visual
```

Boots the dev server, renders every configured route at every configured
viewport in Chromium, screenshots each, and audits the **rendered** result —
computed styles, not source text. Writes screenshots plus a review rubric to
`.yuva/run/visual/<timestamp>/`.

17 rules. Blocking: `generic-accent` (Tailwind blue-500 / Bootstrap primary),
`low-contrast` (WCAG AA, computed), `focus-suppressed`, `horizontal-overflow`,
`heading-order`, `missing-alt`, `console-error`. Advisory: `pure-surface`,
`type-scale-sprawl`, `grey-sprawl`, `flat-shadow`, `transition-all`,
`uniform-spacing`, `radius-sprawl`, `no-tabular-nums`, `div-as-button`,
`no-reduced-motion`.

Three implementation notes worth recording, each found by testing against a real
browser rather than reasoning about it:

- **The CSSOM is not what you wrote.** Chrome serialises
  `transition: all 0.3s ease` as `transition: 0.3s`, dropping `all` because it
  is the initial value — so matching declaration *text* can never detect it.
  Read computed style instead.
- **Chrome returns `oklch()` computed colours as `oklch()`**, not `rgb()`. The
  contrast rules were silently skipping every colour authored in the space
  `designsystem.md` mandates. `lib/design-audit.js` now implements OKLab →
  sRGB, validated to **zero channel delta** against Chrome's own conversion
  across 10 cases including `%` lightness and slash alpha.
- **Headless Chromium reports `prefers-reduced-motion: reduce`**, which makes a
  *correct* reduced-motion block flatten every duration to `1e-05s`. Without a
  duration floor, well-designed pages reported dozens of false violations.

Focus detection is empirical rather than parsed: each control is focused and
checked for an actual indicator, because computed `outline-width` reports a
value even when `outline-style: none` hides it.

**Opt-in.** The gate appears only once `visual` is configured, so existing
projects upgrade with no behaviour change. Playwright is a peer concern, never a
dependency — the gate reports how to install it rather than bloating every
install.

**`.yuva/templates/tokens.css`** — a complete starting token system (OKLCH ramp,
type scale, spacing, layered shadows, easing curves, dark mode as a redesign
rather than an inversion) with every contrast ratio computed and recorded. A
page built only from these tokens passes the gate with zero findings.

### Fixed (review pass 2 — correctness and source-of-truth)

Two external reviews found the design capability was a strong manifesto on an
unexecutable contract. Everything verifiable in both held. Most damaging was
self-inflicted: `frontendstandards.md` was copied into the package on its heading
outline, so it shipped examples the project's own gate flags.

**Contradictions that misled (agents copy examples, not prose)**

- `frontendstandards.md` presented `<div onClick={...}>` under a `// Good` comment
  in a section titled "Functional Components (Preferred)" — code that
  `lib/design-audit.js`'s own `div-as-button` rule flags and `designsystem.md`
  calls a defect. It also shipped `items.sort()` (mutates in place) as an
  "Optimization Rule", recommended **Jest** in a **Vitest** repo, and — found by
  reading the rest, which nobody had — `useMemo(() => { }, [])` (returns
  undefined), `{count && <Badge/>}` (renders `0`), `error.status` on a thrown
  error rather than `response.ok`, a flat "4.5:1" contrast rule weaker than
  `designsystem.md` §2.4, webpack-bundle-analyzer for a Vite stack, and
  CSS-Modules-ranked-first beside a `Button.styles.ts` tree that is CSS-in-JS.
  **Rewritten**: framework-neutral core plus React/Vue/Svelte adapters, with
  every rule tagged `[MUST]` / `[SHOULD]` / `[MAY]` — `React.memo` and
  `useCallback` demoted to `[MAY]`, since applied reflexively they cost more than
  they save.
- `tokens.css` declared `color-scheme: light dark` once, so forcing a theme left
  native controls following the OS. Now pinned per theme — and *not* the way the
  review proposed: a bare `color-scheme: light` on `:root` would invert the bug,
  giving an OS-dark user dark tokens with light chrome.
- `--bg-elevated: oklch(1 0 0)` sat two lines under a `/* never pure #fff */`
  comment. The choice is right (a white card on an off-white ground, and
  `pure-surface` only inspects `<body>`); it is now *stated*.
- Replaced the unfalsifiable "Verified: … passes with zero findings" with a dated
  record naming the fixture, viewport, browser and what it does **not** cover.

**Gate bugs found by building a fixture that consumes the real token file**

- `low-contrast` flagged every correctly-styled **disabled** control. WCAG 1.4.3
  exempts inactive controls; the collector now skips `disabled`,
  `aria-disabled` and `fieldset:disabled` subtrees.
- A `<body>` with no background computes to `rgba(0,0,0,0)` and was reported as
  "pure #000000" with full confidence. Now read through `effectiveBackground()`.
- `grey-sprawl` counted *all* text colours, so a status table plus syntax
  highlighting tripped it. Now counts only near-neutrals, measured as absolute
  channel spread — relative saturation exaggerates at low lightness and
  misclassifies ordinary dark surfaces like `rgb(40,42,48)`. Real palettes
  separate cleanly: neutrals 0–14, semantic hues 82–187.

**Source of truth**

- Renamed the brief `docs/design-system.md` → **`docs/design-brief.md`**. One
  hyphen from `designsystem.md` was why ten references collapsed into the wrong
  file and why "§7 of `designsystem.md`" resolved to **Motion** instead of
  Component Inventory.
- Namespaced section numbers: product brief `P1`-`P10`, design brief `B1`-`B8`,
  contracts `C1`-`C12`. A cross-reference can no longer land in the wrong file.
- `lib/paths.js` gained design-artifact accessors. These resolve under `docs/`,
  not `.yuva/`, because `enforcement-rules.js` `PROTECTED_DIRS` blocks workers
  from writing beneath `.yuva/` — so an agent-authored contract cannot live there.
- Wired up `templates/tokens.css`, which was referenced from **nowhere** while
  instructing an agent that was never told it existed.
- `'visual'` was missing from `RUNTIME_ENTRIES`, so `migrate()` would never move
  a legacy `.yuva/visual/`.

**Honesty and scope**

- Visual QA no longer claims to be "the only gate that can fail because something
  looks wrong". Its findings are split three ways — automatically testable /
  human-review only / **not currently enforced** — sourced from
  `componentcontracts.md` §13 so there is one list.
- Added a mutation boundary (allowed: gate config and fixtures; forbidden:
  application code and production design; handoff: source fixes), resolving
  "never implement the fixes yourself" sitting beside "edit `.yuva/config.json`".
- Playwright install is now a **blocking prerequisite to report**, not a QA
  action — it writes the lockfile, downloads ~130MB and fails in CI.
- Replaced ask-vs-never-stall with an **ask-once** policy: ask, default, mark
  `PROVISIONAL`, continue, never re-ask. Only P2 (the main job) truly blocks.
- Split **interaction** states (controls) from **data** states (surfaces). A
  button has no empty state.
- Accent contrast is now a **matrix** — as text, as fill, as border, as icon, as
  focus ring, plus disabled and non-text (1.4.11), in both themes.
- The gate renders **320px** now, and stopped generating a rubric that asked
  about 375px while the prompt called 320 the floor.

**New regression guards** (the point: prose is free, code is not)

- `tests/docs-references.test.js` — every path referenced by package docs either
  ships or is a declared agent output, and every `yuva …` string resolves against
  the real CLI. Written first, failed on three real bugs, now green. This bug
  class had recurred four times.
- `tests/tokens-consistency.test.js` — the two dark palettes must declare the
  same token set (CSS cannot share one), `color-scheme` tracks the active set,
  no dangling `var()`, and **every documented contrast ratio is recomputed** —
  a wrong ratio is worse than none, because it is the number someone cites.

### Tests (pass 2)

522 → 613.

#### `e2e` integration — behaviour, where the visual gate stops

Integrates [`e2e`](https://github.com/tester-army/e2e) (Apache-2.0), an
agent-driven test framework: you state a goal in natural language, an agent
drives the app to reach it, and you assert with ordinary locators.

**Why this and not just more prompt text.** `componentcontracts.md` section 13
had three rows stuck in "review only" because no screenshot could settle them —
keyboard operability, focus restoration after a dialog closes, and whether a data
surface actually reaches its five states. Those are *behaviour*. The Visual QA
prompt had been asking a human to drive the keyboard by hand. `e2e` is Playwright
underneath, same as the `visual` gate, so this adds a tool rather than a stack.

**`yuva e2e`** — `run`, `init`, `list`, `cache`, `status`. Separate from
`yuva gate` on purpose: an agent step calls a model the first time and whenever
the app changes (verified steps replay from cache otherwise), and a gate that
silently spends money on every build is a gate people disable. It becomes a gate
only with `{ "e2e": { "gate": true } }` — doubly opt-in, since the config block
alone is not enough.

**Auth: the subscription you already pay for, not an API key.** Yuva drives AI
*CLIs* — Claude Code, Codex, Gemini, OpenCode, Aider — which are already paid for
by subscription. Defaulting the behaviour suite to a per-token API key would make
a Yuva user buy a second way to pay for the same work, so `lib/e2e-auth.js`
chooses in this order: a login e2e already holds → a subscription they plausibly
already have → a local model → an API key, last and really only for CI.

| Yuva CLI | How the agent signs in |
|---|---|
| `codex` | `yuva e2e login openai` — the *same* ChatGPT sign-in Codex uses |
| `claude`, `gemini`, `opencode`, `aider` | `yuva e2e login github-copilot` |
| any, with the GitHub CLI present | `--from-gh`, reusing the existing `gh` login |

e2e has no Claude subscription support, so a Claude Code user reaches Anthropic
models through **GitHub Copilot** — which serves OpenAI, Anthropic, Google and
xAI models over one login. The scaffolded config comes out as
`copilot('claude-sonnet-5')` with no key anywhere. Verified: with
`ANTHROPIC_API_KEY` sitting in the environment, init still picks the
subscription, and a test asserts an API key is never recommended when any
subscription route exists.

Yuva reads only the provider *names* from `~/.config/e2e/oauth.json`, never a
credential value — there is a test for that too. `yuva e2e login`, `logout` and
`models` pass straight through, since they are interactive browser or device-code
flows that wrapping would only obstruct.

**`yuva e2e init`** scaffolds `e2e.config.ts` and five starter behaviour tests
drawn from the contracts rather than from imagination (product brief P3/P7, and
C5/C7/C8), and reuses the `visual` gate's app URL so both gates test the same
thing.

**`lib/e2e-runner.js`** parses the `report-1` document. The schema is not
published — the CLI reference says it ships inside the package, so it was read
from `e2e/schema/report-v1.schema.json` rather than guessed, and a test
cross-checks the fixtures against that file so this cannot drift into testing an
imagined shape. `schemaVersion` is checked and a mismatch reported loudly;
`e2e` is pre-1.0.

Three results that read as green and are not, all surfaced:

- **`e2e-silent-skip`** — 7 of the 9 skip causes in the schema (`setup-failed`,
  `infrastructure-unavailable`, `hook-failed`, …) mean the test never ran. Only
  `explicit` and `filtered` are benign. An untested test is not a passing one.
- **`e2e-flaky`** — passed on a retry. Advisory by default, blocking via
  `failOnFlaky`.
- **`e2e-no-tests`** — a suite that runs nothing passes trivially.

Exit codes are mapped from the CLI reference rather than inferred, because the
difference between "a test failed" (1) and "your model provider is down" (3) is
the difference between a finding and a wild goose chase. A `maxCostUsd` ceiling
warns when a run overspends, pointing at `e2e cache stats` — a climbing bill
usually means something invalidates the cache every run.

**`lib/cost-tracker.js`** now accepts known figures. `recordCall()` estimated
tokens from character counts, which was all any caller had; `e2e` reports real
`modelTokens` and `estimatedCostUsd`, so passing those through a character
estimator would have thrown away the one accurate number in the system. Callers
without real figures are unaffected.

**New E2E agent** (`yuva agent show e2e`), placed before Visual QA in the chain:
prove it works, then judge how it looks. Its central rule is to write goals, not
click paths — `agent.act('upgrade the workspace to Pro')` survives the button
moving and replays from cache, where a recorded click path breaks and re-bills.

### Fixed

- **The `.bin` shim would have broken the whole integration on Windows,
  silently.** Since Node 18.20 / 20.12, spawning a `.cmd` without `shell: true`
  throws `EINVAL` (the CVE-2024-27980 mitigation) — and `execFileSync` reports it
  with `stdout` and `stderr` both `undefined`, so `yuva e2e list` printed nothing
  and looked like an empty project. Now resolves the package's own JS entry from
  its `bin` field and runs it with `process.execPath`: identical on every
  platform, and no `shell: true`, so no quoting or injection surface. The
  passthrough also no longer fails silently when both streams are empty.
- `resolveTemplateFile()` returns file **content**, not a path — I had assumed a
  path from its name and fed the template text to `fs.readFileSync`. The same
  "read the API, do not assume it" lesson as the report schema.
- `tests/docs-references.test.js` parsed `yuva e2e` as `yuva e`, because its
  command extractor allowed no digits. The guard caught the resulting unresolved
  command, which is what it is for; the extractor now allows digits.

### Tests

725 → 805 (+50 e2e-runner, including the fixture-vs-schema cross-check and every
skip cause the schema declares; +28 e2e-auth, including that the provider
catalogue matches the oauth modules e2e actually exports, and that no credential
value can leak out of the login store).

### Note on devDependencies

`e2e` is a devDependency here purely so the vendored report schema can be
cross-checked; it is **not** a runtime dependency, and the integration resolves
`e2e` from the project being tested, never from Yuva. Runtime `dependencies` are
still `execa`, `glob`, `picocolors`.

#### Closing the three stated gaps — and what running it found

The previous passes left three gaps recorded honestly in
`componentcontracts.md` §13: no axe-core, no 200% zoom, and — the real one —
`captureAndAudit()` had **never executed**. Every other part of the gate was
tested against injected observations; the Playwright half had only ever been
reasoned about.

Playwright and axe-core are now **devDependencies**. Runtime `dependencies` are
unchanged (`execa`, `glob`, `picocolors`), so consumers get nothing extra; both
remain optional peers resolved from the project being audited.

**Running the gate for the first time found four bugs no unit test could have.**

1. **A focus ring was baked into every screenshot — and every baseline.** The
   audit focuses each control to test for focus indicators, then restores. But
   `previouslyFocused` is `<body>`, which *has* a `.focus()` method and is not
   focusable, so the restore was a silent no-op and focus stayed on the last
   control probed. The `else` blur branch never ran. Worse, this was *introduced*
   by the earlier reorder that put the audit before the screenshot; before that,
   the screenshot came first and the bug could not appear. Now blurs
   unconditionally, then restores only a genuinely focusable previous element.

2. **`page.clock.pauseAt()` deadlocked `axe.run()`.** Pausing the clock stops
   every timer in the page, and anything waiting on one never resolves — axe hung
   until the gate's 12-minute budget. Two fixtures, each correct alone, that
   deadlock together. Fixed by using `setFixedTime` instead: a deterministic
   *displayed* clock without stopping the world, which is what the fixture was
   for. `axe.run()` is additionally bounded at 60s, because a third-party rule
   set running inside someone else's page deserves a timeout regardless.

3. **A contrast tolerance was excusing real failures.** `ratio + 0.05 < needed`
   silently passed 4.47:1 against a 4.5 requirement. axe flagged it as *serious*
   and the hand-written rule did not. Contrast is deterministic to ~1e-9, so a
   0.05 slack was not absorbing float noise — it was about 10,000,000x larger
   than the noise it claimed to absorb. Now `needed - 0.005`.

4. **`"axe": false` was a silent no-op.** `resolveConfig()` never copied `axe`
   into the resolved config, so the opt-out read as `undefined`, axe ran anyway,
   and its presence then deduped away the built-in accessible-name rule. Found
   only because an end-to-end test asserted on a finding that quietly vanished.

**New checks**

- **Accessible names** on interactive controls — computed the way a browser
  would (aria-label, aria-labelledby, associated `<label>`, text content, image
  alt, submit `value`, title). No dependency. Suppressed when axe is present,
  since `axe/button-name` covers the same ground more thoroughly; reporting both
  double-counts one defect, which is the noise that teaches people to skim.
- **200% text zoom**, scaling the root font size rather than using browser or CSS
  zoom. That asymmetry is the point: rem/em text grows while `px` does not, which
  is exactly the WCAG 1.4.4 failure worth catching. Real zoom scales px too and
  would hide it. Verified against a 120x28px box whose rem text overflows.
- **axe-core**, optional and namespaced `axe/<rule>`. `critical`/`serious` block,
  `moderate`/`minor` advise — a gate that fails on every minor finding gets
  switched off, and a switched-off gate checks nothing. When absent the report
  prints **axe-core: NOT RUN — conformance rules unverified** rather than
  reading as clean.

**`tests/visual-gate-e2e.test.js`** exercises the real thing: real server, real
browser, real screenshots, real baseline comparison, real regression detection.
It self-skips when Playwright or its browser is missing, so a contributor without
a 130MB download still gets a green suite — and prints a warning when it skips,
so a green run never silently means "skipped everything that matters".

### Tests

695 → 725.

#### Deterministic visual fixtures and baselines (Phase D)

The gate rendered whatever the app happened to show, so a screenshot of an empty
shell passed every rule in the audit. `lib/visual-fixtures.js` adds the missing
determinism: a seed command run before the server, Playwright `storageState` for
auth, route-level network stubs, a frozen clock, animation freezing, an explicit
ready selector, and masked regions for avatars and timestamps.

**Baseline diffing runs inside the Chromium the gate already launched**, via
canvas. `toHaveScreenshot` lives in `@playwright/test` — a second test runner, in
a repo whose own standard now says *use the existing one* — and pixelmatch/pngjs
would add dependencies to a package that deliberately keeps Playwright an
optional peer. The browser already decodes PNG and walks pixels, so it does.
Verified against known inputs in real Chromium: a 10x10 red square on a 100x100
white ground counts as **exactly 100** differing pixels, ratio exactly `0.01`; a
5-per-channel delta is ignored at tolerance 12 and caught at tolerance 2; a
height change reports `sizeMismatch` with both sizes.

Two details that are load-bearing:

- **The audit now runs BEFORE freezing, and that ordering is a correctness
  requirement.** The audit reads `transitionDuration` and `transitionProperty`
  from computed style; freezing sets both to `0s`, which would have silently
  disabled the `transition-all` rule and made every page look compliant.
- **`animation-play-state: paused`, not just zeroed durations.** A zero-duration
  infinite animation still advances, so a spinner would freeze on an arbitrary
  frame and the diff would flake every run.

A first run reports `baseline: created` and says plainly that it **verified
nothing** — it recorded what the page looks like now, so whatever is wrong in it
has just become the expected result. Fixture failures surface as **FIXTURE
WARNINGS** rather than being swallowed, because a baseline comparison is only as
trustworthy as the determinism underneath it.

#### The full agent lifecycle (Phase E)

Existing Code, Tester, Security, Reviewer and State Manager had no place in the
frontend chain, and there was no way back when the *design* was wrong rather than
the implementation — which made the first brief into frozen authority.

```
EXISTING CODE -> Requirements -> Risk -> DESIGN -> Planner -> Execution
             -> Tester -> Security -> Reviewer -> VISUAL QA -> ship
```

Existing Code runs first and writes `docs/architecture-constraints.md`, because
Design cannot choose a token system without knowing the framework, CSS strategy,
SSR model, existing component library, browser floor and perf budget.
Tester/Security/Reviewer run before Visual QA, which drives the real app by
keyboard and wants one that already compiles.

Two distinct return paths: an **implementation** defect goes Visual QA →
Execution → Visual QA; a **foundation** defect goes Visual QA → Design → Planner
→ Execution → Visual QA. It is a foundation defect when the decision is wrong
rather than the code — the accent fails contrast on its own background, density
contradicts product brief P6, a contract needs behaviour the framework cannot
express, the signature detail fights accessibility. **If a finding survives two
round-trips, escalate** with both positions stated; two agents disagreeing about
taste do not converge by repetition.

**Session CLI, two latent bugs fixed:** `session save` printed "Checkpoint
saved." even with no active session (`save()` now returns a boolean and the CLI
honours it), and `session decision` silently truncated unquoted multi-word input
— `session decision use postgres faster writes` recorded `what="use"`,
`why="postgres"` and dropped the rest. It now refuses and suggests the quoted
form. The `--type` vocabulary is documented (`note` `code` `plan` `design` `qa`
`risk` `security` `review` `todo` `issue`), including that
`log --type decision` does *not* record a decision — only `session decision`
does.

#### Design profiles (Phase F)

The standard foregrounded asymmetry, bento grids, signature details and custom
motion — a marketing language, pushed onto operations consoles. New §0.2 declares
a **profile** (`operations` / `marketing` / `consumer`) in the contract, and whole
groups of rules switch with it. For `operations`: layouts are **predictable and
repeated** (a row that moves between screens costs the user their place), density
is compact, motion is hover-and-focus only, input is keyboard-first, and §12 does
**not** require a signature detail — "none, the clarity is the signature" is the
expected answer.

New §0.3 reframes the swap test as a **signal, not a gate**. Familiarity is
frequently correct: a login form, settings page or data table that behaves exactly
as users expect is better than a novel one, because the user spends no attention
learning it. The real failure is nobody on the team being able to say what makes
the product theirs.

### Fixed

- `showGateHelp()` never actually gained the visual-gate documentation added two
  passes ago: that edit used a non-asserted `replace()` and silently did nothing.
  Same bug class as the broken doc references — a silent no-op. Every edit script
  since asserts its anchors, which is why this was the last one. The help now
  documents the fixtures and baseline config too.

### Tests

662 → 695 (+33 visual-fixtures, mostly `baselineDecision` policy: first run,
explicit update, sub-threshold noise, exactly-at-threshold, size change,
comparison unavailable, zero threshold).

#### Design contract — the machine-readable handoff (Phase C)

Both reviews converged on one sentence: *stop treating Markdown prompts as the
entire design-system contract.* Markdown keeps judgement and workflow;
`docs/design-contract.json` carries what an agent must not re-interpret — the
token file's real path, which globs are application-owned UI source, the token
names by tier, the component inventory with tiers and states, the a11y target,
and what "done" means.

**`lib/design-contract.js`** — loader, validator and source-lint engine, shaped
like `design-audit.js` (`load` / `validate` / `lint` / `evaluate` / `summarize` /
`formatFindings`) so the rules are unit-testable without a fixture per rule.

**Registered as `BUILTIN_RULES['design-contract']`** in `lib/plugin-gates.js`
rather than as a native gate. `design-audit` needed native wiring only because it
drives a browser and `runGates()` is synchronous; a contract check reads files
synchronously, so the plugin path gives automatic inclusion in `runAllGates()`,
automatic reporting in `yuva gate` and `yuva gates`, and free enable/disable via
`.yuva/config.json → pluginGates`. Zero new wiring.

**It is silent, not passing, on a project with no contract.** Built-in plugin
rules default to *enabled*, so without this every existing project would get a
wall of advice on upgrade.

**The loader is deliberately not `fs-utils.readJSON`**, which returns `null` for a
missing file and a syntax error indistinguishably. For an authored, committed
artifact those are opposite situations: absent means "not adopted" and must be
silent; malformed or a version mismatch means "someone broke it" and must be
loud. (The repo's only other versioned artifact, `neural-graph.js`, does
`version !== 1 → return false` — right for a rebuildable cache, wrong here.)

**What it now enforces**, moving six rows of `componentcontracts.md` §13 out of
"review only": colour literals outside the token file, components reaching for
primitive tokens, off-scale spacing, tokens the contract never declared, the
Tier 0/1 no-fetch rule, and components declared without a contract file.

Why these could not be automated before: a colour-literal lint with no declared
scope false-positives on tests, SVG, documentation examples, chart config,
generated files and vendor code — worse than no lint, because people learn to
ignore it. The contract supplies the missing scope (`uiSource`, `exclude`, plus an
always-excluded set) and the missing vocabulary (`tokens.semantic`,
`tokens.primitive`, `tokens.scales`). Verified end to end: a fixture with a
literal in a component **and** the same literal in a sibling `.test.tsx` reports
the first and ignores the second.

Nuances that keep it honest: off-scale spacing is permitted *with a comment*,
because `frontendstandards.md` allows one-offs for optical alignment; hairlines
and `0` are always allowed; a component may own tokens named after itself
(`--button-*`); and only spacing properties are checked, so `width: 437px` is not
a finding.

This also fixes the false-negative that shipped in Visual QA: its grep hardcoded
`src` as the root and looked only at `.tsx`/`.css`, so a Next `app/` directory, a
SvelteKit project or a monorepo package matched nothing and the step reported
clean. The gate reads the globs from the contract instead, and the greps are gone.

**`.yuva/templates/design-contract.json`** ships as the starter, with 105 semantic
tokens matching `tokens.css`, the primitive list, the scales, a worked two-component
inventory, a `profile` switch (operations / marketing / consumer), a `provisional`
list for ask-once defaults, and an `acceptance` block.

### Fixed (defects introduced by the previous pass)

Found by re-reading my own output, which is the only reason they were caught:

- The ask-once policy was **inserted beside** the paragraph it was meant to
  replace, so `designagent.md` said both "use defaults and mark PROVISIONAL" and
  "never fall back to defaults". A contradiction added while removing
  contradictions.
- `designagent.md` still called the Design-before-architecture ordering
  "deliberate and non-negotiable". It now separates the part that is
  non-negotiable (design before *implementation*) from the part that was wrong
  (design before *technical constraints are known*), and requires framework, CSS
  strategy, SSR model, browser floor and perf budget first — from
  `docs/architecture-constraints.md`, the Existing Code agent, or recorded as
  `PROVISIONAL`.
- Step 3 still said "visual **1**, **2**, **5**" after the `B#` renumbering.
- The namespacing note was inserted **into the middle** of the standards table in
  `CLAUDE.md`, orphaning the `frontendstandards.md` row out of the table.

### Tests

613 → 662 (+49 design-contract, most of them false-positive protection: a literal
in a test file, in the token file, in a comment, on a `var()` line; an off-scale
value with a justifying comment; a Tier 2 component that is allowed to fetch).

#### Component contracts — the behaviour half of the design system

Review of the first cut landed: it was a taste manifesto, not a design system. It
said how things should *feel* and nothing about how components should reliably
*behave* — no component inventory, APIs, variants, interaction or state
contracts, naming conventions, token governance, testing rules, or
versioning policy.

**`.yuva/standards/componentcontracts.md`** splits the system in two:
`designsystem.md` answers *what should this look like* (per project, negotiable);
component contracts answer *how must this behave* (per component, not
negotiable). 14 sections:

- **The 12-section contract**, written BEFORE the implementation — it is the
  spec, not documentation of whatever got built
- **Three tiers** with dependency rules: primitives, compositions, patterns.
  Only Tier 2 touches the network, which is what keeps Tier 0/1 testable
- **Naming conventions** as pick-once rules: no negated booleans, handlers report
  rather than command, state on `data-` attributes rather than class names
- **Variant discipline** — closed sets, max three axes, no variant may change
  semantics
- **State contracts** — the idle/pending/settled/error machine, and the
  controlled-vs-uncontrolled-vs-dual decision that must be made once per
  component rather than drifting into both
- **Interaction contracts** — timing table, and a destructive-action protocol
  driven by the product brief's P7, scaling confirmation to consequence
- **Token governance** — primitive / semantic / component tiers, where a
  component referencing a primitive token is a defect, plus a deprecation path
- **Responsive contracts** for the decisions CSS cannot infer (sidebar collapse,
  column priority, modal sizing), with 320px and 200% zoom required
- **Accessibility contracts** targeting WCAG 2.2 AA explicitly, including dialog
  semantics with focus restoration, live-region politeness, table/grid behaviour,
  accessible charts, and RTL/long-text/forced-colors
- **Testing rules** — query by role and accessible name, assert on `data-state`
  never class names, and the list of things not to test
- **Versioning** — including the two breaking changes people miss: changing a
  default, and changing an accessible name
- **A worked `DataTable` contract** as proof the template survives the hard case

### Changed

Calibration pass on `designsystem.md` after the same review — 12 edits
correcting an anti-generic bias that could force novelty over clarity:

- **New §0.1 precedence**: when a rule conflicts with the product's job, the
  product wins. Any rule may be overridden for one line in Rejected
  Alternatives — the enforcement target is recorded-vs-unrecorded, not the rule
- **New §1.0 product brief, before the visual brief**: primary user, the main
  job, critical workflow, core objects, what reads in 3 seconds, data volume,
  dangerous actions, failure consequences, permissions, perf constraints.
  Avoiding three visual revisions by causing three functional ones is not a win
- 60-30-10 demoted from fake measurement to heuristic, with three checkable
  rules in its place
- OKLCH gained gamut guidance, `@supports` fallbacks, a browser floor,
  interpolation space, and forced-colors — plus the admission that Yuva's own
  `oklchToRgb()` clips per channel, which shifts hue: clamping is not gamut
  mapping
- "Two fonts maximum" → "deliberate, not accidental", with a loading/licensing/
  non-Latin cost table that explicitly blesses a system stack under tight perf
- Spacing allows off-scale values for optical alignment, with a comment
- Borders-vs-shadows is now per elevation level, not a global commitment
- Reduced motion gained an 8-pattern table and §7.5 on FLIP/View Transitions —
  flattening durations is the floor, not a considered experience
- Empty states no longer demand a primary action (filtered-to-zero, read-only,
  permission-denied, finished queue)
- "Every `yes` is a defect" → "every `yes` needs a reason"; the checklist
  detects accidents, not crimes
- Signature detail is now "if the product earns it", with *"none — the clarity is
  the signature"* valid and often right for tools

### Fixed

- **`designsystem.md` referenced `yuva gate run --only visual`, which does not
  exist** (`Unknown gate: run`). Now `yuva gate visual`. A check that resolves
  every command string in the design docs against the real CLI is how this was
  caught.
- **`frontendstandards.md` was referenced twice but shipped only outside the
  package.** Now in `template/.yuva/standards/`.
- **`yuva gate visual` in an unconfigured project said `Unknown gate: visual`**
  instead of explaining that the gate is opt-in. It now prints the config block
  and the Playwright install line.

### Known gaps

Stated rather than implied, since a standard that claims unavailable enforcement
is worse than one that admits the gap (`componentcontracts.md` §13):

- colour literals outside `tokens.css`, components reaching for primitive
  tokens, and off-scale spacing values are **review items, not lints**
- no axe-core integration and no accessible-name check in the gate
- screenshots have **no baseline diffing**, so they are review material rather
  than regression tests
- the gate's default viewports do not include **320px or 200% zoom**, which the
  standards now require
- `no-reduced-motion` only checks that a media query exists — it would pass the
  naive duration-flattening that §7.4 now calls insufficient

### Changed (gate internals)

- `GATE_ORDER` is now `lint, typecheck, test, build, visual`.
- `runGates()` stays **synchronous**. The visual gate is inherently async, so it
  runs through `execFileSync` on `lib/visual-runner.js` rather than forcing an
  async signature on hooks, swarm workers and `task done`.

### Tests (first pass)

504 → 522 (+18 visual-gate integration, including the opt-in upgrade-safety
guarantee; +69 design-audit, including the OKLCH ground-truth cases).

## [2.4.0] - 2026-09-19

First release since 2.1.0. Versions 2.2.0 and 2.3.0 were tagged but never
reached npm — see [Infrastructure](#infrastructure) for why.

**86 files changed, +3,115 / −727. Tests: 354 → 411.**

### Added

#### `yuva tokens` — token cost optimizer

A new command group for cutting what the swarm *sends*, which is the half of
LLM cost you control.

```bash
yuva tokens profile   # token breakdown per role: frozen vs volatile vs per-task
yuva tokens project   # projected input cost for the current task bus
yuva tokens doctor    # find prompt-cache breakers before they cost you
```

Prompt caching is a **prefix match** — one differing byte invalidates every
cached token after it. Profiling real work packages showed **96.8% of each one
was byte-identical across tasks**, but it was emitted *after* the per-task
content, so none of it could ever cache.

Work packages are now built in three zones:

| Zone | Contents | Caches |
|------|----------|--------|
| `frozen` | agent instructions, enforcement rules, completion protocol | across every task in a role |
| `volatile` | git state, codebase analysis | until a commit lands |
| `task` | id, title, description, feedback, graph context | never — unique per task |

Measured on a 14-task / 3-role swarm at 2 attempts each: **39,030 → 13,675
input tokens, a 65% reduction.** `yuva tokens doctor` fails loudly if a task
id, timestamp, or git branch is ever reintroduced into the frozen prefix.

> The saving assumes the downstream AI CLI caches the prefix yuva now makes
> cacheable. Token counts are estimated at ~4 chars each; read real figures
> from your provider's usage report.

#### `yuva swarm unstick`

Recover stuck task claims without hand-editing JSON.

```bash
yuva swarm unstick          # release expired or orphaned claims
yuva swarm unstick <id>     # release one task
yuva swarm unstick --all    # force-release every claim
```

With nothing expired it reports how long each claim has been held, rather than
silently doing nothing.

### Changed

#### `.aiautomations/` consolidated into `.yuva/`

One directory, with a clear committed/ignored split:

```
.yuva/                COMMITTED — travels with the repo
  config.json         tool, model and gate configuration
  agents.md           agent index
  prompts/            your custom agent prompts
  gates/              your custom quality gates
  run/                GITIGNORED — regenerated at runtime
    tasks/            task bus records
    workers/          worker registrations
    session/          session state
    graph/            neural graph cache
    events.log        event stream
```

`yuva init` now writes a single `.yuva/run/` line to `.gitignore` instead of
ignoring the whole directory, so agent configuration is shared with your team.

**Upgrading:** `yuva upgrade` migrates automatically — it moves
`.aiautomations/` into `.yuva/`, relocates runtime state into `.yuva/run/`,
folds any legacy `.session/` in, and rewrites `.gitignore`. It is idempotent
and never overwrites an existing target file. Until you run it, the old
locations keep working: reads fall back, writes always go to the new layout.

### Fixed

#### Swarm deadlock — a stuck claim blocked every dependent task

A worker could hold a task indefinitely while reporting `idle`, blocking the
whole dependency chain behind it. Three causes compounded:

- `releaseStale()` exempted interactive workers entirely, but
  `yuva worker next` is a one-shot process that exits right after claiming —
  so it can never heartbeat, and its claim was never reclaimable.
- `claimTask()` set `currentTask` but never `status: 'working'`, which is why
  the dashboard showed `idle` for a worker holding a task.
- A claim whose worker record was deleted had nothing to expire it.

Claims now carry a **30-minute lease** enforced regardless of worker mode,
alongside fast reclamation for dead heartbeating workers and a sweep for
orphaned claims. `renewClaim()` lets genuinely long-running work extend its
lease. Spent interactive worker records are pruned so the worker table stops
growing by one dead row per task.

#### Orchestrator dashboard flooded non-TTY output

`\x1b[2J` (clear screen) is a no-op when stdout is piped or captured, so
"redraw in place" silently became "append another full frame" every 3 seconds.

Now: TTY detection with a one-line-per-change log mode for non-TTY output, a
state fingerprint that ignores relative timestamps (they change every tick by
definition), graph and cost reads cached at 15s, and quality gates run only
when a task actually awaits verification instead of on every tick.

Measured: 12 ticks at 1s produced **3 lines** instead of ~12 full frames.

#### Worker process crashed instead of losing a log

`fs.createWriteStream` opens asynchronously, and a stream with no `'error'`
listener re-throws as an **uncaught exception** that kills the process. A full
disk, a permissions change, or clearing `.yuva/run/` mid-task would take down
the worker rather than just losing a diagnostic log. Output capture now
continues even when the log file is unwritable.

#### Terminal spawning on Windows

`spawn(..., { shell: true })` runs `cmd.exe /d /s /c "..."`, and `/s` strips
only the **outermost** quote pair — so the hand-built
`start "title" /D "dir" cmd /k "command"` string lost its nested quoting and
arrived mangled.

- Arguments are now passed as a real argv array, never a pre-quoted string.
- Windows Terminal is used when available, giving one tab per worker.
- The working directory is validated before spawning, so a bad path reports
  what is wrong instead of a bare exit code.
- **Launch failures are reported honestly.** The previous version returned
  success whenever `spawn` did not throw synchronously, so terminals that never
  opened were reported as opened. Failed spawns now print the exact command to
  run manually.
- `YUVA_DEBUG=1` logs the exact argv handed to the OS.

#### Smaller fixes

- Git `stderr` no longer leaks into your terminal — `execSync` inherits stderr
  by default, so any non-repo directory printed `fatal: not a git repository`.
- Unhandled promise rejections in async commands (`swarm`, `loop`, `worker`)
  no longer vanish with a zero exit code.
- `yuva doctor` flags a legacy layout and points at `yuva upgrade`.
- Repository URLs updated to the `yuvamind` organisation after the transfer.

### Infrastructure

#### Continuous integration

Lint and the full suite now run on **Node 20, 22 and 24** for every push and
pull request. It caught the worker-process crash above on its first run — a
latent bug that Windows timing had masked locally.

#### Release pipeline rebuilt

The previous setup could not publish, which is why 2.2.0 and 2.3.0 exist as
tags but never reached npm:

- `version-bump.yml` created a GitHub Release using the default `GITHUB_TOKEN`,
  and **GitHub does not trigger workflows from `GITHUB_TOKEN` events** (a
  recursion guard). `publish.yml` listened for `release: created` and therefore
  never woke up.
- It also bumped the version on *every* `feat:` commit to `main`.
- Neither workflow ran the tests before publishing.

Both are replaced by a single `release.yml` — verify, bump, publish, tag,
release — with four guards: it reuses the CI job verbatim so the release gate
cannot drift, refuses to republish an existing version, fails if the agent
templates are missing from the tarball, and `prepublishOnly` re-runs lint and
tests even on a manual `npm publish`.

[2.4.0]: https://github.com/yuvamind/yuva-ai/releases/tag/v2.4.0
