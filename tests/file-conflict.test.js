const fs = require('fs');
const path = require('path');
const os = require('os');
const { FileConflictManager } = require('../lib/file-conflict');

describe('FileConflictManager', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
    manager = new FileConflictManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('acquireFiles()', () => {
    it('should acquire files successfully', () => {
      const result = manager.acquireFiles(['src/auth.js', 'src/db.js'], 'task-1', 'worker-1');
      expect(result.acquired).toContain('src/auth.js');
      expect(result.acquired).toContain('src/db.js');
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect conflicts when files are already locked', () => {
      manager.acquireFiles(['src/auth.js'], 'task-1', 'worker-1');
      const result = manager.acquireFiles(['src/auth.js', 'src/utils.js'], 'task-2', 'worker-2');

      expect(result.acquired).toContain('src/utils.js');
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].file).toBe('src/auth.js');
      expect(result.conflicts[0].lockedBy).toBe('worker-1');
    });

    it('should release files', () => {
      manager.acquireFiles(['src/auth.js'], 'task-1', 'worker-1');
      manager.releaseFiles(['src/auth.js']);

      const result = manager.acquireFiles(['src/auth.js'], 'task-2', 'worker-2');
      expect(result.acquired).toContain('src/auth.js');
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('releaseTask()', () => {
    it('should release all files for a task', () => {
      manager.acquireFiles(['src/a.js', 'src/b.js'], 'task-1', 'worker-1');
      manager.releaseTask('task-1');

      const locks = manager.listLocks();
      expect(locks).toHaveLength(0);
    });
  });

  describe('checkFiles()', () => {
    it('should report locked files', () => {
      manager.acquireFiles(['src/auth.js'], 'task-1', 'worker-1');
      const locked = manager.checkFiles(['src/auth.js', 'src/utils.js']);
      expect(locked).toHaveLength(1);
      expect(locked[0].file).toBe('src/auth.js');
    });
  });

  describe('listLocks()', () => {
    it('should list all active locks', () => {
      manager.acquireFiles(['src/a.js', 'src/b.js'], 'task-1', 'worker-1');
      const locks = manager.listLocks();
      expect(locks).toHaveLength(2);
    });
  });

  describe('predictFiles()', () => {
    it('should extract file paths from description', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'auth.js'), 'module.exports = {};');

      const files = manager.predictFiles('Fix the login function in src/auth.js', tmpDir);
      expect(files).toContain('src/auth.js');
    });
  });
});
