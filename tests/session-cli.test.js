const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLI = path.resolve('bin/cli.js');

function run(args, cwd) {
  return execSync(`node "${CLI}" ${args}`, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

function readSessionJSON(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.yuva', 'session', 'session.json'), 'utf8'));
}

describe('session CLI', () => {
  let TEST_DIR;

  function makeTempDir() {
    TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-session-cli-'));
    return TEST_DIR;
  }

  afterEach(() => {
    if (TEST_DIR && fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    TEST_DIR = null;
  });

  it('session start creates session and prints confirmation', () => {
    const dir = makeTempDir();
    const output = run('session start "Build login page"', dir);
    expect(output).toMatch(/Session started/i);

    const session = readSessionJSON(dir);
    expect(session.goal).toBe('Build login page');
    expect(session.status).toBe('active');
  });

  it('session start warns if already active', () => {
    const dir = makeTempDir();
    run('session start "First goal"', dir);
    const output = run('session start "Second goal"', dir);
    expect(output).toMatch(/already active/i);
  });

  it('session log adds entry', () => {
    const dir = makeTempDir();
    run('session start "Test project"', dir);
    const output = run('session log "Added user model"', dir);
    expect(output).toMatch(/Logged/i);

    const session = readSessionJSON(dir);
    expect(session.entries.length).toBeGreaterThanOrEqual(1);
    expect(session.entries.some(e => e.message === 'Added user model')).toBe(true);
  });

  it('session log supports --type flag', () => {
    const dir = makeTempDir();
    run('session start "Test project"', dir);
    run('session log --type code "Refactored auth"', dir);

    const session = readSessionJSON(dir);
    const entry = session.entries.find(e => e.message === 'Refactored auth');
    expect(entry).toBeDefined();
    expect(entry.type).toBe('code');
  });

  it('session resume outputs goal and logged messages', () => {
    const dir = makeTempDir();
    run('session start "Build login page"', dir);
    run('session log "Added user model"', dir);
    const output = run('session resume', dir);
    expect(output).toContain('Build login page');
    expect(output).toContain('Added user model');
  });

  it('session status shows goal and active status', () => {
    const dir = makeTempDir();
    run('session start "Build login page"', dir);
    const output = run('session status', dir);
    expect(output).toContain('Build login page');
    expect(output).toMatch(/active/i);
  });

  it('session end sets status to completed', () => {
    const dir = makeTempDir();
    run('session start "Build login page"', dir);
    run('session end', dir);

    const session = readSessionJSON(dir);
    expect(session.status).toBe('completed');
  });

  it('session decision records decision', () => {
    const dir = makeTempDir();
    run('session start "Build login page"', dir);
    const output = run('session decision "Use Redis" "Need fast caching"', dir);
    expect(output).toMatch(/Decision recorded/i);

    const session = readSessionJSON(dir);
    expect(session.decisions.length).toBe(1);
    expect(session.decisions[0].what).toBe('Use Redis');
    expect(session.decisions[0].why).toBe('Need fast caching');
  });

  it('session with no subcommand shows help', () => {
    const dir = makeTempDir();
    const output = run('session', dir);
    expect(output).toMatch(/Session Commands/i);
  });

  it('session clear removes session files', () => {
    const dir = makeTempDir();
    run('session start "Build login page"', dir);
    expect(fs.existsSync(path.join(dir, '.yuva', 'session'))).toBe(true);
    run('session clear', dir);
    expect(fs.existsSync(path.join(dir, '.yuva', 'session'))).toBe(false);
  });
});
