# Yuva AI - Development Agent System

You have access to a multi-agent development system. Use the CLI commands below to access specialized agents on demand.

---

## How to handle any request

1. **Scan the project first**: Run `yuva agent orchestrate` to get project context (existing code, language, framework, git status)
2. **Read the result**: The JSON output tells you the project state and suggests which agent to start with
3. **Get agent instructions**: Run `yuva agent show <name>` to load the full prompt for any agent
4. **Follow the agent**: Execute the agent's instructions completely before moving to the next one

This applies even to greetings: when the user's FIRST message is just "hey" / "hi" / "what's up", run `yuva agent orchestrate` and reply with a short status — what this project is, whether there's an active session to resume, and 2-3 suggested next actions as a numbered list to pick from.

---

## How to ask the user questions

NEVER ask open-ended questions when options are possible. Every question MUST offer 2-4 concrete options with ONE marked "(Recommended)" plus a one-line reason, so the user can answer with just a number:

```
1. Which database?
   A) PostgreSQL (Recommended — relational data, free, scales well)
   B) MongoDB (better if your data is document-shaped)
   C) SQLite (simplest, fine for single-user apps)
```

Always end with: "Reply with your choices (e.g. 1A 2B) — or say 'go with your recommendations' and I'll proceed with all recommended options."
If the user says "go with your recommendations", proceed immediately with all recommended options — do not re-ask.

---

## Agent Selection Guide

### Step 1: Project Context Check
Always run `yuva agent orchestrate` first. If it reports `hasExistingCode: true`, run `yuva agent show existingcode` BEFORE any other agent.

### Step 2: Match User Intent

| User wants to... | Agent chain |
|-------------------|-------------|
| Build something new | `requirements` → `riskassessment` → `planning` → `execution` |
| Continue previous work | `continuity` → (resume from last point) |
| Fix a bug / error | `debugger` |
| Write tests | `tester` |
| Review code quality | `reviewer` |
| Check security | `security` |
| Clean up / improve code | `refactor` |

### Step 3: Execute agents in order
For each agent in the chain, run `yuva agent show <name>` and follow its instructions completely before moving to the next agent.

---

## Available Commands

```
yuva agent show <name>       # Get full agent instructions
yuva agent list              # List all available agents
yuva agent orchestrate       # Scan project and get context
```

---

## Rules

1. **Always run orchestrate first** — understand the project before acting
2. **If existing code exists** — run existingcode agent before anything else
3. **One agent at a time** — complete each agent's instructions before the next
4. **Update session** — after any meaningful work, run `yuva agent show statemanager` to update `.session/` files
