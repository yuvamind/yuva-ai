# Available Development Agents

| Name | Command | Purpose |
|------|---------|---------|
| Existing Code | `yuva agent show existingcode` | Analyze existing codebase before making changes |
| Requirements | `yuva agent show requirements` | Gather and clarify project requirements |
| Risk Assessment | `yuva agent show riskassessment` | Identify risks before development |
| Planner | `yuva agent show planning` | Design architecture and create implementation plans |
| Execution | `yuva agent show execution` | Implement code step-by-step following the plan |
| Continuity | `yuva agent show continuity` | Resume work from last session state |
| Tester | `yuva agent show tester` | Write and run tests, QA |
| Reviewer | `yuva agent show reviewer` | Code quality audits and review |
| Security | `yuva agent show security` | Security vulnerability analysis |
| Debugger | `yuva agent show debugger` | Bug investigation and fixing |
| Refactor | `yuva agent show refactor` | Code improvement and cleanup |
| State Manager | `yuva agent show statemanager` | Update session and project state files |

## Agent Files (in package)

These agents are read from the installed yuva-ai package. To see the full prompt for any agent, run the command above.

Custom agents can be added locally in `.yuva/prompts/` — local files always take priority over package agents.
