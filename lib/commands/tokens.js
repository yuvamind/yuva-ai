const { log, box, success, error, warn, info, table, colorize } = require('../colors');
const { TaskBus } = require('../task-bus');
const { buildWorkPackage, ROLES } = require('../work-package');
const { parseFlags } = require('../arg-utils');
const {
  profileWorkPackage, projectRunCost, costOf, estimateTokens,
} = require('../token-budget');

// Input rate per million tokens, for projecting a swarm run. Output tokens are
// not projected — yuva controls what it SENDS, not what the model writes back.
const DEFAULT_INPUT_RATE = 5.0;

const RATES = {
  'claude-opus-5': 5.0,
  'claude-sonnet-5': 2.0,
  'claude-haiku-4-5': 1.0,
};

function showTokensHelp() {
  box('Yuva AI - Token Optimizer');
  log('Profile what your swarm SENDS, and what it costs.\n', 'dim');
  log('Usage:', 'bright');
  log('  yuva tokens profile           Token profile of a work package per role');
  log('  yuva tokens project           Project input cost for the current task bus');
  log('  yuva tokens doctor            Find cache-breakers in the frozen prefix\n');
  log('Options:', 'bright');
  log('  --role <name>     Profile one role (default: every role with tasks)');
  log('  --attempts <n>    Attempts per task to assume in projections (default 2)');
  log(`  --rate <usd>      Input $/million tokens (default ${DEFAULT_INPUT_RATE})\n`);
  log('Why ordering matters:', 'bright');
  log('  Prompt caching is a prefix match — one differing byte invalidates', 'dim');
  log('  every cached token after it. Yuva emits a frozen prefix (agent rules,', 'dim');
  log('  enforcement, protocol) before anything task-specific so the prefix', 'dim');
  log('  can be reused across every task in a run.\n', 'dim');
}

/** A representative task for a role — profiling must not mutate the bus. */
function sampleTask(bus, role) {
  const real = bus.exists()
    ? bus.listTasks().find(t => t.role === role)
    : null;
  if (real) return real;
  return {
    id: 'sample000000',
    title: 'Representative task for profiling',
    description: 'Used only to render a work package; nothing is claimed.',
    role,
    attempts: 1,
    feedback: null,
  };
}

function rolesInPlay(bus, flags) {
  if (flags.role && flags.role !== true) return [String(flags.role)];
  const fromBus = bus.exists()
    ? [...new Set(bus.listTasks().map(t => t.role).filter(r => ROLES[r]))]
    : [];
  return fromBus.length ? fromBus : ['executor'];
}

function printProfile(role, profile) {
  log(`\n${role}`, 'bright');
  table(
    ['Zone', 'Tokens', 'Share', 'Cacheable'],
    [
      ['frozen', profile.byZone.frozen, pct(profile.byZone.frozen, profile.total), 'yes — reused every task'],
      ['volatile', profile.byZone.volatile, pct(profile.byZone.volatile, profile.total), 'only until a commit lands'],
      ['task', profile.byZone.task, pct(profile.byZone.task, profile.total), 'no — unique per task'],
    ]
  );
  log(`  total ${profile.total} tokens · cacheable prefix ${(100 * profile.cacheableRatio).toFixed(1)}%`, 'dim');

  if (!profile.orderedForCaching) {
    error('  Task content appears BEFORE frozen content — the prefix cannot cache.');
  }
  for (const breaker of profile.breakers) {
    warn(`  cache-breaker in prefix: ${breaker.id} — ${breaker.message}`);
    log(`    found: ${breaker.sample}`, 'dim');
  }
}

const pct = (n, total) => (total > 0 ? `${((100 * n) / total).toFixed(1)}%` : '0%');

function tokensProfile(bus, flags, targetDir) {
  box('Yuva AI - Token Profile');
  const roles = rolesInPlay(bus, flags);
  for (const role of roles) {
    if (!ROLES[role]) {
      error(`Unknown role: ${role}. Valid roles: ${Object.keys(ROLES).join(', ')}`);
      continue;
    }
    const pkg = buildWorkPackage(sampleTask(bus, role), targetDir);
    printProfile(role, profileWorkPackage(pkg));
  }
  log('');
  info('Project a full run with: yuva tokens project');
}

function tokensProject(bus, flags, targetDir) {
  box('Yuva AI - Projected Input Cost');

  if (!bus.exists() || bus.listTasks().length === 0) {
    warn('No tasks in the bus — nothing to project.');
    info('Add tasks first, or profile a single package with: yuva tokens profile');
    return;
  }

  const tasks = bus.listTasks();
  const roles = [...new Set(tasks.map(t => t.role).filter(r => ROLES[r]))];
  const attempts = Number(flags.attempts) || 2;
  const rate = Number(flags.rate) || RATES[flags.model] || DEFAULT_INPUT_RATE;

  // Weight the profile by the actual task mix rather than assuming one role.
  let totalUncached = 0;
  let totalCached = 0;
  const rows = [];

  for (const role of roles) {
    const roleTasks = tasks.filter(t => t.role === role);
    const profile = profileWorkPackage(buildWorkPackage(sampleTask(bus, role), targetDir));
    const projection = projectRunCost(profile, {
      tasks: roleTasks.length, roles: 1, attempts,
    });
    totalUncached += projection.uncachedTotal;
    totalCached += projection.cachedTotal;
    rows.push([
      role,
      roleTasks.length,
      profile.total,
      projection.uncachedTotal.toLocaleString(),
      projection.cachedTotal.toLocaleString(),
      `${(100 * projection.savedRatio).toFixed(0)}%`,
    ]);
  }

  table(['Role', 'Tasks', 'Pkg tokens', 'No cache', 'Cached', 'Saved'], rows);

  const saved = totalUncached - totalCached;
  const savedPct = totalUncached > 0 ? (100 * saved) / totalUncached : 0;

  log('');
  log(`  Assuming ${attempts} attempt(s) per task at $${rate}/M input tokens:`, 'dim');
  log(`  without a cacheable prefix: ${totalUncached.toLocaleString()} tokens = ` +
    colorize(`$${costOf(totalUncached, rate).toFixed(3)}`, 'red'));
  log(`  with a cacheable prefix:    ${totalCached.toLocaleString()} tokens = ` +
    colorize(`$${costOf(totalCached, rate).toFixed(3)}`, 'green'));
  success(`  saved ${saved.toLocaleString()} tokens (${savedPct.toFixed(1)}%)`);
  log('');
  log('  Projection, not a bill: it assumes the downstream CLI caches the', 'dim');
  log('  prefix yuva makes cacheable, and estimates tokens at ~4 chars each.', 'dim');
  log('  Read real numbers from your provider\'s usage report.', 'dim');
}

function tokensDoctor(bus, flags, targetDir) {
  box('Yuva AI - Token Doctor');
  const roles = rolesInPlay(bus, flags);
  let problems = 0;

  for (const role of roles) {
    if (!ROLES[role]) continue;
    const profile = profileWorkPackage(buildWorkPackage(sampleTask(bus, role), targetDir));

    if (!profile.orderedForCaching) {
      error(`${role}: task content precedes frozen content — prefix cannot cache`);
      problems++;
    }
    for (const breaker of profile.breakers) {
      error(`${role}: ${breaker.id} in frozen prefix — ${breaker.message}`);
      log(`    ${breaker.sample}`, 'dim');
      problems++;
    }
    if (profile.cacheableRatio < 0.3) {
      warn(`${role}: only ${(100 * profile.cacheableRatio).toFixed(1)}% of the package is frozen — little to cache`);
      problems++;
    }
    if (profile.total > 20000) {
      warn(`${role}: package is ${profile.total} tokens — consider trimming project context`);
      problems++;
    }
  }

  log('');
  if (problems === 0) {
    success('No cache-breakers found. The frozen prefix is stable across tasks.');
  } else {
    warn(`${problems} issue(s) found.`);
  }
}

function tokensCommand(args = []) {
  const { positional, flags } = parseFlags(args, { booleans: [] });
  const targetDir = process.cwd();
  const bus = new TaskBus(targetDir);

  switch (positional[0]) {
    case 'profile':
      return tokensProfile(bus, flags, targetDir);
    case 'project':
      return tokensProject(bus, flags, targetDir);
    case 'doctor':
      return tokensDoctor(bus, flags, targetDir);
    default:
      return showTokensHelp();
  }
}

module.exports = tokensCommand;
module.exports.estimateTokens = estimateTokens;
module.exports.RATES = RATES;
