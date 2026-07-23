const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { runGates, detectGates } = require('./gate-runner');
const { ROLES } = require('./work-package');


const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INTERVAL_MS = 5 * 1000;
const AI_TIMEOUT_MS = 15 * 60 * 1000;

const VALID_ROLES = new Set([...Object.keys(ROLES), 'any']);

/** Append print-mode flag unless the command already has one (claude/gemini style). */
function ensurePrintMode(cli) {
  return /(^|\s)-p(\s|$)/.test(cli) ? cli : `${cli} -p`;
}

/**
 * Pull the first parseable JSON object out of an AI response — tolerates
 * markdown fences and prose around the JSON.
 */
function extractJSON(text) {
  if (!text || typeof text !== 'string') return null;
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }
  return null;
}

/**
 * Validate the planner/reviewer task list. Accepts {tasks:[...]} or a bare
 * array. Drops entries without a title, coerces unknown roles to 'any', and
 * keeps only backward deps (0-based indices into the same list) so the
 * result is always a valid DAG in creation order.
 */
function normalizePlannedTasks(parsed) {
  const raw = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.tasks)) ? parsed.tasks : [];

  const indexMap = new Map(); // planner's index → normalized index
  const tasks = [];
  raw.forEach((t, rawIndex) => {
    if (!t || typeof t.title !== 'string' || !t.title.trim()) return;
    indexMap.set(rawIndex, tasks.length);
    tasks.push({
      title: t.title.trim().slice(0, 200),
      description: typeof t.description === 'string' ? t.description : '',
      role: VALID_ROLES.has(t.role) ? t.role : 'any',
      priority: Number(t.priority) || 0,
      rawDeps: Array.isArray(t.deps) ? t.deps : [],
    });
  });
  tasks.forEach((task, i) => {
    task.deps = task.rawDeps
      .map(d => indexMap.get(d))
      .filter(d => Number.isInteger(d) && d < i);
    delete task.rawDeps;
  });
  return tasks;
}

function normalizeReview(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return {
    goalAchieved: parsed.goalAchieved === true,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    tasks: normalizePlannedTasks(parsed.tasks),
  };
}

function buildPlanPrompt(goal, targetDir) {
  const roleList = Object.entries(ROLES).map(([n, r]) => `- ${n}: ${r.description}`).join('\n');
  const gates = detectGates(targetDir);
  const gateList = gates.length
    ? gates.map(g => `- ${g.name}: ${g.command}`).join('\n')
    : '- none detected';

  return `You are the PLANNER of an autonomous multi-agent engineering loop.
You are running inside the target repository — inspect it as needed.

## Goal
${goal}

## Instructions
Break the goal into small, independently verifiable engineering tasks.
- Keep each task scoped to roughly one file or one feature slice.
- Order tasks so dependencies come first; "deps" are 0-based indices into your own tasks array and may only point backwards.
- For each meaningful feature, add a tester task and a reviewer task that depend on the executor task.
- Each "description" must contain everything a fresh AI worker needs — file paths, expected behavior, edge cases. Workers see ONLY their task.
- Quality gates run automatically when a worker finishes a task:
${gateList}

Available roles:
${roleList}

## Output format (STRICT)
Respond with ONLY a JSON object — no prose, no markdown fences:
{"tasks":[{"title":"...","description":"detailed instructions for the worker","role":"executor","deps":[],"priority":0}]}
`;
}

function buildReviewPrompt(goal, iteration, maxIterations, tasks) {
  const verified = tasks.filter(t => t.status === 'verified');
  const failed = tasks.filter(t => t.status === 'failed');
  const lines = [];
  lines.push('You are the REVIEWER of an autonomous multi-agent engineering loop.');
  lines.push('You are running inside the target repository — inspect the actual code and verify claims.');
  lines.push('', '## Goal', goal);
  lines.push('', `## Iteration ${iteration} of ${maxIterations} just finished`);
  lines.push('', '## Verified tasks');
  lines.push(verified.length
    ? verified.map(t => `- [${t.id}] ${t.title} — ${t.summary || 'no summary'}`).join('\n')
    : '- none');
  lines.push('', '## Failed / abandoned tasks');
  lines.push(failed.length
    ? failed.map(t => `- [${t.id}] ${t.title} — ${(t.feedback || 'no details').slice(0, 300)}`).join('\n')
    : '- none');
  lines.push('', '## Your job');
  lines.push('Decide whether the GOAL is fully achieved in the repository as it stands.');
  lines.push('- Achieved → "goalAchieved": true, empty tasks array.');
  lines.push('- Not achieved → propose the SMALLEST set of follow-up tasks that closes the gap (same schema as the planner; deps are 0-based indices into YOUR tasks array, backwards only).');
  lines.push('- If something failed for a reason no AI worker can fix (missing credentials, human decision needed), do NOT re-propose it — explain in "reason" instead.');
  lines.push('', '## Output format (STRICT)');
  lines.push('Respond with ONLY a JSON object — no prose, no markdown fences:');
  lines.push('{"goalAchieved":false,"reason":"...","tasks":[{"title":"...","description":"...","role":"executor","deps":[],"priority":0}]}');
  return lines.join('\n');
}

/**
 * Run a prompt through a headless AI CLI (piped via stdin, stdout captured).
 * Never rejects: resolves { code, stdout, stderr, error }.
 */
function runPrompt(cliCommand, prompt, { cwd = process.cwd(), timeoutMs = AI_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const child = spawn(cliCommand, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd,
    });

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ code: 1, stdout, stderr, error: `AI CLI timed out after ${Math.round(timeoutMs / 60000)} minutes` });
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ code: 1, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, stdout, stderr, error: code === 0 ? null : (stderr.trim().slice(-500) || `exit code ${code}`) });
    });
    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Verify tasks in 'done' state. Gates are project-wide, so one gate run
 * covers the current tree: pass → all done tasks become verified; fail →
 * the most recently completed task (likely culprit) is rejected with the
 * gate output as feedback, the rest stay queued for the next pass.
 */
function verifyDoneTasks(bus, targetDir) {
  const done = bus.listTasks({ status: 'done' });
  if (done.length === 0) return [];

  const result = runGates(targetDir);
  const messages = [];

  if (result.passed) {
    for (const task of done) {
      bus.verifyTask(task.id, { gate: { passed: true, at: new Date().toISOString() } });
      messages.push({ passed: true, message: `verified [${task.id}] ${task.title}` });
    }
  } else {
    const failures = result.gates.filter(g => g.status === 'failed')
      .map(g => `${g.name} failed:\n${g.output || ''}`).join('\n---\n');
    done.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
    const culprit = done[0];
    bus.rejectTask(culprit.id, `orchestrator verification failed:\n${failures}`.slice(0, 3000));
    messages.push({ passed: false, message: `rejected [${culprit.id}] ${culprit.title} — gates failing, sent back with feedback` });
  }

  return messages;
}

/**
 * The autonomous loop: plan → execute → verify → escalate → review → replan,
 * until the goal is achieved, the AI has nothing left to propose, or the
 * iteration budget runs out. State lives in .yuva/loop.json (crash-resumable),
 * the final report in .yuva/report.md.
 */
class LoopEngine {
  constructor(bus, targetDir, options = {}) {
    this.bus = bus;
    this.targetDir = targetDir;
    this.options = {
      cli: 'claude -p',
      maxIterations: DEFAULT_MAX_ITERATIONS,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      intervalMs: DEFAULT_INTERVAL_MS,
      timeoutMs: AI_TIMEOUT_MS,
      ...options,
    };
    this.stateFile = path.join(bus.busDir, 'loop.json');
  }

  loadState() {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    } catch {
      return null;
    }
  }

  saveState(patch) {
    const state = { ...(this.loadState() || {}), ...patch, updatedAt: new Date().toISOString() };
    this.bus.init();
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2) + '\n');
    return state;
  }

  /**
   * Ask the AI CLI for a JSON answer. Retries once with a strict reminder
   * when the reply is unparseable — headless CLIs are stateless, but the
   * reminder reliably fixes prose-wrapped or fenced answers.
   */
  async ask(prompt, { retries = 1 } = {}) {
    const run = this.options.runPrompt || runPrompt;
    let currentPrompt = prompt;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await run(this.options.cli, currentPrompt, {
        cwd: this.targetDir,
        timeoutMs: this.options.timeoutMs,
      });
      const parsed = extractJSON(result.stdout);
      if (parsed) return parsed;
      this.bus.logEvent('loop.ai_error', {
        attempt: attempt + 1,
        error: (result.error || 'no parseable JSON in output').slice(0, 500),
      });
      currentPrompt = `${prompt}\n\nREMINDER: Your previous reply could not be parsed. Respond with ONLY the raw JSON object described above — no prose, no markdown fences, nothing else.`;
    }
    return null;
  }

  /** Add planner tasks to the bus, mapping index-based deps to real task ids. */
  addPlannedTasks(planned) {
    const created = [];
    for (const t of planned) {
      const deps = (t.deps || []).map(i => created[i] && created[i].id).filter(Boolean);
      created.push(this.bus.addTask({
        title: t.title,
        description: t.description,
        role: t.role,
        deps,
        priority: t.priority,
      }));
    }
    return created;
  }

  async plan(goal) {
    this.saveState({
      goal,
      status: 'planning',
      iteration: 1,
      startedAt: new Date().toISOString(),
      cli: this.options.cli,
    });
    this.bus.logEvent('loop.plan', { goal });
    const parsed = await this.ask(buildPlanPrompt(goal, this.targetDir));
    return this.addPlannedTasks(normalizePlannedTasks(parsed));
  }

  /**
   * Tasks bounced back too many times stop blocking the loop: mark them
   * failed and hand the wreckage to a debugger task (unless the debugger
   * itself was the one failing — then the review phase decides).
   */
  escalate() {
    const messages = [];
    for (const task of this.bus.listTasks({ status: 'pending' })) {
      if (task.attempts < this.options.maxAttempts) continue;
      this.bus.failTask(task.id, `escalated after ${task.attempts} failed attempts. Last feedback:\n${task.feedback || 'none'}`.slice(0, 3000));
      messages.push(`escalated [${task.id}] ${task.title} — ${task.attempts} attempts exhausted`);
      if (task.role !== 'debugger') {
        const fix = this.bus.addTask({
          title: `Debug & fix: ${task.title}`.slice(0, 200),
          description: `Original task [${task.id}] (role: ${task.role}) failed ${task.attempts} times.\n\nOriginal description:\n${task.description || 'none'}\n\nLast feedback:\n${task.feedback || 'none'}`,
          role: 'debugger',
          priority: 10,
        });
        messages.push(`created debugger task [${fix.id}] for [${task.id}]`);
      }
    }
    return messages;
  }

  async review(goal, iteration) {
    this.saveState({ status: 'reviewing' });
    this.bus.logEvent('loop.review', { iteration });
    const parsed = await this.ask(buildReviewPrompt(goal, iteration, this.options.maxIterations, this.bus.listTasks()));
    return normalizeReview(parsed);
  }

  /**
   * Monitor the bus until every task is terminal, then run the AI review.
   * Repeats with the review's follow-up tasks until done / stuck / budget.
   * onEvent(level, message) receives progress lines for display.
   */
  async run(goal, { onEvent = () => {} } = {}) {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let iteration = (this.loadState() || {}).iteration || 1;
    let lastLine = '';
    this.saveState({ status: 'running' });

    while (true) {
      if (this.bus.stopRequested()) {
        return { done: false, reason: 'stop requested (yuva loop stop)', iterations: iteration };
      }

      this.bus.releaseStale();
      for (const m of verifyDoneTasks(this.bus, this.targetDir)) {
        onEvent(m.passed ? 'success' : 'error', m.message);
      }
      for (const m of this.escalate()) onEvent('warn', m);

      const s = this.bus.getStatusSummary();
      const line = `iteration ${iteration}/${this.options.maxIterations} — ${s.counts.pending} pending, ${s.counts.claimed} in progress, ${s.counts.done} awaiting verify, ${s.counts.verified} verified, ${s.counts.failed} failed`;
      if (line !== lastLine) {
        onEvent('info', line);
        lastLine = line;
      }

      const active = s.counts.pending + s.counts.claimed + s.counts.done;
      if (s.total > 0 && active === 0) {
        onEvent('info', `Iteration ${iteration} finished — asking the AI to review the goal...`);
        const review = await this.review(goal, iteration);
        if (!review) {
          return { done: false, reason: 'review failed — AI unreachable or returned unparseable output', iterations: iteration };
        }
        if (review.goalAchieved) {
          return { done: true, reason: review.reason || 'AI review: goal achieved', iterations: iteration };
        }
        if (review.tasks.length === 0) {
          return { done: false, reason: review.reason || 'AI review: goal not achieved, but no follow-up tasks proposed — human input needed', iterations: iteration };
        }
        if (iteration >= this.options.maxIterations) {
          return { done: false, reason: `iteration budget (${this.options.maxIterations}) exhausted — human review needed`, iterations: iteration };
        }
        iteration++;
        this.saveState({ iteration, status: 'running' });
        const added = this.addPlannedTasks(review.tasks);
        onEvent('info', `Iteration ${iteration}: added ${added.length} follow-up task(s) — workers will pick them up.`);
      }

      await sleep(this.options.intervalMs);
    }
  }

  /** Write .yuva/report.md and mark the loop state terminal. */
  writeReport(goal, result) {
    const tasks = this.bus.listTasks();
    const lines = [
      '# Yuva Loop Report',
      '',
      `- **Goal:** ${goal}`,
      `- **Outcome:** ${result.done ? 'GOAL ACHIEVED' : 'STOPPED'} — ${result.reason}`,
      `- **Iterations:** ${result.iterations}`,
      `- **Finished:** ${new Date().toISOString()}`,
      '',
      '## Tasks',
      '',
    ];
    for (const t of tasks) {
      lines.push(`- [${t.status === 'verified' ? 'x' : ' '}] \`${t.id}\` (${t.role}, ${t.status}) ${t.title}${t.summary ? ` — ${t.summary}` : ''}`);
    }
    const file = path.join(this.bus.busDir, 'report.md');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    this.saveState({ status: result.done ? 'complete' : 'stopped', result });
    return file;
  }
}

module.exports = {
  LoopEngine,
  extractJSON,
  normalizePlannedTasks,
  normalizeReview,
  buildPlanPrompt,
  buildReviewPrompt,
  runPrompt,
  ensurePrintMode,
  verifyDoneTasks,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_MAX_ATTEMPTS,
};
