const path = require('path');
const { resolvePackagePath } = require('./resolve-package');
const { fileExists, readFile } = require('./fs-utils');
const { detectGates } = require('./gate-runner');
const { injectContext } = require('./prompt-engine');
const { analyzeCodebase, formatAnalysis } = require('./code-analyzer');
const { PromptEnforcer } = require('./prompt-enforcer');
const { NeuralGraph } = require('./neural-graph');

// Role → agent prompt + checklists + standards that are force-fed to the worker.
const ROLES = {
  executor: {
    agentFile: 'execution.md',
    checklists: ['beforecode.md', 'aftercode.md'],
    standards: ['codestandards.md'],
    description: 'Implement code step-by-step following the plan',
  },
  tester: {
    agentFile: 'testeragent.md',
    checklists: ['aftercode.md'],
    standards: [],
    description: 'Write and run tests, QA',
  },
  reviewer: {
    agentFile: 'revieweragent.md',
    checklists: ['prchecklist.md'],
    standards: ['codestandards.md'],
    description: 'Code quality audits and review',
  },
  security: {
    agentFile: 'securityagent.md',
    checklists: ['securitychecklist.md'],
    standards: [],
    description: 'Security vulnerability analysis',
  },
  debugger: {
    agentFile: 'debuggeragent.md',
    checklists: ['aftercode.md'],
    standards: [],
    description: 'Bug investigation and fixing',
  },
};

// Resolve a template file with the same precedence as `yuva agent show`:
// local .aiautomations override first, then the installed package.
function resolveTemplateFile(targetDir, subdir, fileName) {
  const localPath = path.join(targetDir, '.aiautomations', subdir, fileName);
  if (fileExists(localPath)) return readFile(localPath);

  const pkgPath = resolvePackagePath();
  if (!pkgPath) return null;
  const packagePath = path.join(pkgPath, 'template', '.aiautomations', subdir, fileName);
  return fileExists(packagePath) ? readFile(packagePath) : null;
}

/**
 * Build the complete, self-contained work package for a claimed task:
 * task details + role agent prompt + checklists + standards + gate list
 * + dynamic project context + code analysis + completion protocol.
 * The worker cannot "forget" to load its rules — they arrive with the task.
 */
function buildWorkPackage(task, targetDir) {
  const role = ROLES[task.role] || null;
  const gates = detectGates(targetDir);
  const lines = [];

  lines.push(`# Work Package — Task ${task.id}`);
  lines.push('');
  lines.push(`## Task`);
  lines.push(`- **Title:** ${task.title}`);
  lines.push(`- **Role:** ${task.role}`);
  lines.push(`- **Attempt:** ${task.attempts}`);
  if (task.description) {
    lines.push('', '### Description', task.description);
  }
  if (task.feedback) {
    lines.push('', '### Feedback from previous attempt (MUST address)', task.feedback);
  }
  lines.push('');

  // Inject dynamic project context
  try {
    const { prompt: contextPrompt } = injectContext('{{CONTEXT}}', targetDir, {
      TASK_ID: task.id,
      TASK_TITLE: task.title,
      TASK_ROLE: task.role,
    });
    lines.push('---', '', contextPrompt, '');

    // Also inject code analysis for executor/reviewer/debugger roles
    if (['executor', 'reviewer', 'debugger', 'tester'].includes(task.role)) {
      try {
        const analysis = analyzeCodebase(targetDir);
        const analysisBlock = formatAnalysis(analysis);
        if (analysisBlock) {
          lines.push('---', '', analysisBlock, '');
        }
      } catch {}
    }

    // Inject neural graph context (token-efficient — only relevant subgraph)
    try {
      const graph = new NeuralGraph(targetDir);
      if (graph.load()) {
        const graphCtx = graph.getContextForTask(task.title, task.description || '');
        if (graphCtx.nodes.size > 0) {
          lines.push('---', '', '### Neural Graph Context (relevant code relationships)', '');
          lines.push(graphCtx.summary);
          lines.push('', `> Graph context: ${graphCtx.nodes.size} nodes, ~${graphCtx.tokens} tokens (instead of full codebase dump)`, '');
        }
      }
    } catch {}
  } catch {}

  if (role) {
    const agentPrompt = resolveTemplateFile(targetDir, 'prompts', role.agentFile);
    if (agentPrompt) {
      // Inject dynamic context into the agent prompt itself
      const { prompt: enrichedPrompt } = injectContext(agentPrompt, targetDir, {
        TASK_ID: task.id,
        TASK_TITLE: task.title,
        TASK_ROLE: task.role,
      });
      lines.push('---', '', `## Your Agent Instructions (${task.role})`, '', enrichedPrompt.trim(), '');
    }

    for (const checklist of role.checklists) {
      const content = resolveTemplateFile(targetDir, 'checklists', checklist);
      if (content) {
        lines.push('---', '', `## Required Checklist: ${checklist}`, '', content.trim(), '');
      }
    }

    for (const standard of role.standards) {
      const content = resolveTemplateFile(targetDir, 'standards', standard);
      if (content) {
        lines.push('---', '', `## Required Standard: ${standard}`, '', content.trim(), '');
      }
    }
  }

  // Inject enforcement rules (machine-verified, not advisory)
  try {
    const enforcer = new PromptEnforcer(targetDir);
    const enforcementSection = enforcer.buildEnforcementSection(task, gates);
    lines.push('---', '', enforcementSection);
  } catch {}

  lines.push('---', '', '## Completion Protocol (MANDATORY)');
  if (gates.length > 0) {
    lines.push('', 'Quality gates for this project (all must pass):');
    for (const gate of gates) {
      lines.push(`- **${gate.name}**: \`${gate.command}\``);
    }
  }
  lines.push('');
  lines.push('When your work is finished, run:');
  lines.push('```bash');
  lines.push(`yuva task done ${task.id} --summary "what you did"`);
  lines.push('```');
  lines.push('This runs all quality gates automatically. If any gate fails, the task');
  lines.push('stays claimed by you — fix the failures and run it again.');
  lines.push('If you are blocked, run:');
  lines.push('```bash');
  lines.push(`yuva task fail ${task.id} --reason "why you are blocked"`);
  lines.push('```');
  lines.push('Do NOT declare the task complete in any other way.');
  lines.push('');
  lines.push('### PROTECTED FILES — NEVER delete, move, or empty these:');
  lines.push('`.yuva/`, `.session/`, `.aiautomations/`, `AGENTS.md`, `CLAUDE.md`,');
  lines.push('`GEMINI.md`, `.claude/`, `.cursor/`, and any other AI config files.');
  lines.push('Never run `yuva swarm clear` or `yuva session clear`. These belong to');
  lines.push('the orchestration system, not to your task. Work ONLY inside the');
  lines.push('current project directory — never another path or a copy.');
  lines.push('');

  return lines.join('\n');
}

module.exports = { buildWorkPackage, ROLES, resolveTemplateFile };
