const fs = require('fs');
const os = require('os');
const path = require('path');
const { StreamingWorker } = require('../lib/streaming-worker');

function writeScript(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

function makeBus(tmpDir) {
  const updateCalls = [];
  return {
    busDir: tmpDir,
    updateCalls,
    updateTask: (taskId, patch) => updateCalls.push({ taskId, patch }),
  };
}

describe('StreamingWorker', () => {
  let tmpDir;
  let bus;
  let worker;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-streaming-worker-'));
    bus = makeBus(tmpDir);
    worker = new StreamingWorker(bus);
  });

  afterEach(() => {
    // maxRetries/retryDelay: on Windows a just-killed child process (e.g. the
    // timeout test) can hold the tmp dir open for a few ms after resolve().
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('captures stdout, exit code, and duration for a successful command', async () => {
    const script = writeScript(tmpDir, 'ok.js', "console.log('hello-out'); console.error('hello-err');");
    const result = await worker.run('task-ok', `node ${script}`, { cwd: tmpDir });

    expect(result.code).toBe(0);
    expect(result.error).toBeNull();
    expect(result.stdout).toContain('hello-out');
    expect(result.stderr).toContain('hello-err');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('writes combined stdout/stderr to the per-task log file', async () => {
    const script = writeScript(tmpDir, 'log.js', "console.log('line-a'); console.error('line-b');");
    await worker.run('task-log', `node ${script}`, { cwd: tmpDir });

    const logged = worker.getOutput('task-log');
    expect(logged).toContain('line-a');
    expect(logged).toContain('[STDERR] line-b');
  });

  it('reports a non-zero exit code as an error', async () => {
    const script = writeScript(tmpDir, 'fail.js', "console.error('boom'); process.exit(3);");
    const result = await worker.run('task-fail', `node ${script}`, { cwd: tmpDir });

    expect(result.code).toBe(3);
    expect(result.error).toContain('boom');
  });

  it('updates the task bus with streaming progress', async () => {
    const script = writeScript(tmpDir, 'progress.js', "console.log('a'); console.log('b');");
    await worker.run('task-progress', `node ${script}`, { cwd: tmpDir });

    expect(bus.updateCalls.length).toBeGreaterThan(0);
    const last = bus.updateCalls[bus.updateCalls.length - 1];
    expect(last.taskId).toBe('task-progress');
    expect(last.patch.outputChars).toBeGreaterThan(0);
  });

  it('emits stdout/stderr/done events', async () => {
    const script = writeScript(tmpDir, 'events.js', "console.log('out-evt'); console.error('err-evt');");
    const seen = { stdout: false, stderr: false, done: false };
    worker.on('stdout', () => { seen.stdout = true; });
    worker.on('stderr', () => { seen.stderr = true; });
    worker.on('done', () => { seen.done = true; });

    await worker.run('task-events', `node ${script}`, { cwd: tmpDir });

    expect(seen.stdout).toBe(true);
    expect(seen.stderr).toBe(true);
    expect(seen.done).toBe(true);
  });

  it('kills the process and reports a timeout error when it runs too long', async () => {
    const script = writeScript(tmpDir, 'hang.js', 'setTimeout(() => {}, 60000);');
    let timedOutEvent = null;
    worker.on('timeout', (evt) => { timedOutEvent = evt; });

    const result = await worker.run('task-timeout', `node ${script}`, { cwd: tmpDir, timeoutMs: 200 });

    expect(result.error).toBe('timeout');
    expect(timedOutEvent).not.toBeNull();
    expect(timedOutEvent.taskId).toBe('task-timeout');

    // run() resolves as soon as kill() is *called*, not once Windows has
    // actually finished tearing the process down — give it a beat so
    // afterEach's rmSync doesn't race a still-dying node.exe holding tmpDir
    // as its cwd (a real OS-level lock, not just a flaky test).
    await new Promise((r) => setTimeout(r, 300));
  }, 10000);

  it('caps accumulated stdout at maxOutputSize', async () => {
    const smallWorker = new StreamingWorker(bus, { maxOutputSize: 10 });
    const script = writeScript(tmpDir, 'big.js', "console.log('0123456789'.repeat(50));");
    const result = await smallWorker.run('task-big', `node ${script}`, { cwd: tmpDir });

    // stdout is capped to the tail after exceeding maxOutputSize, but the
    // log FILE still gets the full stream written before capping kicks in.
    expect(result.stdout.length).toBeLessThanOrEqual(20);
  });

  it('getOutputTail returns only the last N lines', async () => {
    const script = writeScript(tmpDir, 'lines.js', "for (let i = 1; i <= 5; i++) console.log('line' + i);");
    await worker.run('task-lines', `node ${script}`, { cwd: tmpDir });

    const tail = worker.getOutputTail('task-lines', 2);
    expect(tail).toContain('line5');
    expect(tail).not.toContain('line1');
  });

  it('getOutput returns null for an unknown task', () => {
    expect(worker.getOutput('does-not-exist')).toBeNull();
  });

  it('listOutputs lists logs written by run()', async () => {
    const script = writeScript(tmpDir, 'listed.js', "console.log('x');");
    await worker.run('task-listed', `node ${script}`, { cwd: tmpDir });

    const outputs = worker.listOutputs();
    expect(outputs.some(o => o.taskId === 'task-listed')).toBe(true);
  });

  it('cleanup removes logs older than maxAgeMs', async () => {
    const script = writeScript(tmpDir, 'old.js', "console.log('x');");
    await worker.run('task-old', `node ${script}`, { cwd: tmpDir });

    expect(worker.getOutput('task-old')).not.toBeNull();
    worker.cleanup(0); // maxAge 0 — everything is "old"
    expect(worker.getOutput('task-old')).toBeNull();
  });

  it('resolves gracefully instead of throwing when the command does not exist', async () => {
    const result = await worker.run('task-missing', 'definitely-not-a-real-cli-xyz', { cwd: tmpDir });
    expect(result.code).not.toBe(0);
  });

  it('survives the output directory disappearing mid-run', async () => {
    // createWriteStream opens asynchronously. If the directory is gone by the
    // time the open lands, the stream emits 'error' — and with no listener
    // that becomes an uncaught exception that kills the whole process, long
    // after run() has already resolved. CI caught exactly this race.
    const uncaught = [];
    const onUncaught = (err) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);

    try {
      const pending = worker.run('task-vanishing', 'definitely-not-a-real-cli-xyz', { cwd: tmpDir });
      // Remove the log directory while the open is still in flight.
      fs.rmSync(worker.outputDir, { recursive: true, force: true });

      const result = await pending;
      expect(result.code).not.toBe(0);

      // Give the stream's pending open a turn to fail.
      await new Promise(r => setTimeout(r, 50));
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('keeps capturing stdout when the log file cannot be written', async () => {
    // The log is diagnostic. Losing it must not lose the command's output.
    const script = writeScript(tmpDir, 'echo.js', 'process.stdout.write("hello from the task\\n");');
    const pending = worker.run('task-nolog', `node ${JSON.stringify(script)}`, { cwd: tmpDir });
    fs.rmSync(worker.outputDir, { recursive: true, force: true });

    const result = await pending;
    expect(result.stdout).toContain('hello from the task');
  });
});
