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
Requirements -> Risk -> DESIGN -> Planner -> Execution -> VISUAL QA
```

- **Design** writes `docs/product-brief.md` (who, what job, what is dangerous),
  then `docs/design-brief.md`, then the Tier 0/1 contracts in
  `docs/components/`, then `src/styles/tokens.css` - in that order, before any
  component exists. Rules: `.yuva/standards/designsystem.md` (taste) and
  `.yuva/standards/componentcontracts.md` (behaviour).
- **Visual QA** runs `yuva gate visual`, which boots the app, screenshots every
  route at every viewport, and audits the rendered result. It is the only gate
  that can fail because something looks wrong — lint, typecheck, test and build
  all pass on UI that looks terrible.
