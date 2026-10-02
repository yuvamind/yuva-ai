# Yuva AI

**[yuvaog.com](https://yuvaog.com/)** | Turn your AI coding tool into a coordinated multi-agent system.

[![npm version](https://img.shields.io/npm/v/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![Tests](https://img.shields.io/badge/tests-805_passing-green.svg)](https://vitest.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What It Does

Yuva AI adds **structure** to AI coding. Instead of your AI guessing about your codebase, it gets real context, enforced rules, and coordinated workflows.

- **Neural Graph** — Maps your code relationships. AI gets only the relevant context, not the whole codebase.
- **Security Scanning** — Catches hardcoded secrets, vulnerable deps, and config issues before they ship.
- **Quality Gates** — Enforces lint, typecheck, tests, build, and custom rules. Work isn't "done" until they pass.
- **Design System + Visual Gate** — A taste standard, a component-contract standard, and a gate that renders your UI in Chromium and audits the *rendered* result: contrast, generic accents, focus rings, accessible names, 200% zoom, axe-core.
- **Behaviour Tests (`e2e`)** — Agent-driven tests: state the goal in plain language, an agent drives the app, you assert with locators. Proves keyboard operability and focus restoration, which no screenshot can.
- **Prompt Enforcement** — Machine-verified rules. If the AI touches protected files, its work is rejected automatically.
- **Swarm Mode** — Multiple AI workers (executor, tester, reviewer) coordinate through a shared task bus.
- **Loop Engine** — Fully autonomous: AI plans tasks, workers build, gates verify, AI reviews and replans.
- **Token Optimizer + Cost Tracking** — Orders work packages for prompt caching, finds cache-breakers, projects and records spend.
- **Session Persistence** — Never lose context between conversations. Auto-saves after every command.

## What's New in 2.5.0

**Design capability.** Yuva could build correct software and not design it. Three new agents (`design`, `visualqa`, `e2e`) and two new standards close that gap:

- `.yuva/standards/designsystem.md` — the taste layer: type scales, OKLCH colour ramps, spacing scales, motion rules, and a *product brief before the visual brief* so clarity always outranks novelty.
- `.yuva/standards/componentcontracts.md` — the behaviour layer: a 12-section contract written **before** each component, three component tiers, closed variant sets, state and interaction contracts, WCAG 2.2 AA targets, testing and versioning rules.
- **Design profiles** (`operations` / `marketing` / `consumer`) switch whole rule groups: an operations console gets predictable repeated layouts and keyboard-first input, not bento grids and signature motion.
- `.yuva/templates/tokens.css` and `.yuva/templates/design-contract.json` — a complete starter token system and the machine-readable handoff that tells agents what they must not re-interpret (token file path, UI source globs, token names by tier, component inventory).
- A **return path**: when the *design* is wrong rather than the code, Visual QA hands back to Design, not Execution.

**`yuva gate visual`.** Boots your dev server, renders every configured route at every viewport in Chromium, and audits computed styles — not source text. Checks banned generic accents, computed contrast ratios, grey sprawl, type-scale sprawl, suppressed focus indicators, horizontal overflow, heading order, missing alt text and accessible names, `transition: all`, reduced-motion support, console errors, and **200% text zoom**. Optional axe-core integration (`axe/<rule>`). Deterministic fixtures — seed command, auth `storageState`, network mocks, frozen clock and animations, ready selector, masked regions — plus **baseline screenshot diffing** inside the same Chromium.

**`yuva e2e`.** Integrates the [`e2e`](https://github.com/tester-army/e2e) agent-driven test framework: `run`, `init` (scaffolds `e2e.config.ts` and starter behaviour tests), `list`, `login`, `models`, `cache`, `status`. Subscription login first (Claude, Copilot, OpenAI — no API key), local Ollama as the fallback. Findings: `e2e-failed`, `e2e-timed-out`, `e2e-silent-skip` (a setup failure is an *untested* test, not a pass), `e2e-flaky`, `e2e-no-tests`, `e2e-cost`. Doubly opt-in as a gate (`e2e.gate: true`) because agent steps cost money whenever the app changed; spend is recorded in `yuva cost`.

**Design contract lint.** `BUILTIN_RULES['design-contract']` validates `docs/design-contract.json` and lints your UI source against it: colour literals outside the token file, primitive tokens used where a semantic one belongs, undeclared tokens, off-scale spacing.

**TypeScript.** The whole package is strict TypeScript compiled to `dist/`, with type declarations for the programmatic API (`require('yuva-ai')` is unchanged). Three latent path-resolution bugs were found and fixed by the move.

## Install

```bash
npm install -g yuva-ai
cd your-project
yuva init
```

That's it. Open your project in your AI tool — it reads `AGENTS.md` and knows what to do.

## Commands

```bash
# Setup
yuva init                        # Auto-detect AI tool + build neural graph
yuva init --all                  # Generate native configs for every supported tool
yuva doctor                      # Diagnose setup issues
yuva status                      # Project overview
yuva upgrade                     # Migrate an older layout into .yuva/
yuva update                      # Update yuva-ai and regenerate configs

# Scan
yuva scan code                   # Analyze codebase (routes, models, env vars)
yuva scan security               # Find secrets, vulnerable deps, config issues

# Graph
yuva graph build                 # Build code knowledge graph
yuva graph query "auth"          # Search for relevant code nodes
yuva graph context "fix login"   # Preview what context a task would get

# Gates
yuva gate                        # Run all quality gates (lint, typecheck, test, build, visual)
yuva gate visual                 # Render + audit the UI in Chromium
yuva gate list                   # Show detected gates without running them
yuva gates                       # Run plugin gates (design contract, console.log, TODO, ...)

# Behaviour tests
yuva e2e init                    # Scaffold e2e.config.ts and starter tests
yuva e2e                         # Run the behaviour suite
yuva e2e login                   # Sign in to a subscription (no API key)
yuva e2e status                  # Install, auth, config and gate state

# Agents
yuva agent list                  # List all 15 agents
yuva agent show <name>           # Get agent prompt
yuva agent orchestrate           # Scan project context for AI

# Swarm (multi-worker)
yuva swarm init                  # Create task bus
yuva swarm plan "build auth"     # Break goal into tasks
yuva swarm spawn                 # Open worker terminals
yuva swarm start                 # Orchestrator dashboard
yuva swarm status                # One-shot snapshot
yuva swarm unstick               # Release stuck task claims (--all to force)
yuva task add "title" --role executor
yuva worker next --role executor
yuva worker boot --role tester --cli claude     # Boot an AI CLI as a looping worker
yuva task done <id> --summary "..."

# Loop (fully autonomous)
yuva loop run "add auth with tests"   # Plans, builds, verifies, replans
yuva loop doctor                      # Which installed AI CLIs work headlessly
yuva loop stop                        # Stop the loop

# Tokens
yuva tokens profile              # Frozen vs per-task tokens in a work package
yuva tokens project              # Projected input cost for the current bus
yuva tokens doctor               # Find prompt-cache breakers

# Session
yuva session start "goal"        # Start tracking
yuva session log "note"          # Log a work entry
yuva session resume              # Get full context
yuva session end                 # End session

# Cost
yuva cost                        # Show AI usage
yuva cost set-budget 50          # Set spending limit

# Other
yuva llm use cursor              # Switch AI tool / platform
yuva config set model opus       # Edit .yuva/config.json
yuva add create <name>           # Create a custom agent
yuva hook pretooluse             # PreToolUse hook: denies writes to protected files
```

## Agents

| Agent | Purpose |
|-------|---------|
| `existingcode` | Analyze codebase before changes |
| `requirements` | Gather what to build |
| `riskassessment` | Identify risks |
| `design` | Design decisions, product + design briefs, tokens (before planning) |
| `planning` | Design architecture |
| `execution` | Implement code |
| `tester` | Write and run tests |
| `e2e` | Agent-driven behaviour tests: keyboard, focus, five states |
| `visualqa` | Screenshot the UI and audit it against the design standard |
| `reviewer` | Code quality audit |
| `security` | Vulnerability scan |
| `debugger` | Fix bugs |
| `refactor` | Improve code |
| `continuity` | Resume from last session |
| `statemanager` | Update session state |

For UI work the chain is fixed and the order is the point — design decisions made during implementation become framework defaults, and framework defaults are generic UI:

```
EXISTING CODE -> REQUIREMENTS -> RISK -> DESIGN -> PLANNER -> EXECUTION
             -> TESTER -> SECURITY -> REVIEWER -> E2E -> VISUAL QA -> ship
```

## Works With

**Commercial:** Claude Code, Cursor, Windsurf, GitHub Copilot, Gemini, Codex, Amazon Q, Cody, Antigravity
**Open Source:** Ollama, LM Studio, Jan, Continue, Aider, OpenCode, Kilo Code

```bash
yuva llm use cursor      # Switch tool
yuva llm use ollama      # Use local model
```

## How It Works

```
Your AI Tool
    │
    ▼
AGENTS.md (reads this on startup)
    │
    ├── yuva agent orchestrate → project context (JSON)
    ├── yuva graph query → relevant code nodes
    ├── yuva gate → quality enforcement (incl. the rendered visual audit)
    ├── yuva e2e → behaviour the screenshots cannot settle
    └── yuva task done → enforcement + gates + graph learning
```

The AI gets real project context, follows enforced rules, and only declares work done when quality gates pass.

## Project Layout

`yuva init` creates a single `.yuva/` directory. Its config half is meant to be
**committed** so your whole team shares the same agents and gates; only the
runtime half is gitignored.

```
.yuva/                COMMIT THIS
  config.json         tool, model, gate, visual and e2e configuration
  agents.md           agent index
  prompts/            your custom agent prompts
  standards/          designsystem.md, componentcontracts.md, frontendstandards.md
  templates/          tokens.css, design-contract.json, component-contract.md, e2e.config.ts
  gates/              your custom quality gates
  run/                gitignored - regenerated at runtime
    tasks/            task bus records
    workers/          worker registrations
    session/          session state
    graph/            neural graph cache
    visual/           visual-gate screenshots, diffs and reports
    events.log        event stream
```

Design artifacts the agents author live under `docs/`, not `.yuva/`, because
workers may not write beneath `.yuva/`: `docs/product-brief.md`,
`docs/design-brief.md`, `docs/design-contract.json`, and one
`docs/components/<Name>.md` contract per component.

`yuva init` adds a single `.yuva/run/` line to `.gitignore`.

Upgrading from v2.1 or earlier? `yuva upgrade` moves `.aiautomations/` into
`.yuva/`, relocates runtime state into `.yuva/run/`, and fixes `.gitignore`.
Until you run it, the old locations keep working.

## Protected Files

These files are **never** modifiable by AI workers:

```
.yuva/  .session/  .aiautomations/  AGENTS.md  CLAUDE.md
.claude/  .cursor/  package-lock.json  yarn.lock
```

If the AI touches any of these, its task is automatically rejected. The
`yuva hook pretooluse` command enforces the same rule as a PreToolUse hook,
before the write happens.

## Development

The package is TypeScript. Source lives in `bin/`, `lib/` and `index.ts`;
`npm run build` compiles it to `dist/`, which is what the `yuva` binary and
`require('yuva-ai')` load.

```bash
npm install
npm run build            # tsc -> dist/ (with type declarations)
npm run typecheck        # strict, tests included
npm test                 # builds first, then 805 tests
npm run lint
```

## License

MIT
