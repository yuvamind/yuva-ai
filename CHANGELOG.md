# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
