const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

/**
 * Streaming worker — runs an AI CLI and streams output in real-time
 * to both the terminal and the task bus for the orchestrator dashboard.
 */

class StreamingWorker extends EventEmitter {
  constructor(bus, options = {}) {
    super();
    this.bus = bus;
    this.outputDir = path.join(bus.busDir, 'worker-output');
    this.maxOutputSize = options.maxOutputSize || 500_000; // 500KB cap per task
  }

  _ensureDir() {
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Run a command and stream its output. Returns a promise that resolves
   * when the command finishes, with the full output captured.
   */
  run(taskId, command, { cwd = process.cwd(), timeoutMs = 15 * 60 * 1000 } = {}) {
    this._ensureDir();
    const outputFile = path.join(this.outputDir, `${taskId}.log`);
    const stream = fs.createWriteStream(outputFile, { flags: 'w' });

    let stdout = '';
    let stderr = '';
    let lines = 0;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const child = spawn(command, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        cwd,
      });

      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        this.emit('timeout', { taskId, durationMs: Date.now() - startTime });
        finish({ code: 1, stdout, stderr, error: 'timeout', durationMs: Date.now() - startTime });
      }, timeoutMs);

      const finish = (result) => {
        clearTimeout(timer);
        stream.end();
        this.emit('done', { taskId, ...result });
        resolve(result);
      };

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        lines += (chunk.match(/\n/g) || []).length;

        // Stream to file
        stream.write(chunk);

        // Emit progress events
        this.emit('stdout', { taskId, chunk, lines, totalChars: stdout.length });

        // Update task bus with progress
        try {
          this.bus.heartbeat(taskId, { outputLines: lines, outputChars: stdout.length });
        } catch {}

        // Cap output size
        if (stdout.length > this.maxOutputSize) {
          stdout = stdout.slice(-this.maxOutputSize);
        }
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        stream.write(`[STDERR] ${chunk}`);
        this.emit('stderr', { taskId, chunk });
      });

      child.on('error', (err) => {
        finish({ code: 1, stdout, stderr, error: err.message, durationMs: Date.now() - startTime });
      });

      child.on('close', (code) => {
        finish({
          code,
          stdout,
          stderr,
          error: code === 0 ? null : (stderr.trim().slice(-500) || `exit code ${code}`),
          durationMs: Date.now() - startTime,
          lines,
        });
      });

      child.stdin.on('error', () => {});
    });
  }

  /**
   * Get the output log for a task.
   */
  getOutput(taskId) {
    const outputFile = path.join(this.outputDir, `${taskId}.log`);
    try {
      return fs.readFileSync(outputFile, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Get the tail of the output log.
   */
  getOutputTail(taskId, lines = 50) {
    const content = this.getOutput(taskId);
    if (!content) return null;
    const allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  }

  /**
   * List all active output logs.
   */
  listOutputs() {
    this._ensureDir();
    try {
      return fs.readdirSync(this.outputDir)
        .filter(f => f.endsWith('.log'))
        .map(f => {
          const taskId = f.replace('.log', '');
          const stat = fs.statSync(path.join(this.outputDir, f));
          return { taskId, size: stat.size, modified: stat.mtime };
        });
    } catch {
      return [];
    }
  }

  /**
   * Clean up old output logs.
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
    this._ensureDir();
    const now = Date.now();
    try {
      const files = fs.readdirSync(this.outputDir).filter(f => f.endsWith('.log'));
      for (const f of files) {
        const stat = fs.statSync(path.join(this.outputDir, f));
        if (now - stat.mtime.getTime() > maxAgeMs) {
          fs.unlinkSync(path.join(this.outputDir, f));
        }
      }
    } catch {}
  }
}

module.exports = { StreamingWorker };
