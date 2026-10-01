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

### Tests

522 → 613.

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
