# Yuva AI

**[yuvaog.com](https://yuvaog.com/)** | A neural-graph development agent framework with **enforcement**, **multi-agent swarm**, **12 specialized agents**, **20 LLM platforms**, and **auto-detection**.

[![npm version](https://img.shields.io/npm/v/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![npm downloads](https://img.shields.io/npm/dt/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![npm downloads/month](https://img.shields.io/npm/dm/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-300_passing-green.svg)](https://vitest.dev/)

## What is this?

A **development agent framework** that turns your AI coding tool into an enforced, graph-aware multi-agent system:

- **Neural Graph** — code knowledge brain that maps file relationships, reduces token costs 60-80%
- **Prompt Enforcement** — machine-verified rules, not just markdown suggestions
- **12 Specialized Dev Agents** — Requirements, Planning, Execution, Testing, Security, Debugging, and more
- **Smart Verification** — identifies which task broke the build (not just "blame the last one")
- **Git Branch Isolation** — each worker gets its own branch; failures roll back automatically
- **File Conflict Detection** — prevents two workers from editing the same file
- **Security Scanning** — npm audit, hardcoded secrets, dangerous patterns
- **Plugin Gates** — custom code quality rules beyond lint/test/build
- **Cost Tracking** — tracks AI token usage with budget limits
- **Quality Gates** — `yuva gate` runs real lint/test/build checks; work isn't "done" until they pass
- **Swarm Mode** — multi-terminal orchestrator/worker system with enforced verification
- **Loop Engine** — zero-touch autopilot: AI plans → workers build → gates verify → AI reviews
- **Session Persistence** — never lose progress across conversations
- **Zero Dependencies** — pure Node.js, installs in seconds

## Quick Start

```bash
# Install globally
npm install -g yuva-ai

# Initialize in your project (auto-detects your AI tool + builds neural graph)
yuva init

# Or specify your tool
yuva init opencode
yuva init cursor
yuva init codex
```

That's it. Open your project in your AI tool — it reads `AGENTS.md` and knows how to use agents.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENTS.md (Orchestrator)                   │
│  AI reads this file and learns how to use the agent system   │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
         ┌──────────────────┐  ┌──────────────────┐
         │ yuva agent       │  │ Neural Graph      │
         │ orchestrate      │  │ (auto-built)      │
         │                  │  │                   │
         │ Scans project:   │  │ Maps: files,      │
         │ - existing code? │  │ functions, routes, │
         │ - language?      │  │ components, deps,  │
         │ - framework?     │  │ concepts, decisions│
         │ - git status?    │  │                   │
         └──────────────────┘  └──────────────────┘
                    │                   │
                    ▼                   ▼
         ┌──────────────────────────────────────────┐
         │          ENFORCED WORK PACKAGES           │
         ├──────────────────────────────────────────┤
         │ Dynamic context + graph subgraph +       │
         │ agent prompt + checklists + standards +  │
         │ enforcement rules + quality gates        │
         └──────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
         ┌──────────────────┐  ┌──────────────────┐
         │ Prompt Enforcer  │  │ Quality Gates     │
         │                  │  │                   │
         │ Pre-flight:      │  │ Project: lint,    │
         │ - understands?   │  │ test, build       │
         │ - scope valid?   │  │                   │
         │                  │  │ Plugin: no-console,│
         │ Post-task:       │  │ no-todo, no-unused│
         │ - protected files│  │ deps, env-sync    │
         │ - scope creep?   │  │                   │
         └──────────────────┘  └──────────────────┘
```

## CLI Commands

```bash
# Setup
yuva init                  # Auto-detect AI tool and initialize (+ builds graph)
yuva init opencode         # Initialize for specific tool
yuva init cursor --force   # Reinitialize for different tool
yuva doctor                # Diagnose setup (checks graph, gates, bus, config)
yuva status                # Project status (graph, costs, gates, session)

# Agent Commands
yuva agent show <name>     # Get full agent prompt (on demand)
yuva agent list            # List all available agents
yuva agent orchestrate     # Scan project context (JSON output)

# Neural Graph (code knowledge brain)
yuva graph build           # Build/update the graph from codebase
yuva graph build --force   # Full rebuild (ignore cached graph)
yuva graph stats           # Show graph statistics
yuva graph query <text>    # Search for relevant nodes
yuva graph context <task>  # Preview what context a task would get
yuva graph clear           # Clear the graph

# Scan & Security
yuva scan                  # Run code analysis + security scan
yuva scan code             # Code analysis only (modules, routes, complexity)
yuva scan security         # Security scan only (deps, secrets, patterns)

# Quality Gates (enforced, not advisory)
yuva gate                  # Run all gates (project + plugin)
yuva gate list             # Show detected gates
yuva gates                 # Run plugin gates (code quality rules)
yuva gates list            # List available plugin gates

# Cost Tracking
yuva cost                  # Show AI cost summary
yuva cost set-budget 50    # Set budget limit ($50 USD)
yuva cost reset            # Reset cost tracking

# Loop Engine (autopilot — zero-touch plan→build→verify→replan)
yuva loop run "goal"       # Fully autonomous: AI plans, workers build, gates
                           #   verify, AI reviews & replans until the goal is done
yuva loop status           # Show loop state and task counts
yuva loop stop             # Signal the loop and all workers to stop
yuva loop doctor           # Test which AI CLIs work headlessly

# Swarm (multi-terminal orchestrator/worker mode — the default for big tasks)
yuva swarm init            # Create the task bus (.yuva/)
yuva swarm plan "goal"     # Print the orchestrator planning brief
yuva swarm spawn           # AUTO-OPEN worker terminals in this project dir
yuva swarm start           # Live dashboard + automatic verification
yuva task add "title" --role executor   # Add work to the bus
yuva worker next --role executor        # Claim a task in this terminal
yuva task done <id> --summary "..."     # Finish (enforcement + gates run)

# Session Persistence (auto-saves)
yuva session start "goal"  # Start tracking a session
yuva session log "message" # Log progress
yuva session resume        # Get full context (for AI or you)
yuva session status        # Show session state
yuva session end           # End current session

# Configuration
yuva config                # Show current config
yuva config set <k> <v>    # Set a config value
yuva llm list              # List supported LLMs
yuva llm use <name>        # Switch LLM platform

# Analytics
yuva telemetry             # Manage usage analytics
yuva analytics             # View analytics dashboard
yuva help                  # Show full help
```

## Neural Graph — Code Knowledge Brain

The neural graph maps your codebase like a brain maps neurons. Each **node** is an entity (file, function, class, concept, decision), each **edge** is a relationship (imports, calls, depends-on, tests, implements).

### How it reduces token costs

```
BEFORE (no graph):
  Task "fix login bug" → full codebase context → ~5,000-15,000 tokens

AFTER (with graph):
  Task "fix login bug" → graph traverses:
    "login" → auth.js → validatePassword() → db.js → User model
  → only ~500-2,000 tokens of relevant context → 60-80% cheaper
```

### How it learns

When a task completes, the graph:
- Creates a session node for the task
- Connects it to all modified files
- Strengthens edges between files changed together
- Extracts concepts from the task description
- Records decisions made during the task

Over time: "auth.js and db.js are always changed together" becomes a strong connection. "Login concept connects to auth.js, db.js, User model" becomes knowledge the next task benefits from.

### Commands

```bash
yuva graph build           # Scan codebase and build the graph
yuva graph stats           # Show: 47 nodes, 83 edges, 12 node types
yuva graph query "auth"    # Find: auth.js, login(), AuthService, authentication concept
yuva graph context "fix login"  # Preview: 12 nodes, ~340 tokens (vs ~5000 full dump)
```

## Prompt Enforcement — Not Just Markdown

Agent prompts are no longer just suggestions. The **Prompt Enforcer** validates AI output at three points:

### Pre-flight Check (before AI starts)
- Sends a comprehension verification prompt
- AI must output a JSON plan: files it will touch, gates it will run
- If AI plans to modify protected files → task rejected immediately
- If AI can't answer → task rejected before any tokens are spent

### Post-task Validation (when `yuva task done` runs)
- Checks git diff for protected file violations (.yuva/, .session/, AGENTS.md, lock files)
- If ANY protected file was modified → task REJECTED
- Checks scope creep: 3+ unplanned files → task flagged
- Runs BEFORE quality gates — violations block completion entirely

### Protected Files (never modifiable by AI workers)
```
.yuva/          — orchestration state
.session/       — session files
.aiautomations/ — agent configs
AGENTS.md       — AI orchestrator config
CLAUDE.md       — Claude config
.claude/        — Claude directory
.cursor/        — Cursor directory
package-lock.json, yarn.lock, pnpm-lock.yaml
```

## Smart Verification

When quality gates fail, Yuva no longer blames the most recent task. Instead:

1. Runs all gates (project + plugin)
2. If ALL pass → verify all done tasks
3. If gates fail → matches error output against each task's changed files
4. Identifies the **actual culprit** (the task that touched the failing files)
5. Rejects ONLY the culprit; verifies the rest

## Git Branch Isolation

Each headless worker gets its own git branch:
- Branch name: `yuva/worker-w1/task-abc123`
- AI works on the branch
- On success: merge back to main
- On failure: discard branch (automatic rollback)
- Merge conflicts: reported with details, manual resolution

```
yuva worker start --role executor --auto --cli "claude -p"
  ✓ Git branch isolation: ENABLED (each task gets its own branch)
```

If the working tree is dirty or not a git repo, Yuva warns you:
```
⚠ Git isolation UNAVAILABLE: Working tree is dirty (3 uncommitted change(s))
  → Commit or stash changes first (`git stash`), or use --no-isolate to skip
```

## Plugin Gates — Custom Code Quality Rules

Beyond lint/test/build, Yuva runs **plugin gates** — code quality rules that catch what linters miss:

| Rule | What it catches |
|------|----------------|
| `no-console-log` | console.log in production source files |
| `no-todo-fixme` | TODO/FIXME/HACK comments |
| `require-jsdoc-exports` | Exported functions missing JSDoc |
| `no-unused-deps` | Dependencies not imported anywhere |
| `env-example-sync` | Env vars used in code but not in .env.example |

Custom rules: create `.aiautomations/gates/<name>.js`:
```js
module.exports = {
  name: 'No hardcoded URLs',
  severity: 'warning',
  run(targetDir) {
    // Return array of findings
    return [{ file: 'src/api.js', line: 15, message: 'Hardcoded URL found' }];
  }
};
```

## Security Scanning

```bash
yuva scan security
```

Runs:
- **Dependency audit** — npm audit / pip-audit for known vulnerabilities
- **Secret detection** — API keys, Stripe keys, GitHub tokens, AWS keys, private keys
- **Dangerous patterns** — eval(), innerHTML, CORS wildcards, disabled SSL
- **Config issues** — .env not gitignored, debug mode in production

## Cost Tracking

```bash
yuva cost                  # Show: 47 calls, $3.42 estimated
yuva cost set-budget 50    # Block AI calls after $50 spent
```

Tracks every AI CLI call: tokens used, estimated cost, duration, success/failure. The loop engine checks budget before every AI call.

## Available Agents

| Agent | Command | Purpose |
|-------|---------|---------|
| **Existing Code** | `yuva agent show existingcode` | Analyze existing codebase before changes |
| **Requirements** | `yuva agent show requirements` | Gather and clarify what to build |
| **Risk Assessment** | `yuva agent show riskassessment` | Identify risks before development |
| **Planner** | `yuva agent show planning` | Create architecture and detailed plans |
| **Execution** | `yuva agent show execution` | Implement code step-by-step |
| **Continuity** | `yuva agent show continuity` | Resume from last session state |
| **Tester** | `yuva agent show tester` | Create and run tests |
| **Reviewer** | `yuva agent show reviewer` | Code quality analysis |
| **Security** | `yuva agent show security` | Security vulnerability audit |
| **Debugger** | `yuva agent show debugger` | Bug investigation and fixing |
| **Refactor** | `yuva agent show refactor` | Code improvement and cleanup |
| **State Manager** | `yuva agent show statemanager` | Update session files |

All agents now receive **dynamic context** via `{{CONTEXT}}` injection — they see your actual project structure, not generic instructions.

## Multi-LLM Support

Works with **20 AI platforms**. Auto-detected on `yuva init`:

### Commercial
| Platform | Config | Auto-Detect |
|----------|--------|-------------|
| **Claude** (Claude Code, VS Code) | `AGENTS.md` | Yes |
| **GPT / Codex CLI** | `AGENTS.md` | Yes |
| **Gemini** | `GEMINI.md` | Yes |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Yes |
| **Cursor** | `.cursor/rules/yuva.mdc` | Yes |
| **Windsurf** | `.windsurfrules` | Yes |
| **Cody** | `.sourcegraph/instructions.md` | Yes |
| **Amazon Q** | `.amazonq/instructions.md` | Yes |
| **Antigravity** (Google) | `AGENTS.md` | Yes |

### Open Source / Local
| Platform | Config | Auto-Detect |
|----------|--------|-------------|
| **Ollama** (Llama, Mistral, DeepSeek, Qwen) | `OLLAMA_INSTRUCTIONS.md` | Yes |
| **LM Studio** | `OLLAMA_INSTRUCTIONS.md` | - |
| **Jan.ai** | `OLLAMA_INSTRUCTIONS.md` | - |
| **Continue.dev** | `.continue/instructions.md` | Yes |
| **Open Interpreter** | `AGENTS.md` | - |
| **LLM CLI** | `AGENTS.md` | - |
| **Tabby** | `AGENTS.md` | - |

### Terminal / CLI
| Platform | Config | Auto-Detect |
|----------|--------|-------------|
| **OpenCode** | `AGENTS.md` | Yes |
| **Kilo Code** | `.kilo/instructions.md` | Yes |
| **Aider** | `.aider.conf.yml` | Yes |

```bash
# Switch platforms anytime
yuva llm use opencode
yuva llm use cursor
yuva llm use ollama
```

## Project Structure (After `yuva init`)

```
your-project/
├── AGENTS.md                       # Orchestrator (source of truth)
├── .aiautomations/
│   ├── config.json                 # Tool config + package path
│   ├── agents.md                   # Agent index
│   └── gates/                      # Custom plugin gates (optional)
│       └── my-rule.js
├── .yuva/
│   ├── graph/
│   │   ├── graph.json              # Neural graph (auto-built on init)
│   │   └── index.json              # Inverted index for fast search
│   ├── session/                    # Session persistence
│   ├── tasks/                      # Task bus (swarm mode)
│   ├── workers/                    # Worker registrations
│   ├── costs.json                  # Cost tracking
│   └── loop.json                   # Loop engine state
└── .cursor/rules/yuva.mdc         # (only if Cursor detected)
```

## Swarm Mode — Multi-Terminal Orchestrator/Workers

Run a whole AI team in parallel terminals. One **orchestrator** terminal
coordinates; each **worker** terminal takes one role (executor, tester,
reviewer, security, debugger). They coordinate through a zero-dependency,
crash-resumable file bus in `.yuva/`.

```
Terminal 1 (orchestrator)          Terminal 2..N (workers)
─────────────────────────          ───────────────────────
yuva swarm init                    yuva worker next --role executor
yuva swarm plan "build API"        # → prints the full work package:
yuva task add "..." --role ...     #   agent prompt + checklists +
yuva swarm spawn                   #   standards + enforcement + graph
# live dashboard: watches all      #   context + gate protocol
# workers, verifies every result   # do the work, then:
# with quality gates               yuva task done <id> --summary "..."
                                   # enforcement + gates MUST pass
```

**Enforcement flow:**
1. Worker claims task → file conflict check → pre-flight comprehension check
2. Work package includes: dynamic context + graph subgraph + enforcement rules
3. Worker does work on isolated git branch
4. `yuva task done` → enforcement check → quality gates → graph learning
5. Orchestrator verifies → smart culprit attribution

## Loop Engine — Zero-Touch Autopilot

```bash
yuva loop run "add user authentication with tests"
```

```
        ┌─────────────────────────────────────────────┐
        │                                             │
        ▼                                             │
  0. PREFLIGHT verifies the AI CLI answers headlessly │
  0.5 GRAPH     auto-builds neural graph for context  │
  1. PLAN       AI CLI breaks the goal into tasks      │
  2. EXECUTE    headless worker terminals claim them   │
  3. VERIFY     quality gates run on every completion  │
  4. ESCALATE   repeat failures → debugger tasks       │
  5. REVIEW     AI inspects the repo: goal achieved?   │
        │                                             │
        └──── not yet → new follow-up tasks ──────────┘
                     │
                     ▼ achieved
  6. REPORT    .yuva/report.md + workers shut down
```

**Safety rails:**
- `--max-iterations <n>` (default 5) caps plan→review cycles
- `--max-attempts <n>` (default 3) caps retries per task
- `--budget <usd>` caps total AI cost (stops when exceeded)
- Quality gates stay mandatory — the AI cannot mark its own work done
- `yuva loop stop` halts everything; state survives in `.yuva/loop.json`

## Session Persistence

Never lose context between terminal sessions. Sessions **auto-save** after every yuva command.

```bash
yuva session start "Build user auth with JWT"
# ... work normally, run any yuva commands ...
yuva session resume        # Full context: goal, decisions, files changed
yuva session log "Added login endpoint" --type code
yuva session decision "Use bcrypt" "Industry standard"
yuva session end
```

## FAQ

### How does the neural graph reduce costs?

Instead of dumping the entire codebase into every AI prompt (~5,000-15,000 tokens), the graph traverses only the relevant subgraph (~500-2,000 tokens). For a task about "login", it finds: auth.js → validatePassword() → db.js → User model. Everything else is excluded.

### Can I mix different AI systems in one swarm?

Yes. Orchestrator in Claude Code, executor in Claude, tester in Codex, reviewer in Gemini. The task bus stores only worker IDs and roles. Work packages are plain markdown every model can read.

### What happens if a worker modifies a protected file?

The task is automatically REJECTED when `yuva task done` runs. The Prompt Enforcer checks git diff for violations against .yuva/, .session/, .aiautomations/, AGENTS.md, lock files, and other protected paths. The AI cannot bypass this — it's enforced at the system level, not the prompt level.

### How does the graph learn?

When a task completes, the graph creates a session node, connects it to changed files, strengthens edges between files changed together, extracts concepts, and records decisions. Over time, the graph builds up knowledge about which files relate to which concepts.

### What are plugin gates?

Beyond lint/test/build, plugin gates are code quality rules that catch what linters miss: console.log in production, TODO comments, unused dependencies, missing .env.example entries. Custom rules can be added in `.aiautomations/gates/`.

### Does swarm mode need an internet connection?

Yuva itself needs neither. The bus is local files, gates are local commands, the graph is local JSON. Your AI tools use whatever they normally use. A swarm of Ollama workers works completely offline.

## Development

```bash
npm install
npm test                 # 300 tests passing
npm run test:coverage
npm run lint
npm run doctor
```

## Works With

**Commercial:** Claude Code, Cursor, Windsurf, GitHub Copilot, Gemini CLI, Amazon Q, Cody, Antigravity
**Open Source:** Ollama, LM Studio, Jan.ai, Continue.dev, Open Interpreter, LLM CLI, Tabby
**Terminal:** OpenCode, Codex CLI, Kilo Code, Aider
**Models:** Llama 3, Mistral, CodeLlama, DeepSeek, Qwen, Phi-3, GPT-4, Claude, Gemini

## Contributing

1. Create agent prompt in `template/.aiautomations/prompts/`
2. Add to `AGENT_MAP` in `lib/commands/agent.js`
3. Add tests
4. Submit PR

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [Website](https://yuvaog.com/)
- [NPM Package](https://www.npmjs.com/package/yuva-ai)
- [GitHub Repository](https://github.com/Aftab-web-dev/yuva-ai)
- [Report Issues](https://github.com/Aftab-web-dev/yuva-ai/issues)
