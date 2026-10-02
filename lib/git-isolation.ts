import { execFileSync } from 'child_process';

/**
 * Git branch isolation for workers.
 * Each worker gets its own branch; changes are merged only after gates pass.
 * Failed tasks get their branch discarded (rollback).
 */

/**
 * Outcome of a _gitSafe() call. `output` is present when ok, `error` when not --
 * expressed as one interface with both optional rather than a discriminated
 * union, because callers test `result.ok` and then read `result.output` with a
 * truthiness guard, exactly as the original JavaScript did.
 */
export interface GitResult {
  ok: boolean;
  output?: string;
  error?: string;
  /** Set by mergeToMain when the merge was aborted due to a conflict. */
  conflict?: boolean;
}

/** What the caller's work callback reports back to isolateTask(). */
export interface WorkResult {
  success: boolean;
  summary?: string | null;
  error?: string | null;
  [key: string]: unknown;
}

/** What isolateTask() reports to ITS caller, including rollback bookkeeping. */
export interface IsolationOutcome {
  success: boolean;
  summary?: string | null;
  error?: string | null;
  rolledBack?: boolean;
  branch?: string | null;
  [key: string]: unknown;
}

class GitIsolation {
  targetDir: string;

  constructor(targetDir: string) {
    this.targetDir = targetDir;
  }

  /**
   * Run `git <args>`. Uses execFileSync (no shell) so commit messages,
   * branch names, etc. never need manual quoting/escaping — they're passed
   * straight through to the git process as an argv array. (A previous
   * version built a shell command string with POSIX-style single-quote
   * escaping via execSync; that's broken on Windows, where the default
   * shell is cmd.exe and doesn't treat single quotes as a quoting
   * mechanism at all — every commit/merge/stash call silently mis-parsed
   * its message argument.)
   */
  _git(args: string[]): string {
    try {
      return execFileSync('git', args, {
        cwd: this.targetDir,
        encoding: 'utf8',
        timeout: 30000,
        stdio: 'pipe',
      }).trim();
    } catch (err) {
      // execFileSync attaches the child's stderr to the thrown error object;
      // fall back to its message when stderr is empty.
      const e = err as { stderr?: string; message?: string };
      throw new Error(`Git command failed: git ${args.join(' ')}\n${e.stderr || e.message}`);
    }
  }

  _gitSafe(args: string[]): GitResult {
    try {
      return { ok: true, output: this._git(args) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Check why isolation is unavailable and return a descriptive status.
   * Returns { available, reason, suggestion }.
   */
  getStatus() {
    const repoCheck = this._gitSafe(['rev-parse', '--is-inside-work-tree']);
    if (!repoCheck.ok || repoCheck.output !== 'true') {
      return {
        available: false,
        reason: 'Not a git repository',
        suggestion: 'Run `git init` to enable branch isolation, or use --no-isolate to skip',
      };
    }

    const status = this._gitSafe(['status', '--porcelain']);
    if (status.ok && status.output && status.output.trim() !== '') {
      const changedFiles = status.output.trim().split('\n').length;
      return {
        available: false,
        reason: `Working tree is dirty (${changedFiles} uncommitted change(s))`,
        suggestion: 'Commit or stash changes first (`git stash`), or use --no-isolate to skip',
        dirtyFiles: status.output.trim().split('\n').slice(0, 5),
      };
    }

    const headCheck = this._gitSafe(['symbolic-ref', '-q', 'HEAD']);
    if (!headCheck.ok) {
      return {
        available: false,
        reason: 'Detached HEAD state',
        suggestion: 'Checkout a branch first, or use --no-isolate to skip',
      };
    }

    return { available: true, reason: null, suggestion: null };
  }

  /**
   * Check if we're in a git repo with a clean working tree.
   */
  isReady() {
    const r = this._gitSafe(['rev-parse', '--is-inside-work-tree']);
    if (!r.ok || r.output !== 'true') return false;
    const status = this._gitSafe(['status', '--porcelain']);
    return status.ok && status.output === '';
  }

  /**
   * Get the current branch name.
   */
  getCurrentBranch() {
    return this._git(['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  /**
   * Create a worker branch from the current HEAD.
   * Returns the branch name.
   */
  createWorkerBranch(workerId: string, taskId: string): string {
    const branchName = `yuva/worker-${workerId}/task-${taskId}`;
    this._git(['checkout', '-b', branchName]);
    return branchName;
  }

  /**
   * Stage all changes and commit with a message.
   */
  commitChanges(message: string): string | null {
    this._git(['add', '-A']);
    // Check if there's anything to commit
    const status = this._git(['status', '--porcelain']);
    if (!status) return null; // nothing to commit
    this._git(['commit', '-m', message]);
    return this._git(['rev-parse', 'HEAD']);
  }

  /**
   * Merge a worker branch back into the main branch.
   * Returns true on success.
   */
  mergeToMain(workerBranch: string, mainBranch: string): GitResult {
    try {
      this._git(['checkout', mainBranch]);
      this._git(['merge', '--no-ff', workerBranch, '-m', `yuva: merge ${workerBranch}`]);
      return { ok: true };
    } catch (err) {
      // Merge conflict — abort and report
      this._gitSafe(['merge', '--abort']);
      return { ok: false, error: (err as Error).message, conflict: true };
    }
  }

  /**
   * Discard a worker branch (rollback). `checkout` only restores tracked
   * files to mainBranch's committed state — it never touches untracked
   * files, so a worker that created new files (rather than editing existing
   * ones) before failing would otherwise leak them onto the working tree
   * even after "rollback". `clean -fd` removes those; it respects
   * .gitignore, so build artifacts/dependencies are left alone.
   */
  discardBranch(workerBranch: string, mainBranch: string): void {
    this._gitSafe(['checkout', mainBranch]);
    this._gitSafe(['clean', '-fd']);
    this._gitSafe(['branch', '-D', workerBranch]);
  }

  /**
   * Get the diff of the current branch vs the main branch.
   */
  getDiff(mainBranch: string): GitResult {
    return this._gitSafe(['diff', mainBranch, '--stat']);
  }

  /**
   * Get files changed on the current branch.
   */
  getChangedFiles(mainBranch: string): string[] {
    const result = this._gitSafe(['diff', mainBranch, '--name-only']);
    if (!result.ok) return [];
    return result.output ? result.output.split('\n').filter(Boolean) : [];
  }

  /**
   * Stash any uncommitted changes (for recovery).
   */
  stash(message = 'yuva auto-stash') {
    return this._gitSafe(['stash', 'push', '-m', message]);
  }

  /**
   * Pop the last stash.
   */
  unstash() {
    return this._gitSafe(['stash', 'pop']);
  }

  /**
   * Full workflow: create branch → do work → commit → merge or rollback.
   * The `workFn` callback should do the actual work and return { success, summary }.
   */
  async isolateTask(workerId: string, taskId: string, workFn: () => Promise<WorkResult>): Promise<IsolationOutcome> {
    const mainBranch = this.getCurrentBranch();
    let workerBranch: string | null = null;

    try {
      // Create isolated branch
      workerBranch = this.createWorkerBranch(workerId, taskId);

      // Do the work
      const result = await workFn();

      if (result.success) {
        // Commit changes
        const commit = this.commitChanges(`yuva: task ${taskId} — ${result.summary || 'completed'}`);

        if (commit) {
          // Merge back
          const merge = this.mergeToMain(workerBranch, mainBranch);
          if (!merge.ok) {
            return {
              success: false,
              error: `Merge conflict: ${merge.error}`,
              branch: workerBranch,
              needsManualMerge: true,
            };
          }
        }

        return { success: true, branch: workerBranch, commit };
      } else {
        // Work failed — rollback
        this.discardBranch(workerBranch, mainBranch);
        return { success: false, error: result.error, rolledBack: true };
      }
    } catch (err) {
      // Unexpected error — rollback
      if (workerBranch) {
        this.discardBranch(workerBranch, mainBranch);
      }
      return { success: false, error: (err as Error).message, rolledBack: true };
    }
  }
}

export { GitIsolation };