# Available Development Agents

| Name | Command | Purpose |
|------|---------|---------|
| Existing Code | `yuva agent show existingcode` | Analyze existing codebase before making changes |
| Requirements | `yuva agent show requirements` | Gather and clarify project requirements |
| Risk Assessment | `yuva agent show riskassessment` | Identify risks before development |
| Design | `yuva agent show design` | Make design decisions, emit design system + tokens |
| Planner | `yuva agent show planning` | Design architecture and create implementation plans |
| Execution | `yuva agent show execution` | Implement code step-by-step following the plan |
| Continuity | `yuva agent show continuity` | Resume work from last session state |
| Tester | `yuva agent show tester` | Write and run tests, QA |
| E2E | `yuva agent show e2e` | Agent-driven behaviour tests: keyboard, focus, five states |
| Visual QA | `yuva agent show visualqa` | Screenshot the UI and audit it visually |
| Reviewer | `yuva agent show reviewer` | Code quality audits and review |
| Security | `yuva agent show security` | Security vulnerability analysis |
| Debugger | `yuva agent show debugger` | Bug investigation and fixing |
| Refactor | `yuva agent show refactor` | Code improvement and cleanup |
| State Manager | `yuva agent show statemanager` | Update session and project state files |

## Agent Files (in package)

These agents are read from the installed yuva-ai package. To see the full prompt for any agent, run the command above.

Custom agents can be added locally in `.yuva/prompts/` — local files always take priority over package agents.

## Frontend chain

For any work that produces UI, the order matters — design decisions made during
implementation get made as framework defaults, which is what generic UI is:

```
EXISTING CODE -> Requirements -> Risk -> DESIGN -> Planner -> Execution
             -> Tester -> Security -> Reviewer -> E2E -> VISUAL QA -> ship
```

Every agent has a place. The three that are easy to leave out, and why they are in:

- **Existing Code runs first** on a live repo. Design cannot choose a token
  system without knowing the framework, CSS strategy, SSR model, existing
  component library, browser floor and performance budget. Existing Code writes
  those to `docs/architecture-constraints.md`. Greenfield projects get a stack
  decision from the Planner instead; either way Design never assumes React.
- **Tester, Security and Reviewer run before Visual QA**, not after. Visual QA
  drives the real app with a keyboard, so it wants an app that already compiles,
  passes its tests and has no obvious vulnerability. Reviewing appearance on top
  of broken behaviour wastes the expensive pass.
- **E2E runs before Visual QA.** It proves the app can be *operated* — keyboard
  only, focus restored after a dialog closes, every data state reachable. Visual
  QA then judges how it looks. Those three checks are exactly what
  `componentcontracts.md` section 13 used to leave to a human.
- **State Manager runs throughout**, not at a position: it keeps
  `.yuva/run/session/` current so any step can be resumed.

### The revision loops

A chain with no way back makes the first brief into frozen authority even when it
produces a bad interface. There are two return paths, and they are different:

```
Visual QA finds an IMPLEMENTATION defect
  -> Execution fixes it
  -> Visual QA re-runs
  (the normal loop; most findings are these)

Visual QA finds the FOUNDATION is wrong
  -> DESIGN revises the brief, the tokens or the contract
  -> Planner updates the plan if the architecture is affected
  -> Execution re-implements
  -> Visual QA re-runs
  (the expensive loop; use it when the defect is in the decision, not the code)
```

**Which loop applies.** It is a foundation problem, not an implementation
problem, when: the accent fails contrast on its own background; the density
contradicts the data volume in product brief P6; a contract demands behaviour the
chosen framework cannot express; the signature detail conflicts with
accessibility; or the token system has no name for something the product needs.
Those cannot be fixed in a component, and trying is how you get nine greys.

**Escalation.** If the same finding survives two round-trips, stop looping and
escalate to the user with both positions stated. Two agents disagreeing about
taste will not converge by repetition, and a third pass costs more than a
question. Record the outcome under Rejected Alternatives either way.

- **Design** writes `docs/product-brief.md` (who, what job, what is dangerous),
  then `docs/design-brief.md`, then the Tier 0/1 contracts in
  `docs/components/`, then `src/styles/tokens.css` - in that order, before any
  component exists. Rules: `.yuva/standards/designsystem.md` (taste) and
  `.yuva/standards/componentcontracts.md` (behaviour).
- **Visual QA** runs `yuva gate visual`, which boots the app, screenshots every
  route at every viewport, and audits the rendered result. It is the only gate
  that can fail because something looks wrong — lint, typecheck, test and build
  all pass on UI that looks terrible.
