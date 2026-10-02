import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SessionManager } from '../lib/session-manager';

// Use unique temp dir per test run
let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = path.join(os.tmpdir(), 'yuva-session-git-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  fs.mkdirSync(TEST_DIR, { recursive: true });
  // Init a git repo for testing
  execSync('git init', { cwd: TEST_DIR });
  execSync('git config user.email "test@test.com"', { cwd: TEST_DIR });
  execSync('git config user.name "Test"', { cwd: TEST_DIR });
  // Make an initial commit
  fs.writeFileSync(path.join(TEST_DIR, 'README.md'), '# Test');
  execSync('git add . && git commit -m "init"', { cwd: TEST_DIR });
});

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('Git state capture', () => {
  it('captureGitState returns recent commits and branch', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'app.js'), 'console.log("hello")');
    execSync('git add . && git commit -m "feat: add app"', { cwd: TEST_DIR });

    const sm = new SessionManager(TEST_DIR);
    const state = sm.captureGitState();

    expect(state.branch).toBeTruthy();
    expect(state.recentCommits.length).toBeGreaterThan(0);
    expect(state.recentCommits[0]).toContain('feat: add app');
  });

  it('captures uncommitted changes', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'dirty.js'), 'dirty');

    const sm = new SessionManager(TEST_DIR);
    const state = sm.captureGitState();

    expect(state.uncommitted.length).toBeGreaterThan(0);
  });

  it('save auto-captures git state', () => {
    fs.writeFileSync(path.join(TEST_DIR, 'new.js'), 'new file');
    execSync('git add . && git commit -m "feat: new file"', { cwd: TEST_DIR });

    const sm = new SessionManager(TEST_DIR);
    sm.start({ goal: 'Test git capture' });
    sm.save({});

    const session = sm.getSession()!;
    expect(session.gitState).toBeTruthy();
    expect(session.gitState!.branch).toBeTruthy();
    expect(session.gitState!.recentCommits.length).toBeGreaterThan(0);
  });

  it('save merges uncommitted files into filesChanged', () => {
    const sm = new SessionManager(TEST_DIR);
    sm.start({ goal: 'Test merge' });

    // Create an uncommitted file
    fs.writeFileSync(path.join(TEST_DIR, 'uncommitted.js'), 'new');
    sm.save({ filesChanged: ['explicit.js'] });

    const session = sm.getSession()!;
    expect(session.filesChanged).toContain('explicit.js');
    // Should also contain uncommitted file from git status
    expect(session.filesChanged.length).toBeGreaterThan(1);
  });

  it('captureGitState works gracefully outside git repo', () => {
    const nonGitDir = path.join(os.tmpdir(), 'yuva-no-git-' + Date.now());
    fs.mkdirSync(nonGitDir, { recursive: true });

    const sm = new SessionManager(nonGitDir);
    const state = sm.captureGitState();

    expect(state.branch).toBeNull();
    expect(state.recentCommits).toEqual([]);
    expect(state.uncommitted).toEqual([]);

    fs.rmSync(nonGitDir, { recursive: true, force: true });
  });
});
