/**
 * Token budgeting and cost profiling for work packages.
 *
 * Prompt caching is a PREFIX MATCH: one differing byte invalidates every
 * cached token after it. A work package therefore has three zones, and they
 * must be emitted in this order for any of it to cache:
 *
 *   1. FROZEN   — agent instructions, enforcement rules, gates, protocol.
 *                 Identical for every task sharing a role in a project.
 *   2. VOLATILE — git branch/status/commits, codebase analysis. Same for all
 *                 tasks at a moment in time, but changes as work lands.
 *   3. TASK     — id, title, description, feedback, graph context. Unique.
 *
 * Emitting TASK first (the pre-2.3 layout) guarantees a 0% hit rate on
 * everything behind it, which in a measured package was 96.8% of the tokens.
 */

const ZONES = ['frozen', 'volatile', 'task'];

// Rough English-text ratio. Deliberately a heuristic: counting exactly means
// an API round trip per section, and every caller here wants a ratio, not an
// invoice. Real billing numbers come from the CLI's own usage reporting.
const CHARS_PER_TOKEN = 4;

/** Approximate token count for a string. */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

/**
 * Content that changes between otherwise-identical requests and therefore
 * silently destroys the cache prefix it sits in.
 */
const CACHE_BREAKERS = [
  {
    id: 'task-id',
    pattern: /Task\s+[0-9a-f]{8,}/,
    message: 'task id — unique per task, invalidates everything after it',
  },
  {
    id: 'timestamp',
    pattern: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    message: 'ISO timestamp — changes on every build',
  },
  {
    id: 'git-status',
    pattern: /\*\*?(?:Git )?Status:?\*\*?\s*(?:clean|dirty)/i,
    message: 'git status — flips as tasks land',
  },
  {
    id: 'git-branch',
    pattern: /yuva\/worker-[\w-]+/,
    message: 'git isolation branch — unique per task',
  },
  {
    id: 'attempt-counter',
    pattern: /\*\*Attempt:\*\*\s*\d+/,
    message: 'attempt counter — changes on retry',
  },
];

/**
 * Scan a would-be cache prefix for content that cannot be stable.
 * Returns one finding per distinct breaker found.
 */
function findCacheBreakers(prefixText) {
  const findings = [];
  for (const breaker of CACHE_BREAKERS) {
    const match = String(prefixText || '').match(breaker.pattern);
    if (match) {
      findings.push({
        id: breaker.id,
        message: breaker.message,
        sample: match[0].slice(0, 60),
      });
    }
  }
  return findings;
}

/**
 * Split a rendered work package into its `---`-delimited sections and label
 * each with the zone it belongs to, inferred from its heading.
 */
function profileSections(workPackage) {
  const parts = String(workPackage || '').split(/^---$/m);
  return parts.map((body, index) => {
    const heading = (body.trim().split('\n')[0] || '').replace(/^#+\s*/, '').trim();
    return {
      index,
      heading: heading.slice(0, 80),
      tokens: estimateTokens(body),
      zone: zoneForHeading(heading),
    };
  }).filter(s => s.tokens > 0);
}

/** Classify a section by its heading. Unknown headings are treated as task-scoped. */
function zoneForHeading(heading) {
  const h = heading.toLowerCase();
  // The package banner names the role, never the task — it is part of the
  // frozen prefix. `yuva work package - <role> worker`
  if (/^yuva work package\b/.test(h)) return 'frozen';
  if (h.includes('agent instructions') || h.includes('enforcement') ||
      h.includes('completion protocol') || h.includes('protected files') ||
      h.includes('quality gates')) {
    return 'frozen';
  }
  if (h.includes('project context') || h.includes('codebase analysis') ||
      h.includes('tech stack')) {
    return 'volatile';
  }
  return 'task';
}

/**
 * Profile one work package: tokens per zone and the cacheable fraction.
 */
function profileWorkPackage(workPackage) {
  const sections = profileSections(workPackage);
  const byZone = { frozen: 0, volatile: 0, task: 0 };
  for (const section of sections) byZone[section.zone] += section.tokens;

  const total = byZone.frozen + byZone.volatile + byZone.task;
  return {
    sections,
    byZone,
    total,
    // Only the frozen zone is reliably cacheable across a whole swarm run;
    // the volatile zone caches only between tasks that land no commits.
    cacheableTokens: byZone.frozen,
    cacheableRatio: total > 0 ? byZone.frozen / total : 0,
    orderedForCaching: isOrderedForCaching(sections),
    breakers: findCacheBreakers(frozenPrefix(sections, workPackage)),
  };
}

/** True when every frozen section precedes every task-scoped one. */
function isOrderedForCaching(sections) {
  const lastFrozen = sections.reduce((acc, s, i) => (s.zone === 'frozen' ? i : acc), -1);
  const firstTask = sections.findIndex(s => s.zone === 'task');
  if (lastFrozen === -1 || firstTask === -1) return true;
  return lastFrozen < firstTask;
}

/** The text that would form the cache prefix under the current ordering. */
function frozenPrefix(sections, workPackage) {
  const parts = String(workPackage || '').split(/^---$/m);
  const lastFrozen = sections.reduce((acc, s) => (s.zone === 'frozen' ? s.index : acc), -1);
  if (lastFrozen === -1) return '';
  return parts.slice(0, lastFrozen + 1).join('---');
}

/**
 * Project the input-token cost of running a set of tasks, with and without a
 * cacheable prefix.
 *
 * Cache multipliers follow Anthropic's published structure: a write costs
 * 1.25x a normal input token (5-minute TTL) and a read costs 0.1x. One cold
 * write happens per distinct frozen prefix — in practice, per role.
 */
function projectRunCost(profile, { tasks = 1, roles = 1, attempts = 1 } = {}) {
  const invocations = Math.max(1, tasks * attempts);
  const distinctPrefixes = Math.min(Math.max(1, roles), invocations);

  const uncachedTotal = invocations * profile.total;

  const perInvocationVariable = profile.total - profile.cacheableTokens;
  const cachedTotal =
    distinctPrefixes * profile.cacheableTokens * 1.25 +
    (invocations - distinctPrefixes) * profile.cacheableTokens * 0.1 +
    invocations * perInvocationVariable;

  const saved = uncachedTotal - cachedTotal;
  return {
    invocations,
    distinctPrefixes,
    uncachedTotal: Math.round(uncachedTotal),
    cachedTotal: Math.round(cachedTotal),
    savedTokens: Math.round(saved),
    savedRatio: uncachedTotal > 0 ? saved / uncachedTotal : 0,
  };
}

/** Dollar cost for a token count at a given per-million input rate. */
function costOf(tokens, ratePerMillion) {
  return (tokens / 1_000_000) * ratePerMillion;
}

module.exports = {
  ZONES, CHARS_PER_TOKEN, CACHE_BREAKERS,
  estimateTokens, findCacheBreakers, profileSections, zoneForHeading,
  profileWorkPackage, isOrderedForCaching, projectRunCost, costOf,
};
