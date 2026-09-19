# Yuva AI

**[yuvaog.com](https://yuvaog.com/)** | Turn your AI coding tool into a coordinated multi-agent system.

[![npm version](https://img.shields.io/npm/v/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![Tests](https://img.shields.io/badge/tests-387_passing-green.svg)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What It Does

Yuva AI adds **structure** to AI coding. Instead of your AI guessing about your codebase, it gets real context, enforced rules, and coordinated workflows.

- **Neural Graph** — Maps your code relationships. AI gets only the relevant context, not the whole codebase.
- **Security Scanning** — Catches hardcoded secrets, vulnerable deps, and config issues before they ship.
- **Quality Gates** — Enforces lint, tests, JSDoc, no console.log, and custom rules. Work isn't "done" until they pass.
- **Prompt Enforcement** — Machine-verified rules. If the AI touches protected files, its work is rejected automatically.
- **Swarm Mode** — Multiple AI workers (executor, tester, reviewer) coordinate through a shared task bus.
- **Loop Engine** — Fully autonomous: AI plans tasks, workers build, gates verify, AI reviews and replans.
- **Session Persistence** — Never lose context between conversations. Auto-saves after every command.

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
yuva doctor                      # Diagnose setup issues
yuva status                      # Project overview

# Scan
yuva scan code                   # Analyze codebase (routes, models, env vars)
yuva scan security               # Find secrets, vulnerable deps, config issues

# Graph
yuva graph build                 # Build code knowledge graph
yuva graph query "auth"          # Search for relevant code nodes
yuva graph context "fix login"   # Preview what context a task would get

# Gates
yuva gate                        # Run all quality gates (lint + test + build)
yuva gates                       # Run plugin gates (console.log, TODO, JSDoc, etc.)

# Agents
yuva agent list                  # List all 12 agents
yuva agent show <name>           # Get agent prompt
yuva agent orchestrate           # Scan project context for AI

# Swarm (multi-worker)
yuva swarm init                  # Create task bus
yuva swarm plan "build auth"     # Break goal into tasks
yuva swarm spawn                 # Open worker terminals
yuva swarm start                 # Orchestrator dashboard
yuva swarm unstick               # Release stuck task claims (--all to force)
yuva task add "title" --role executor
yuva worker next --role executor
yuva task done <id> --summary "..."

# Loop (fully autonomous)
yuva loop run "add auth with tests"   # Plans, builds, verifies, replans
yuva loop stop                        # Stop the loop

# Session
yuva session start "goal"        # Start tracking
yuva session resume              # Get full context
yuva session end                 # End session

# Cost
yuva cost                        # Show AI usage
yuva cost set-budget 50          # Set spending limit
```

## Agents

| Agent | Purpose |
|-------|---------|
| `existingcode` | Analyze codebase before changes |
| `requirements` | Gather what to build |
| `riskassessment` | Identify risks |
| `planning` | Design architecture |
| `execution` | Implement code |
| `tester` | Write and run tests |
| `reviewer` | Code quality audit |
| `security` | Vulnerability scan |
| `debugger` | Fix bugs |
| `refactor` | Improve code |
| `continuity` | Resume from last session |
| `statemanager` | Update session state |

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
    ├── yuva gate → quality enforcement
    └── yuva task done → enforcement + gates + graph learning
```

The AI gets real project context, follows enforced rules, and only declares work done when quality gates pass.

## Project Layout

`yuva init` creates a single `.yuva/` directory. Its config half is meant to be
**committed** so your whole team shares the same agents and gates; only the
runtime half is gitignored.

```
.yuva/                COMMIT THIS
  config.json         tool, model, and gate configuration
  agents.md           agent index
  prompts/            your custom agent prompts
  gates/              your custom quality gates
  run/                gitignored - regenerated at runtime
    tasks/            task bus records
    workers/          worker registrations
    session/          session state
    graph/            neural graph cache
    events.log        event stream
```

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

If the AI touches any of these, its task is automatically rejected.

## Development

```bash
npm install
npm test                 # 387 tests
npm run lint
```

## License

MIT
