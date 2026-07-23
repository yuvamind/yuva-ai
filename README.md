# Yuva AI

**[yuvaog.com](https://yuvaog.com/)** | A lightweight development agent framework with **12 specialized agents**, **20 LLM platforms**, on-demand prompts, and auto-detection.

[![npm version](https://img.shields.io/npm/v/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![npm downloads](https://img.shields.io/npm/dt/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![npm downloads/month](https://img.shields.io/npm/dm/yuva-ai.svg)](https://www.npmjs.com/package/yuva-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-vitest-green.svg)](https://vitest.dev/)

## What is this?

A **development agent framework** that turns your AI coding tool into a multi-agent system:

- **12 Specialized Dev Agents** — Requirements, Planning, Execution, Testing, Security, Debugging, and more
- **On-Demand Prompts** — Agent prompts served from the package, not copied to your project
- **Auto-Detection** — Detects your AI tool (Claude, OpenCode, Cursor, Codex, etc.) and configures automatically
- **19 LLM Platforms** — Works with Claude, GPT, Gemini, Ollama, OpenCode, Cursor, and more
- **Lightweight Init** — Creates only 3 files instead of 67
- **Hybrid Orchestrator** — CLI scans your project, AI picks the right agents
- **Quality Gates** — `yuva gate` runs real lint/test/build checks; work isn't "done" until they pass
- **Swarm Mode** — Multi-terminal orchestrator/worker system: parallel AI workers, one dashboard, enforced verification
- **Loop Engine** — Zero-touch autopilot: AI plans → workers build → gates verify → AI reviews & replans until the goal is done
- **Session Persistence** — Never lose progress across conversations
- **Zero Dependencies** — Pure Node.js, installs in seconds

## Quick Start

```bash
# Install globally
npm install -g yuva-ai

# Initialize in your project (auto-detects your AI tool)
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
         │ yuva agent       │  │ yuva agent       │
         │ orchestrate      │  │ show <name>      │
         │                  │  │                  │
         │ Scans project:   │  │ Returns full     │
         │ - existing code? │  │ agent prompt     │
         │ - language?      │  │ from package     │
         │ - framework?     │  │ on demand        │
         │ - git status?    │  │                  │
         └──────────────────┘  └──────────────────┘
                    │                   │
                    ▼                   ▼
         ┌──────────────────────────────────────────┐
         │          DEVELOPMENT AGENTS (12)          │
         ├──────────────────────────────────────────┤
         │ Existing Code │ Requirements │ Planner   │
         │ Execution     │ Tester       │ Reviewer  │
         │ Security      │ Debugger     │ Refactor  │
         │ Continuity    │ Risk         │ State Mgr │
         └──────────────────────────────────────────┘
```

## CLI Commands

```bash
# Setup
yuva init                  # Auto-detect AI tool and initialize
yuva init opencode         # Initialize for specific tool
yuva init cursor --force   # Reinitialize for different tool
yuva doctor                # Diagnose setup issues

# Agent Commands
yuva agent show <name>     # Get full agent prompt (on demand)
yuva agent list            # List all available agents
yuva agent orchestrate     # Scan project context (JSON output)

# List & Custom Agents
yuva list                  # List all installed agents
yuva add create <name>     # Create a custom agent
yuva add remove <name>     # Remove an agent

# Multi-LLM
yuva llm list              # List supported LLMs
yuva llm use <name>        # Switch LLM platform
yuva llm detect            # Detect current LLM
yuva llm generate          # Generate configs for all LLMs

# Configuration
yuva config                # Show current config
yuva config set <k> <v>    # Set a config value

# Session Persistence (auto-saves)
yuva session start "goal"  # Start tracking a session
yuva session log "message" # Log progress
yuva session resume        # Get full context (for AI or you)
yuva session status        # Show session state
yuva session end           # End current session

# Quality Gates (enforced, not advisory)
yuva gate                  # Run lint/typecheck/test/build — exits non-zero on failure
yuva gate list             # Show detected gates

# Loop Engine (autopilot — zero-touch plan→build→verify→replan)
yuva loop run "goal"       # Fully autonomous: AI plans, workers build, gates
                           #   verify, AI reviews & replans until the goal is done
yuva loop status           # Show loop state and task counts
yuva loop stop             # Signal the loop and all workers to stop

# Swarm (multi-terminal orchestrator/worker mode — the default for big tasks)
yuva swarm init            # Create the task bus (.yuva/)
yuva swarm plan "goal"     # Print the orchestrator planning brief
yuva swarm spawn           # AUTO-OPEN worker terminals in this project dir
                           #   (--roles executor,tester --cli claude --headless)
yuva swarm start           # Live dashboard + automatic verification
yuva task add "title" --role executor   # Add work to the bus
yuva worker next --role executor        # Claim a task in this terminal
yuva task done <id> --summary "..."     # Finish (gates run automatically)

# Analytics
yuva status                # Show project status
yuva help                  # Show full help
```

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
│   └── agents.md                   # Agent index
└── .cursor/rules/yuva.mdc         # (only if Cursor detected)
```

Agent prompts are served on demand from the installed package — **no file bloat**.

## Session Persistence

Never lose context between terminal sessions. Sessions **auto-save** after every yuva command — no manual save needed.

```bash
# Day 1 — Start working
yuva session start "Build user auth with JWT"
# ... work normally, run any yuva commands ...
# Session auto-saves git state, changed files, and context after each command

# Day 2 — Come back, new terminal
yuva session resume        # Full context: goal, decisions, files changed, activity log
# AI picks up exactly where you left off

# Log important progress
yuva session log "Added login endpoint" --type code
yuva session decision "Use bcrypt" "Industry standard for password hashing"

# When done
yuva session end
```

Session files are stored in `.session/` (auto-gitignored) and include:
- `session.json` — structured state for tools
- `context.md` — human/AI-readable context summary
- `log.md` — timestamped activity log
- `state.md` — current status overview

## Quality Gates — Enforcement, Not Suggestions

Checklists and standards only work if something *enforces* them. `yuva gate`
runs your project's **real** lint / typecheck / test / build commands and exits
non-zero when anything fails — so an AI can never claim work is "done" while
the build is broken.

Gates are auto-detected from `package.json` scripts (also Cargo, Go, and
Python projects), and can be overridden in `.aiautomations/config.json`:

```json
{ "gates": { "test": "npm run test:ci", "build": false, "e2e": "npm run e2e" } }
```

## Swarm Mode — Multi-Terminal Orchestrator/Workers

Run a whole AI team in parallel terminals. One **orchestrator** terminal
coordinates; each **worker** terminal takes one role (executor, tester,
reviewer, security, debugger). They coordinate through a zero-dependency,
crash-resumable file bus in `.yuva/`.

**Swarm is the default flow**: the generated AI configs instruct your AI to
use it for any multi-step task. `yuva swarm spawn` opens the worker terminals
automatically — every window starts in the **same project directory**, sharing
one codebase and one task bus (never a copy). Opt out with
`yuva config set mode solo`.

```
Terminal 1 (orchestrator)          Terminal 2..N (workers)
─────────────────────────          ───────────────────────
yuva swarm init                    yuva worker next --role executor
yuva swarm plan "build API"        # → prints the full work package:
yuva task add "..." --role ...     #   agent prompt + checklists +
yuva swarm start                   #   standards + gate protocol
# live dashboard: watches all      # do the work, then:
# workers, verifies every result   yuva task done <id> --summary "..."
# with quality gates               # gates MUST pass or it's rejected
```

**How enforcement works:**
1. Every claimed task ships as a **work package** — the role's agent prompt, required checklists, and code standards are delivered *with* the task. Workers can't skip them.
2. `yuva task done` runs all quality gates first. Gates fail → task stays claimed until fixed.
3. The orchestrator (`yuva swarm start`) re-verifies every completed task and bounces failures back to the queue **with the gate output as feedback** for the next attempt.
4. Tasks support dependencies (`--deps id1,id2`) — a review task can't start before its build task is verified.

Workers can also run fully headless with any LLM CLI:

```bash
yuva worker start --role tester --auto --cli "claude -p"
```

## Loop Engine — Zero-Touch Autopilot

The loop engine drives the whole swarm with **one command and no human in the
loop**. You give it a goal; it keeps cycling until the goal is verifiably done:

```bash
yuva loop run "add user authentication with tests"
```

```
        ┌─────────────────────────────────────────────┐
        │                                             │
        ▼                                             │
  0. PREFLIGHT verifies the AI CLI answers headlessly │
  1. PLAN      AI CLI breaks the goal into tasks      │
  2. EXECUTE   headless worker terminals claim them   │
  3. VERIFY    quality gates run on every completion  │
  4. ESCALATE  repeat failures → debugger tasks       │
  5. REVIEW    AI inspects the repo: goal achieved?   │
        │                                             │
        └──── not yet → new follow-up tasks ──────────┘
                     │
                     ▼ achieved
  6. REPORT    .yuva/report.md + workers shut down
```

**Human touchpoints removed:** no manual task breakdown (the AI planner emits
the task list), no manual worker startup (`swarm spawn --headless` runs
automatically), no manual re-planning (the AI reviewer proposes follow-up
tasks), and no manual shutdown (a `.yuva/stop` signal ends every worker).

**Safety rails, because autonomy needs brakes:**
- `--max-iterations <n>` (default 5) caps plan→review cycles — the loop hands
  back to you instead of spinning forever.
- `--max-attempts <n>` (default 3) caps retries per task before it is
  escalated to a high-priority debugger task.
- Quality gates stay mandatory — the AI cannot mark its own work done.
- `yuva loop stop` halts everything; state survives in `.yuva/loop.json`
  and the final summary lands in `.yuva/report.md`.
- Ctrl+C only detaches the orchestrator — workers keep going until stopped.

**Self-healing AI connection** — the loop never bets on a CLI that can't
answer:
- **Preflight** pings the AI CLI with a tiny JSON prompt before planning and
  diagnoses failures precisely: not installed, not logged in, timed out, or
  no headless support — each with the exact fix.
- **Automatic fallback** — with no `--cli` forced, the loop tries your
  configured tool first, then every other installed CLI (claude → gemini →
  codex → opencode → aider) until one passes. An explicit `--cli` is never
  silently switched.
- **Output self-repair** — unparseable AI replies are re-asked once with a
  strict JSON-only reminder before giving up.
- `yuva loop doctor` tests every installed CLI headlessly and reports which
  one the loop would use.

Works with any headless AI CLI (`--cli claude`, `--cli gemini`, ...); defaults
to your configured tool.

## Custom Agents

```bash
# Create a custom agent
yuva add create my-agent

# This creates a local override in:
# .aiautomations/prompts/my-agentagent.md

# Local agents always take priority over package agents
```

## Development

```bash
npm install
npm test
npm run test:coverage
npm run lint
npm run doctor
```

## Works With

**Commercial:** Claude Code, Cursor, Windsurf, GitHub Copilot, Gemini CLI, Amazon Q, Cody, Antigravity
**Open Source:** Ollama, LM Studio, Jan.ai, Continue.dev, Open Interpreter, LLM CLI, Tabby
**Terminal:** OpenCode, Codex CLI, Kilo Code, Aider
**Models:** Llama 3, Mistral, CodeLlama, DeepSeek, Qwen, Phi-3, GPT-4, Claude, Gemini

## FAQ

### How does the swarm connect to AI tools like Claude Code, agy, or Codex?

Through the shell — **text in, text out**. There is no API, no SDK, no server,
no socket. Any AI that can run shell commands can join:

1. The AI runs `yuva worker next --role <role>` in its terminal.
2. Yuva prints the **work package** (agent prompt + checklists + standards +
   task + gate rules) to stdout — that text lands directly in the AI's context.
3. The AI does the work with its own tools, then runs
   `yuva task done <id> --summary "..."` — gates run automatically.

For headless mode, yuva drives the AI instead: it pipes each work package into
any CLI via stdin (`yuva worker start --auto --cli "claude -p"`).

### Can I mix different AI systems in one swarm?

Yes — that's the point. Orchestrator in Claude Code, executor in Claude,
tester in agy, reviewer in Codex, all at once. The task bus stores only worker
IDs and roles, never vendors. Work packages are plain markdown every model can
read, and quality gates judge every result by the same standard regardless of
which AI produced it.

Mixed swarms are actually *stronger*: Codex reviewing code Claude wrote (or
vice versa) catches blind spots that same-model review misses. Run
`yuva init --all` once so every tool gets its native config file.

### Do the AIs talk to each other directly?

No. They collaborate through the `.yuva/` file bus and through the code itself:

- Verifying a task unlocks the tasks that `--deps` on it — whichever free
  worker matches the role picks it up next.
- When a result is rejected, the gate failure text is attached to the task, so
  the next AI that claims it (even a different vendor) sees
  **"Feedback from previous attempt (MUST address)"** in its work package.

### Why quality gates? Aren't the checklists and standards enough?

No — markdown is advisory, and LLMs drift. Checklists only work if something
*enforces* them. `yuva gate` runs your project's **real** lint/typecheck/test/
build commands and exits non-zero on failure, and `yuva task done` refuses to
complete a task while gates fail. Enforcement lives in the CLI's exit codes,
not in the model's discipline.

### What happens if a worker terminal crashes mid-task?

Nothing is lost. The bus is crash-resumable: headless workers that stop
heartbeating have their claimed tasks automatically released back to the queue
for another worker to pick up. Interactive workers are never auto-released
(long thinking time is normal) — the orchestrator dashboard just shows how
long the task has been claimed.

### Does swarm mode need an internet connection or API keys?

Yuva itself needs neither — the bus is local files, gates are local shell
commands, and yuva has zero dependencies. Your AI tools use whatever they
normally use (Claude Code needs its login, Ollama runs fully offline). A swarm
of Ollama workers works completely offline.

### Do I have to use swarm mode?

No. Single-terminal mode (agents + sessions + `yuva gate`) works exactly as
before. Swarm mode activates only when you create a bus with `yuva swarm init`.

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
