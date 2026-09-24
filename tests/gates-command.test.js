const fs = require('fs');
const path = require('path');
const os = require('os');
const gatesCommand = require('../lib/commands/gates');

describe('gates command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-gates-'));
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps warning findings non-blocking', () => {
    fs.mkdirSync(path.join(tmpDir, '.yuva'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.yuva', 'config.json'),
      JSON.stringify({ pluginGates: { 'no-console-log': true } })
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'console.log("not allowed");');

    const result = gatesCommand(['run'], tmpDir);

    expect(result.passed).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('sets a non-zero exit code when a blocking plugin gate fails', () => {
    fs.mkdirSync(path.join(tmpDir, '.yuva', 'gates'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.yuva', 'gates', 'blocking.js'),
      'module.exports = { name: "Blocking gate", severity: "error", run: () => [{ message: "blocked" }] };'
    );

    const result = gatesCommand(['run'], tmpDir);

    expect(result.passed).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it('leaves the exit code clear when all plugin gates pass', () => {
    const result = gatesCommand(['run'], tmpDir);

    expect(result.passed).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not fail when only listing gates', () => {
    gatesCommand(['list'], tmpDir);

    expect(process.exitCode).toBeUndefined();
  });
});
