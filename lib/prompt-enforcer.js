const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Prompt Enforcer — validates that AI output actually matches what the
 * agent prompt required. This is the bridge between "just markdown" and
 * real enforcement.
 *
 * Three enforcement points:
 * 1. PRE-FLIGHT: Verify the AI understands the task before it starts
 * 2. MID-TASK: Validate intermediate outputs at checkpoints
 * 3. POST-TASK: Validate final output against all requirements
 */

// Protected files that NO agent should ever modify
const PROTECTED_PATTERNS = [
  /^\.yuva\//,
  /^\.session\//,
  /^\.aiautomations\//,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /^GEMINI\.md$/,
  /^\.claude\//,
  /^\.cursor\//,
  /^\.windsurfrules$/,
  /^\.github\/copilot-instructions\.md$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
];

// Files that are always safe to modify (whitelist)
const SAFE_PATTERNS = [
  /^src\//,
  /^lib\//,
  /^app\//,
  /^pages\//,
  /^components\//,
  /^api\//,
  /^test\//,
  /^tests\//,
  /^__tests__\//,
  /^spec\//,
  /^e2e\//,
  /\.(js|ts|jsx|tsx|py|go|rs|java|rb|php|dart|css|scss|html|md|json|yaml|yml|toml)$/,
];

class PromptEnforcer {
  constructor(targetDir, options = {}) {
    this.targetDir = targetDir;
    this.strictMode = options.strict !== false; // default: strict
    this.maxScopeViolations = options.maxScopeViolations || 3;
  }

  /**
   * PRE-FLIGHT CHECK
   * Generate a comprehension verification prompt that the AI must answer
   * correctly before being allowed to work. This ensures the AI actually
   * read and understood the work package.
   */
  buildPreFlightPrompt(task, workPackageSnippet) {
    return `You are about to work on a task. Before you start, answer these verification questions.

TASK: ${task.title}
ROLE: ${task.role}

Answer with ONLY this JSON object (no prose):
{
  "understood": true,
  "taskSummary": "<one sentence: what you will do>",
  "filesYouWillTouch": ["<list the files you expect to modify>"],
  "filesYouWillNOTTouch": ["<list files you must NOT modify>"],
  "qualityGatesYouWillRun": ["<list the gate commands>"],
  "estimatedSteps": <number>,
  "risksOrBlockers": ["<anything that might go wrong>"]
}

If you cannot answer these questions, set "understood" to false and explain why in "risksOrBlockers".

CONSTRAINTS:
- You MUST NOT modify any file under .yuva/, .session/, .aiautomations/
- You MUST NOT modify AGENTS.md, CLAUDE.md, GEMINI.md
- You MUST NOT modify package-lock.json, yarn.lock, pnpm-lock.yaml
- You MUST NOT modify .claude/, .cursor/ or any AI config directory
- You MUST run quality gates before declaring work complete
- You MUST stay within the task scope — do not refactor unrelated code`;
  }

  /**
   * Validate a pre-flight response from the AI.
   * Returns { valid, violations, warnings }.
   */
  validatePreFlight(response, task) {
    const violations = [];
    const warnings = [];

    if (!response || typeof response !== 'object') {
      return { valid: false, violations: ['AI did not return valid JSON'], warnings };
    }

    if (response.understood !== true) {
      return { valid: false, violations: ['AI indicated it does not understand the task'], warnings };
    }

    // Check that the AI listed files it will touch
    if (!Array.isArray(response.filesYouWillTouch) || response.filesYouWillTouch.length === 0) {
      warnings.push('AI did not list specific files it will modify — scope enforcement weakened');
    }

    // Check that protected files are in the NOT-touch list
    if (Array.isArray(response.filesYouWillTouch)) {
      for (const file of response.filesYouWillTouch) {
        if (this._isProtected(file)) {
          violations.push(`AI plans to modify protected file: ${file}`);
        }
      }
    }

    // Check that the AI listed quality gates
    if (!Array.isArray(response.qualityGatesYouWillRun) || response.qualityGatesYouWillRun.length === 0) {
      warnings.push('AI did not list quality gates — it may skip verification');
    }

    return {
      valid: violations.length === 0,
      violations,
      warnings,
      plan: response,
    };
  }

  /**
   * POST-TASK VALIDATION
   * After the AI finishes, validate that its actual changes match what
   * was required and don't violate any constraints.
   */
  validatePostTask(task, preFlightPlan) {
    const violations = [];
    const warnings = [];

    // 1. Get actual files changed via git
    const changedFiles = this._getChangedFiles();

    // 2. Check for protected file violations
    for (const file of changedFiles) {
      if (this._isProtected(file)) {
        violations.push(`CRITICAL: Protected file was modified: ${file}`);
      }
    }

    // 3. Check scope — if the AI listed files it would touch, verify
    //    it didn't touch significantly more
    if (preFlightPlan && Array.isArray(preFlightPlan.filesYouWillTouch)) {
      const plannedFiles = new Set(preFlightPlan.filesYouWillTouch.map(f => f.replace(/\\/g, '/')));
      const unplannedChanges = changedFiles.filter(f => !plannedFiles.has(f));

      // Allow some unplanned changes (session files, generated files) but flag large scope creep
      const significantUnplanned = unplannedChanges.filter(f =>
        !f.startsWith('.yuva/') && !f.startsWith('.session/') &&
        !f.endsWith('.log') && !f.endsWith('.lock')
      );

      if (significantUnplanned.length > this.maxScopeViolations) {
        violations.push(
          `Scope creep: AI modified ${significantUnplanned.length} files not in its plan: ${significantUnplanned.slice(0, 5).join(', ')}`
        );
      } else if (significantUnplanned.length > 0) {
        warnings.push(
          `AI modified ${significantUnplanned.length} unplanned files: ${significantUnplanned.join(', ')}`
        );
      }
    }

    // 4. Check that actual changes are in safe directories
    for (const file of changedFiles) {
      if (!this._isProtected(file) && !this._isSafe(file) && !file.startsWith('.')) {
        warnings.push(`File outside typical source dirs was modified: ${file}`);
      }
    }

    // 5. Check git status for any staged but uncommitted changes
    const gitStatus = this._getGitStatus();
    if (gitStatus.dirty && gitStatus.staged.length > 0) {
      warnings.push(`Staged but uncommitted changes: ${gitStatus.staged.slice(0, 3).join(', ')}`);
    }

    return {
      valid: violations.length === 0,
      violations,
      warnings,
      changedFiles,
      summary: {
        totalChanged: changedFiles.length,
        protectedViolations: violations.filter(v => v.includes('Protected')).length,
        scopeViolations: violations.filter(v => v.includes('Scope')).length,
      },
    };
  }

  /**
   * BUILD ENFORCEMENT SECTION for work packages.
   * This is injected into every work package to make constraints explicit
   * and machine-verifiable.
   */
  buildEnforcementSection(task, gates) {
    const lines = [];
    lines.push('## ⚠️ ENFORCEMENT RULES (machine-verified, not advisory)');
    lines.push('');
    lines.push('These rules are ENFORCED by the system. Violations will REJECT your work.');
    lines.push('');
    lines.push('### 1. Protected Files (NEVER modify)');
    lines.push('The following files/directories are OFF LIMITS:');
    lines.push('- `.yuva/` — orchestration state');
    lines.push('- `.session/` — session files');
    lines.push('- `.aiautomations/` — agent configs');
    lines.push('- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` — AI configs');
    lines.push('- `.claude/`, `.cursor/`, `.windsurfrules` — tool configs');
    lines.push('- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` — lock files');
    lines.push('');
    lines.push('If you modify ANY of these, your task will be REJECTED automatically.');
    lines.push('');

    lines.push('### 2. Scope Enforcement');
    lines.push('Before you start coding, you MUST declare which files you will modify.');
    lines.push('If you modify more than 3 files not in your declaration, your task will be flagged.');
    lines.push('Do NOT refactor code unrelated to your task.');
    lines.push('');

    lines.push('### 3. Quality Gates (MANDATORY)');
    lines.push('You MUST run these before declaring work complete:');
    for (const gate of gates) {
      lines.push(`- \`${gate.command}\` (${gate.name})`);
    }
    lines.push('');
    lines.push('Run: `yuva task done ' + task.id + ' --summary "what you did"`');
    lines.push('If gates fail, FIX the failures and run it again. Do NOT skip gates.');
    lines.push('');

    lines.push('### 4. Required Output Format');
    lines.push('When you start, output a brief plan as a comment in the first file you touch:');
    lines.push('```');
    lines.push('// YUVA PLAN: <what you will do>');
    lines.push('// FILES: <file1>, <file2>, ...');
    lines.push('// GATES: <which gates you will run>');
    lines.push('```');
    lines.push('This is used to verify scope compliance.');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Validate that a task completion meets all enforcement requirements.
   * This is the master check called by the orchestrator.
   */
  validateCompletion(task, preFlightPlan) {
    const postValidation = this.validatePostTask(task, preFlightPlan);

    return {
      ...postValidation,
      enforcementSummary: postValidation.valid
        ? '✅ All enforcement checks passed'
        : `❌ ${postValidation.violations.length} violation(s) found: ${postValidation.violations.join('; ')}`,
    };
  }

  // ── Internal helpers ────────────────────────────────────────────

  _isProtected(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return PROTECTED_PATTERNS.some(p => p.test(normalized));
  }

  _isSafe(filePath) {
    const normalized = filePath.replace(/\\/g, '/');
    return SAFE_PATTERNS.some(p => p.test(normalized));
  }

  _getChangedFiles() {
    try {
      const output = execSync('git diff --name-only HEAD', {
        cwd: this.targetDir,
        encoding: 'utf8',
        timeout: 10000,
      }).trim();
      return output ? output.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  _getGitStatus() {
    try {
      const output = execSync('git status --porcelain', {
        cwd: this.targetDir,
        encoding: 'utf8',
        timeout: 10000,
      }).trim();
      const lines = output ? output.split('\n').filter(Boolean) : [];
      return {
        dirty: lines.length > 0,
        staged: lines.filter(l => l[0] !== ' ' && l[0] !== '?').map(l => l.slice(3)),
        unstaged: lines.filter(l => l[1] !== ' ').map(l => l.slice(3)),
      };
    } catch {
      return { dirty: false, staged: [], unstaged: [] };
    }
  }
}

/**
 * Format enforcement results for display.
 */
function formatEnforcementResult(result) {
  const lines = [];
  lines.push('## Enforcement Check');
  lines.push('');

  if (result.valid) {
    lines.push('✅ All enforcement checks passed.');
  } else {
    lines.push('❌ ENFORCEMENT VIOLATIONS:');
    for (const v of result.violations) {
      lines.push(`  - ${v}`);
    }
  }

  if (result.warnings && result.warnings.length > 0) {
    lines.push('');
    lines.push('⚠️ Warnings:');
    for (const w of result.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  if (result.summary) {
    lines.push('');
    lines.push(`Files changed: ${result.summary.totalChanged}`);
    lines.push(`Protected violations: ${result.summary.protectedViolations}`);
    lines.push(`Scope violations: ${result.summary.scopeViolations}`);
  }

  return lines.join('\n');
}

module.exports = { PromptEnforcer, formatEnforcementResult, PROTECTED_PATTERNS };
