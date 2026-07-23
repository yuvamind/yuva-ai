const fs = require('fs');
const path = require('path');

/**
 * File-level conflict detection and prevention.
 * When a task is claimed, analyze which files it will likely touch
 * and prevent two workers from editing the same file simultaneously.
 */

const FILE_LOCK_DIR = '.yuva/file-locks';

class FileConflictManager {
  constructor(projectDir) {
    this.projectDir = projectDir;
    this.lockDir = path.join(projectDir, FILE_LOCK_DIR);
  }

  _ensureDir() {
    fs.mkdirSync(this.lockDir, { recursive: true });
  }

  _lockFile(filePath) {
    // Sanitize file path into a safe filename
    return path.join(this.lockDir, filePath.replace(/[\\/:*?"<>|]/g, '_') + '.lock');
  }

  /**
   * Try to acquire a lock on a set of files for a task.
   * Returns { acquired: string[], conflicts: { file, lockedBy, taskId }[] }
   */
  acquireFiles(filePaths, taskId, workerId) {
    this._ensureDir();
    const acquired = [];
    const conflicts = [];

    for (const filePath of filePaths) {
      const lockPath = this._lockFile(filePath);

      try {
        // Atomic create — fails if file exists
        fs.writeFileSync(lockPath, JSON.stringify({
          file: filePath,
          taskId,
          workerId,
          lockedAt: new Date().toISOString(),
        }), { flag: 'wx' });
        acquired.push(filePath);
      } catch {
        // Lock exists — read who has it
        try {
          const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          conflicts.push({ file: filePath, lockedBy: lock.workerId, taskId: lock.taskId });
        } catch {
          conflicts.push({ file: filePath, lockedBy: 'unknown', taskId: 'unknown' });
        }
      }
    }

    return { acquired, conflicts };
  }

  /**
   * Release locks on files.
   */
  releaseFiles(filePaths) {
    for (const filePath of filePaths) {
      try {
        fs.unlinkSync(this._lockFile(filePath));
      } catch {}
    }
  }

  /**
   * Release all locks for a task.
   */
  releaseTask(taskId) {
    this._ensureDir();
    try {
      const files = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.lock'));
      for (const f of files) {
        try {
          const lock = JSON.parse(fs.readFileSync(path.join(this.lockDir, f), 'utf8'));
          if (lock.taskId === taskId) {
            fs.unlinkSync(path.join(this.lockDir, f));
          }
        } catch {}
      }
    } catch {}
  }

  /**
   * Check if any of the given files are currently locked.
   */
  checkFiles(filePaths) {
    const locked = [];
    for (const filePath of filePaths) {
      const lockPath = this._lockFile(filePath);
      if (fs.existsSync(lockPath)) {
        try {
          const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          locked.push({ file: filePath, ...lock });
        } catch {}
      }
    }
    return locked;
  }

  /**
   * Analyze a task description to predict which files it will touch.
   * Uses heuristics: file paths mentioned in the description, common patterns.
   */
  predictFiles(description, projectDir) {
    const files = new Set();

    // Extract explicit file paths from the description
    const pathPatterns = [
      /(?:^|\s)([\w./-]+\.[a-z]{1,4})(?:\s|$|,|\.)/gm,  // file.ext
      /(?:in|from|to|at|of|file|path|module)\s+[`'"]?([\w./-]+\.[a-z]{1,4})/gim,
      /[`'"]((?:src|lib|app|pages|components|api|server)\/[^`'"\s]+)/gm,
    ];

    for (const pattern of pathPatterns) {
      let m;
      while ((m = pattern.exec(description)) !== null) {
        const candidate = m[1];
        // Verify the file actually exists
        if (fs.existsSync(path.join(projectDir, candidate))) {
          files.add(candidate);
        }
      }
    }

    // Extract directory hints
    const dirHints = description.match(/(?:src|lib|app|pages|components|api|server|test|tests)\/[\w-]+/g) || [];
    for (const dir of dirHints) {
      const fullPath = path.join(projectDir, dir);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        try {
          const entries = fs.readdirSync(fullPath).filter(f => !f.startsWith('.') && !f.endsWith('.map'));
          for (const e of entries.slice(0, 10)) {
            files.add(path.join(dir, e).replace(/\\/g, '/'));
          }
        } catch {}
      }
    }

    return [...files];
  }

  /**
   * Get a summary of all current locks.
   */
  listLocks() {
    this._ensureDir();
    const locks = [];
    try {
      const files = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.lock'));
      for (const f of files) {
        try {
          const lock = JSON.parse(fs.readFileSync(path.join(this.lockDir, f), 'utf8'));
          locks.push(lock);
        } catch {}
      }
    } catch {}
    return locks;
  }

  /**
   * Clear all locks (for cleanup).
   */
  clearAll() {
    this._ensureDir();
    try {
      const files = fs.readdirSync(this.lockDir).filter(f => f.endsWith('.lock'));
      for (const f of files) {
        fs.unlinkSync(path.join(this.lockDir, f));
      }
    } catch {}
  }
}

module.exports = { FileConflictManager };
