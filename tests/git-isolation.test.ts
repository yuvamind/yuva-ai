import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { GitIsolation } from '../lib/git-isolation';

let TEST_DIR: string;

function run(cmd: string, cwd = TEST_DIR) {
  return execSync(cmd, { cwd, encoding: 'utf8' });
}

beforeEach(() => {
  TEST_DIR = path.join(os.tmpdir(), 'yuva-git-isolation-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(TEST_DIR, { recursive: true });
  run('git init');
  run('git config user.email "test@test.com"');
  run('git config user.name "Test"');
  fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'line1\nline2\nline3\n');
  run('git add . && git commit -m "init"');
  run('git branch -M main'); // deterministic branch name regardless of git version/config
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('GitIsolation.getStatus()', () => {
  it('reports available on a clean repo', () => {
    const gi = new GitIsolation(TEST_DIR);
    expect(gi.getStatus()).toEqual({ available: true, reason: null, suggestion: null });
  });

  it('reports unavailable outside a git repo', () => {
    // Must NOT be nested under TEST_DIR — git searches upward for a .git
    // dir, so a subdirectory of an existing repo would find the parent repo.
    const nonGitDir = path.join(os.tmpdir(), 'yuva-git-isolation-non-repo-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(nonGitDir, { recursive: true });
    try {
      const gi = new GitIsolation(nonGitDir);
      const status = gi.getStatus();
      expect(status.available).toBe(false);
      expect(status.reason).toMatch(/not a git repository/i);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('reports unavailable with a dirty working tree', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'dirty change');
    const gi = new GitIsolation(TEST_DIR);
    const status = gi.getStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toMatch(/dirty/i);
    expect(status.dirtyFiles!.length).toBeGreaterThan(0);
  });
});

describe('GitIsolation branch operations', () => {
  it('getCurrentBranch returns the checked-out branch', () => {
    const gi = new GitIsolation(TEST_DIR);
    expect(gi.getCurrentBranch()).toBe('main');
  });

  it('createWorkerBranch creates and checks out a namespaced branch', () => {
    const gi = new GitIsolation(TEST_DIR);
    const branch = gi.createWorkerBranch('w1', 't1');
    expect(branch).toBe('yuva/worker-w1/task-t1');
    expect(gi.getCurrentBranch()).toBe(branch);
  });

  it('commitChanges commits staged work and returns a sha', () => {
    const gi = new GitIsolation(TEST_DIR);
    fs.writeFileSync(path.join(TEST_DIR, 'new-file.txt'), 'content');
    const sha = gi.commitChanges('add new file');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(run('git log -1 --pretty=%s').trim()).toBe('add new file');
  });

  it('commitChanges returns null when there is nothing to commit', () => {
    const gi = new GitIsolation(TEST_DIR);
    expect(gi.commitChanges('nothing to see here')).toBeNull();
  });

  it('discardBranch removes the branch and returns to main', () => {
    const gi = new GitIsolation(TEST_DIR);
    const branch = gi.createWorkerBranch('w2', 't2');
    fs.writeFileSync(path.join(TEST_DIR, 'scratch.txt'), 'x');
    gi.commitChanges('scratch work');

    gi.discardBranch(branch, 'main');

    expect(gi.getCurrentBranch()).toBe('main');
    expect(run('git branch --list "' + branch + '"').trim()).toBe('');
  });
});

describe('GitIsolation.mergeToMain()', () => {
  it('merges non-conflicting work back into main', () => {
    const gi = new GitIsolation(TEST_DIR);
    const branch = gi.createWorkerBranch('w3', 't3');
    fs.writeFileSync(path.join(TEST_DIR, 'feature.txt'), 'new feature');
    gi.commitChanges('feat: add feature file');

    const result = gi.mergeToMain(branch, 'main');

    expect(result.ok).toBe(true);
    expect(gi.getCurrentBranch()).toBe('main');
    expect(fs.existsSync(path.join(TEST_DIR, 'feature.txt'))).toBe(true);
  });

  it('aborts cleanly and reports conflict=true on a real merge conflict', () => {
    const gi = new GitIsolation(TEST_DIR);
    const branch = gi.createWorkerBranch('w4', 't4');
    fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'WORKER CHANGE\nline2\nline3\n');
    gi.commitChanges('worker: conflicting edit');

    // Simulate a second worker landing a conflicting change on main first.
    run('git checkout main');
    fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'MAIN CHANGE\nline2\nline3\n');
    run('git add . && git commit -m "main: conflicting edit"');

    const result = gi.mergeToMain(branch, 'main');

    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);

    // The critical, previously-unverified part: the aborted merge must leave
    // a genuinely clean repo, not a half-merged one with conflict markers.
    expect(run('git status --porcelain').trim()).toBe('');
    expect(fs.existsSync(path.join(TEST_DIR, '.git', 'MERGE_HEAD'))).toBe(false);
  });
});

describe('GitIsolation.getDiff() / getChangedFiles()', () => {
  it('lists files changed on a branch relative to main', () => {
    const gi = new GitIsolation(TEST_DIR);
    gi.createWorkerBranch('w5', 't5');
    fs.writeFileSync(path.join(TEST_DIR, 'touched.txt'), 'x');
    gi.commitChanges('touch a file');

    expect(gi.getChangedFiles('main')).toContain('touched.txt');
  });

  it('returns an empty array when the diff command fails', () => {
    const gi = new GitIsolation(TEST_DIR);
    expect(gi.getChangedFiles('branch-that-does-not-exist')).toEqual([]);
  });
});

describe('GitIsolation.stash() / unstash()', () => {
  it('stashes and restores uncommitted changes', () => {
    const gi = new GitIsolation(TEST_DIR);
    fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'stash me');

    const stashed = gi.stash('test stash');
    expect(stashed.ok).toBe(true);
    expect(run('git status --porcelain').trim()).toBe('');

    const popped = gi.unstash();
    expect(popped.ok).toBe(true);
    expect(fs.readFileSync(path.join(TEST_DIR, 'file.txt'), 'utf8')).toBe('stash me');
  });
});

describe('GitIsolation.isolateTask()', () => {
  it('commits and merges on success', async () => {
    const gi = new GitIsolation(TEST_DIR);
    const result = await gi.isolateTask('w6', 't6', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'done.txt'), 'task output');
      return { success: true, summary: 'wrote done.txt' };
    });

    expect(result.success).toBe(true);
    expect(gi.getCurrentBranch()).toBe('main');
    expect(fs.existsSync(path.join(TEST_DIR, 'done.txt'))).toBe(true);
  });

  it('rolls back and discards the branch when the work function reports failure', async () => {
    const gi = new GitIsolation(TEST_DIR);
    const result = await gi.isolateTask('w7', 't7', async () => {
      fs.writeFileSync(path.join(TEST_DIR, 'partial.txt'), 'half-done');
      return { success: false, error: 'gate failed' };
    });

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(gi.getCurrentBranch()).toBe('main');
    expect(run('git branch --list "yuva/worker-w7/task-t7"').trim()).toBe('');
    // The rolled-back file must not leak onto main.
    expect(fs.existsSync(path.join(TEST_DIR, 'partial.txt'))).toBe(false);
  });

  it('rolls back when the work function throws', async () => {
    const gi = new GitIsolation(TEST_DIR);
    const result = await gi.isolateTask('w8', 't8', async () => {
      throw new Error('worker crashed mid-task');
    });

    expect(result.success).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.error).toContain('worker crashed mid-task');
    expect(gi.getCurrentBranch()).toBe('main');
  });

  it('reports needsManualMerge and leaves a clean repo on a real conflict', async () => {
    const gi = new GitIsolation(TEST_DIR);

    const result = await gi.isolateTask('w9', 't9', async () => {
      // Simulate main moving underneath this worker while it was "working".
      run('git checkout main');
      fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'MAIN CHANGE\nline2\nline3\n');
      run('git add . && git commit -m "main moved on"');
      run('git checkout yuva/worker-w9/task-t9');

      fs.writeFileSync(path.join(TEST_DIR, 'file.txt'), 'WORKER CHANGE\nline2\nline3\n');
      return { success: true, summary: 'conflicting edit' };
    });

    expect(result.success).toBe(false);
    expect(result.needsManualMerge).toBe(true);
    expect(result.branch).toBe('yuva/worker-w9/task-t9');
    expect(run('git status --porcelain').trim()).toBe('');
  });
});
