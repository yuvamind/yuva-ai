const path = require('path');
const { resolvePackagePath } = require('./resolve-package');
const { fileExists, readFile } = require('./fs-utils');
const { detectGates } = require('./gate-runner');
const { injectContext } = require('./prompt-engine');
const { analyzeCodebase, formatAnalysis } = require('./code-analyzer');
const { PromptEnforcer } = require('./prompt-enforcer');
const { NeuralGraph } = require('./neural-graph');
const { debug } = require('./debug');
const P = require('./paths');

// Role → agent prompt that is force-fed to the worker.
const ROLES = {
  executor: {
    agentFile: 'execution.md',
    description: 'Implement code step-by-step following the plan',
  },
  tester: {
    agentFile: 'testeragent.md',
    description: 'Write and run tests, QA',
  },
  reviewer: {
    agentFile: 'revieweragent.md',
    description: 'Code quality audits and review',
  },
  security: {
    agentFile: 'securityagent.md',
    description: 'Security vulnerability analysis',
  },
  debugger: {
    agentFile: 'debuggeragent.md',
    description: 'Bug investigation and fixing',
  },
};

// Resolve a template file with the same precedence as `yuva agent show`:
// local .yuva override first (falling back to a legacy .aiautomations
// override), then the installed package.
function resolveTemplateFile(targetDir, subdir, fileName) {
  const localPath = path.join(P.resolveConfig(targetDir, subdir), fileName);
  if (fileExists(localPath)) return readFile(localPath);

  const pkgPath = resolvePackagePath();
  if (!pkgPath) return null;
  const packagePath = path.join(pkgPath, 'template', '.yuva', subdir, fileName);
  return fileExists(packagePath) ? readFile(packagePath) : null;
}

/**
 * Build the complete, self-contained work package for a claimed task:
 * task details + role agent prompt + gate list
 * + dynamic project context + code analysis + completion protocol.
 * The worker cannot "forget" to load its rules — they arrive with the task.
 */
function buildWorkPackage(task, targetDir) {
  const role = ROLES[task.role] || null;
  const gates = detectGates(targetDir);
  const lines = [];

  // ---------------------------------------------------------------
  // ZONE 1 - FROZEN. Byte-identical for every task sharing this role
  // in this project, so it can form a cacheable prefix. Nothing that
  // varies per task, per attempt, or per commit may appear here.
  // ---------------------------------------------------------------
  lines.push(`# Yuva Work Package - ${task.role} worker`);
  lines.push('');
  lines.push('Read the whole package. Your specific task is at the END, after the');
  lines.push('project state - everything before it is standing instruction.');
  lines.push('');

  if (role) {
    const agentPrompt = resolveTemplateFile(targetDir, 'prompts', role.agentFile);
    if (agentPrompt) {
      // {{CONTEXT}} expands to live git state, which changes as tasks land.
      // Expanding it here would make the frozen zone volatile and destroy the
      // cache prefix, so point at the project-state section instead.
      const staticPrompt = agentPrompt.replace(
        /\{\{CONTEXT\}\}/g,
        '(see the Project State section below)'
      );
      lines.push('---', '', `## Your Agent Instructions (${task.role})`, '', staticPrompt.trim(), '');
    }
  }

  // Enforcement rules are role- and project-scoped, never task-scoped.
  try {
    const enforcer = new PromptEnforcer(targetDir);
    lines.push('---', '', enforcer.buildEnforcementSection(task, gates));
  } catch (err) { debug('work-package', 'enforcement section failed', err); }

  lines.push('---', '', '## Completion Protocol (MANDATORY)');
  if (gates.length > 0) {
    lines.push('', 'Quality gates for this project (all must pass):');
    for (const gate of gates) {
      lines.push(`- **${gate.name}**: \`${gate.command}\``);
    }
  }
  lines.push('');
  lines.push('When your work is finished, run the `yuva task done` command given');
  lines.push('with your task below. It runs all quality gates automatically. If any');
  lines.push('gate fails, the task stays claimed by you - fix the failures and run it');
  lines.push('again. If you are blocked, run the `yuva task fail` command instead.');
  lines.push('Do NOT declare the task complete in any other way.');
  lines.push('');
  lines.push('### PROTECTED FILES - NEVER delete, move, or empty these:');
  lines.push('`.yuva/`, `.session/`, `.aiautomations/`, `AGENTS.md`, `CLAUDE.md`,');
  lines.push('`GEMINI.md`, `.claude/`, `.cursor/`, and any other AI config files.');
  lines.push('Never run `yuva swarm clear` or `yuva session clear`. These belong to');
  lines.push('the orchestration system, not to your task. Work ONLY inside the');
  lines.push('current project directory - never another path or a copy.');
  lines.push('');

  // ---------------------------------------------------------------
  // ZONE 2 - VOLATILE. Same for all tasks at a moment in time, but it
  // moves as commits land. Kept after the frozen zone so it can never
  // invalidate it, and before the task so the task stays last.
  // ---------------------------------------------------------------
  try {
    const { prompt: contextPrompt } = injectContext('{{CONTEXT}}', targetDir, {
      TASK_ID: task.id,
      TASK_TITLE: task.title,
      TASK_ROLE: task.role,
    });
    lines.push('---', '', contextPrompt, '');

    if (['executor', 'reviewer', 'debugger', 'tester'].includes(task.role)) {
      try {
        const analysisBlock = formatAnalysis(analyzeCodebase(targetDir));
        if (analysisBlock) lines.push('---', '', analysisBlock, '');
      } catch { /* analysis is best-effort context */ }
    }
  } catch (err) { debug('work-package', 'project context failed', err); }

  // ---------------------------------------------------------------
  // ZONE 3 - TASK. Unique per task and per attempt. Last, so that
  // everything above it stays a stable prefix - and so the actual
  // instruction is the most recent thing the model reads.
  // ---------------------------------------------------------------
  lines.push('---', '');
  lines.push(`## YOUR TASK - ${task.id}`);
  lines.push(`- **Title:** ${task.title}`);
  lines.push(`- **Role:** ${task.role}`);
  lines.push(`- **Attempt:** ${task.attempts}`);
  if (task.description) {
    lines.push('', '### Description', task.description);
  }
  if (task.feedback) {
    lines.push('', '### Feedback from previous attempt (MUST address)', task.feedback);
  }

  // Graph context is selected from the task text, so it belongs to the task.
  try {
    const graph = new NeuralGraph(targetDir);
    if (graph.load()) {
      const graphCtx = graph.getContextForTask(task.title, task.description || '');
      if (graphCtx.nodes.size > 0) {
        lines.push('', '### Neural Graph Context (relevant code relationships)', '');
        lines.push(graphCtx.summary);
        lines.push('', `> Graph context: ${graphCtx.nodes.size} nodes, ~${graphCtx.tokens} tokens (instead of full codebase dump)`, '');
      }
    }
  } catch (err) { debug('work-package', 'graph context failed', err); }

  lines.push('');
  lines.push('### Finish with');
  lines.push('```bash');
  lines.push(`yuva task done ${task.id} --summary "what you did"`);
  lines.push('```');
  lines.push('If you are blocked:');
  lines.push('```bash');
  lines.push(`yuva task fail ${task.id} --reason "why you are blocked"`);
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

module.exports = { buildWorkPackage, ROLES, resolveTemplateFile };
