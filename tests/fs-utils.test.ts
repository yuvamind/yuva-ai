
import path from 'path';
import fs from 'fs';
import os from 'os';
import { copyDir, ensureDir, readJSON, writeJSON, fileExists, readFile, writeFile, listFiles } from '../lib/fs-utils';

describe('fs-utils', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-fsutils-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('ensureDir', () => {
    it('should create directory if it does not exist', () => {
      const dir = path.join(tmpDir, 'a', 'b', 'c');
      ensureDir(dir);
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('should not throw if directory already exists', () => {
      ensureDir(tmpDir);
      expect(fs.existsSync(tmpDir)).toBe(true);
    });
  });

  describe('readJSON / writeJSON', () => {
    it('should write and read JSON', () => {
      const file = path.join(tmpDir, 'test.json');
      const data = { name: 'test', version: 1 };
      writeJSON(file, data);
      const result = readJSON(file);
      expect(result).toEqual(data);
    });

    it('should return null for non-existent file', () => {
      const result = readJSON(path.join(tmpDir, 'nonexistent.json'));
      expect(result).toBeNull();
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', () => {
      const file = path.join(tmpDir, 'exists.txt');
      fs.writeFileSync(file, 'hello');
      expect(fileExists(file)).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(fileExists(path.join(tmpDir, 'nope.txt'))).toBe(false);
    });
  });

  describe('readFile / writeFile', () => {
    it('should write and read text files', () => {
      const file = path.join(tmpDir, 'sub', 'test.txt');
      writeFile(file, 'hello world');
      expect(readFile(file)).toBe('hello world');
    });

    it('should return null for non-existent file', () => {
      expect(readFile(path.join(tmpDir, 'nope.txt'))).toBeNull();
    });
  });

  describe('listFiles', () => {
    it('should list files in a directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.md'), '');
      fs.writeFileSync(path.join(tmpDir, 'b.md'), '');
      fs.writeFileSync(path.join(tmpDir, 'c.txt'), '');

      const all = listFiles(tmpDir);
      expect(all).toContain('a.md');
      expect(all).toContain('b.md');
      expect(all).toContain('c.txt');
    });

    it('should filter by pattern', () => {
      fs.writeFileSync(path.join(tmpDir, 'a.md'), '');
      fs.writeFileSync(path.join(tmpDir, 'b.txt'), '');

      const mdFiles = listFiles(tmpDir, '*.md');
      expect(mdFiles).toContain('a.md');
      expect(mdFiles).not.toContain('b.txt');
    });

    it('should return empty array for non-existent directory', () => {
      expect(listFiles(path.join(tmpDir, 'nope'))).toEqual([]);
    });
  });

  describe('copyDir', () => {
    it('should recursively copy directories', () => {
      const src = path.join(tmpDir, 'src');
      const dest = path.join(tmpDir, 'dest');

      fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(src, 'file.txt'), 'root');
      fs.writeFileSync(path.join(src, 'sub', 'nested.txt'), 'nested');

      copyDir(src, dest);

      expect(fs.existsSync(path.join(dest, 'file.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'file.txt'), 'utf8')).toBe('root');
      expect(fs.existsSync(path.join(dest, 'sub', 'nested.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(dest, 'sub', 'nested.txt'), 'utf8')).toBe('nested');
    });
  });
});
