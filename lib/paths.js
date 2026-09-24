const fs = require('fs');
const path = require('path');

/**
 * Single source of truth for every Yuva directory.
 *
 * Layout (v2.2+):
 *   .yuva/            COMMITTED project config — travels with the repo
 *     config.json     tool/model/gate configuration
 *     agents.md       agent index
 *     prompts/        agent prompt files
 *     templates/      planning templates
 *     protocols/      collaboration protocols
 *     standards/      code standards
 *     checklists/     pre/post-code checklists
 *     gates/          user-authored plugin gates
 *     run/            GITIGNORED runtime state (see below)
 *
 *   .yuva/run/        runtime — regenerated, never committed
 *     tasks/          task records + .claim locks
 *     workers/        worker registrations + heartbeats
 *     file-locks/     per-file conflict locks
 *     session/        session state/log/next
 *     graph/          neural graph cache
 *     events.log      append-only JSONL event stream
 *     stop            swarm stop signal
 *     loop.json       loop engine state
 *     report.md       loop final report
 *     telemetry.json  usage counters
 *
 * Legacy layouts stay readable (writes always go to the new location):
 *   .aiautomations/<x>  -> .yuva/<x>
 *   .yuva/<runtime>     -> .yuva/run/<runtime>
 *   .session/           -> .yuva/run/session/
 */

const CONFIG_DIR = '.yuva';
const RUN_DIR = 'run';
const LEGACY_CONFIG_DIR = '.aiautomations';

/** Committed config entries, relative to .yuva/ */
const CONFIG_ENTRIES = [
  'config.json',
  'agents.md',
  'prompts',
  'templates',
  'protocols',
  'standards',
  'checklists',
  'gates',
];

/** Runtime entries, relative to .yuva/run/ */
const RUNTIME_ENTRIES = [
  'tasks',
  'workers',
  'file-locks',
  'session',
  'graph',
  'events.log',
  'events.log.old',
  'stop',
  'loop.json',
  'report.md',
  'telemetry.json',
  'costs.json',
];

const GITIGNORE_ENTRY = '\n# Yuva AI runtime state (task bus, sessions, caches)\n.yuva/run/\n';

// -- Base directories ---------------------------------------------

/** `<target>/.yuva` — committed config root. */
function configDir(targetDir) {
  return path.join(targetDir, CONFIG_DIR);
}

/** `<target>/.yuva/run` — gitignored runtime root. */
function runDir(targetDir) {
  return path.join(targetDir, CONFIG_DIR, RUN_DIR);
}

/** `<target>/.aiautomations` — pre-2.2 config root, read-only. */
function legacyConfigDir(targetDir) {
  return path.join(targetDir, LEGACY_CONFIG_DIR);
}

// -- Resolution ---------------------------------------------------

/**
 * Resolve a committed-config path for READING. Prefers the new location and
 * falls back to `.aiautomations/` when only the legacy file exists, so
 * projects that have not run `yuva upgrade` keep working untouched.
 */
function resolveConfig(targetDir, ...rel) {
  const current = path.join(targetDir, CONFIG_DIR, ...rel);
  if (fs.existsSync(current)) return current;
  const legacy = path.join(targetDir, LEGACY_CONFIG_DIR, ...rel);
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

/**
 * Resolve a runtime path for READING. Prefers `.yuva/run/` and falls back to
 * the flat `.yuva/` layout used before runtime and config were separated.
 */
function resolveRun(targetDir, ...rel) {
  const current = path.join(targetDir, CONFIG_DIR, RUN_DIR, ...rel);
  if (fs.existsSync(current)) return current;
  if (rel.length > 0) {
    const legacy = path.join(targetDir, CONFIG_DIR, ...rel);
    if (fs.existsSync(legacy)) return legacy;
  }
  return current;
}

/** Committed-config path for WRITING — always the new location. */
function configPath(targetDir, ...rel) {
  return path.join(targetDir, CONFIG_DIR, ...rel);
}

/** Runtime path for WRITING — always the new location. */
function runPath(targetDir, ...rel) {
  return path.join(targetDir, CONFIG_DIR, RUN_DIR, ...rel);
}

// -- Named accessors (read-resolved) ------------------------------

const configFile = (d) => resolveConfig(d, 'config.json');
const agentsIndex = (d) => resolveConfig(d, 'agents.md');
const promptsDir = (d) => resolveConfig(d, 'prompts');
const templatesDir = (d) => resolveConfig(d, 'templates');
const protocolsDir = (d) => resolveConfig(d, 'protocols');
const standardsDir = (d) => resolveConfig(d, 'standards');
const checklistsDir = (d) => resolveConfig(d, 'checklists');
const gatesDir = (d) => resolveConfig(d, 'gates');
const agentConfigDir = (d) => resolveConfig(d, 'agents');

const tasksDir = (d) => resolveRun(d, 'tasks');
const workersDir = (d) => resolveRun(d, 'workers');
const fileLocksDir = (d) => resolveRun(d, 'file-locks');
const sessionDir = (d) => resolveRun(d, 'session');
const graphDir = (d) => resolveRun(d, 'graph');
const eventsFile = (d) => resolveRun(d, 'events.log');
const stopFile = (d) => resolveRun(d, 'stop');
const loopStateFile = (d) => resolveRun(d, 'loop.json');
const reportFile = (d) => resolveRun(d, 'report.md');
const telemetryFile = (d) => resolveRun(d, 'telemetry.json');

// -- Detection ----------------------------------------------------

/** True when the project has Yuva config in either layout. */
function isInitialized(targetDir) {
  return fs.existsSync(path.join(targetDir, CONFIG_DIR)) ||
    fs.existsSync(path.join(targetDir, LEGACY_CONFIG_DIR));
}

/** True when a pre-2.2 `.aiautomations/` directory is present. */
function hasLegacyConfig(targetDir) {
  return fs.existsSync(path.join(targetDir, LEGACY_CONFIG_DIR));
}

/** True when runtime state still sits flat in `.yuva/` instead of `.yuva/run/`. */
function hasLegacyRuntime(targetDir) {
  return RUNTIME_ENTRIES.some(e => fs.existsSync(path.join(targetDir, CONFIG_DIR, e)));
}

/** True when a legacy layout is present and `yuva upgrade` has work to do. */
function needsMigration(targetDir) {
  return hasLegacyConfig(targetDir) || hasLegacyRuntime(targetDir) ||
    fs.existsSync(path.join(targetDir, '.session'));
}

// -- Migration ----------------------------------------------------

/** Move `src` to `dest` unless `dest` already exists. Returns true when moved. */
function _move(src, dest) {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch {
    // Cross-device or locked — fall back to copy + delete
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
  return true;
}

/**
 * Migrate any legacy layout into `.yuva/` + `.yuva/run/`.
 * Idempotent, and never overwrites a file that already exists at the target.
 * Returns the moves performed, as `from -> to` strings.
 */
function migrate(targetDir) {
  const moved = [];

  // 1. Runtime out of the flat .yuva/ root, before config lands on top of it
  for (const entry of RUNTIME_ENTRIES) {
    const from = path.join(targetDir, CONFIG_DIR, entry);
    const to = path.join(targetDir, CONFIG_DIR, RUN_DIR, entry);
    if (_move(from, to)) moved.push(`.yuva/${entry} -> .yuva/run/${entry}`);
  }

  // 2. Legacy .session/ into the runtime session dir
  if (_move(path.join(targetDir, '.session'), path.join(targetDir, CONFIG_DIR, RUN_DIR, 'session'))) {
    moved.push('.session/ -> .yuva/run/session/');
  }

  // 3. Committed config out of .aiautomations/
  if (hasLegacyConfig(targetDir)) {
    const legacyRoot = path.join(targetDir, LEGACY_CONFIG_DIR);
    let entries = [];
    try {
      entries = fs.readdirSync(legacyRoot);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      // telemetry.json is runtime data that used to live beside the config
      const isRuntime = RUNTIME_ENTRIES.includes(entry);
      const to = isRuntime
        ? path.join(targetDir, CONFIG_DIR, RUN_DIR, entry)
        : path.join(targetDir, CONFIG_DIR, entry);
      if (_move(path.join(legacyRoot, entry), to)) {
        moved.push(`.aiautomations/${entry} -> ${isRuntime ? '.yuva/run' : '.yuva'}/${entry}`);
      }
    }

    // Remove the legacy root only once it is genuinely empty
    try {
      if (fs.readdirSync(legacyRoot).length === 0) {
        fs.rmdirSync(legacyRoot);
        moved.push('removed empty .aiautomations/');
      }
    } catch { /* leftover files — leave the directory in place */ }
  }

  return moved;
}

/**
 * Ensure `.gitignore` excludes `.yuva/run/` and no longer excludes all of
 * `.yuva/` — the config half is meant to be committed.
 * Returns true when the file was changed.
 */
function ensureGitignore(targetDir) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  let content = '';
  try {
    content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  } catch {
    return false;
  }

  const lines = content.split(/\r?\n/);
  // Drop blanket .yuva ignores left over from the runtime-only layout
  const stale = new Set(['.yuva/', '.yuva', '/.yuva/', '/.yuva']);
  const kept = lines.filter(l => !stale.has(l.trim()));
  let changed = kept.length !== lines.length;

  let next = kept.join('\n');
  if (!kept.some(l => l.trim() === '.yuva/run/')) {
    next = next.replace(/\s*$/, '') + GITIGNORE_ENTRY;
    changed = true;
  }

  if (changed) {
    try {
      fs.writeFileSync(gitignorePath, next);
    } catch {
      return false;
    }
  }
  return changed;
}

module.exports = {
  CONFIG_DIR, RUN_DIR, LEGACY_CONFIG_DIR, CONFIG_ENTRIES, RUNTIME_ENTRIES, GITIGNORE_ENTRY,
  configDir, runDir, legacyConfigDir,
  resolveConfig, resolveRun, configPath, runPath,
  configFile, agentsIndex, promptsDir, templatesDir, protocolsDir, standardsDir,
  checklistsDir, gatesDir, agentConfigDir,
  tasksDir, workersDir, fileLocksDir, sessionDir, graphDir, eventsFile, stopFile,
  loopStateFile, reportFile, telemetryFile,
  isInitialized, hasLegacyConfig, hasLegacyRuntime, needsMigration,
  migrate, ensureGitignore,
};
