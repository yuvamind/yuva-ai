import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { packageRoot } from './pkg-root';

export interface CollectSourceFilesOptions {
  extensions?: string[];
  maxDepth?: number;
}

export interface WalkSourceFilesOptions {
  extensions?: string[];
  /** Subdirectories of `targetDir` to walk; defaults to the whole tree. */
  dirs?: string[] | null;
  callback: (filePath: string, content: string) => void;
}

function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Parsed JSON, or null when the file is missing or malformed.
 *
 * The type parameter defaults to `any` on purpose. Callers read wildly different
 * shapes (package.json, config.json, task records), and forcing `unknown` here
 * would push a cast onto every one of the ~30 call sites without catching a real
 * bug -- the value is untrusted file content either way. Callers that care pass
 * their own shape: `readJSON<TaskRecord>(file)`.
 */
function readJSON<T = any>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJSON(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function readFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function writeFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function listFiles(dir: string, pattern: string | null = null): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = entries.filter(e => e.isFile()).map(e => e.name);
  if (pattern) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(escaped);
    files = files.filter(f => regex.test(f));
  }
  return files;
}

function getProjectRoot(): string {
  return process.cwd();
}

/**
 * NOTE: getTemplateDir and getPackageDir currently have no callers anywhere in
 * lib/, bin/ or tests/. They are kept (both are exported, so removing them is an
 * API change) but were rewritten to go through packageRoot() rather than the old
 * `path.join(__dirname, '..')`. That fixed hop assumed the source layout and
 * resolved to dist/ once compiled -- see lib/pkg-root.ts. They now return null
 * when the package root cannot be found, instead of a path that does not exist.
 */
function getTemplateDir(): string | null {
  const root = packageRoot();
  return root ? path.join(root, 'template') : null;
}

function getPackageDir(): string | null {
  return packageRoot();
}

/**
 * Collect source files matching extensions, using glob.
 * Replaces manual readdirSync walking in code-analyzer, graph-builder, etc.
 */
function collectSourceFiles(
  targetDir: string,
  { extensions = ['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java'], maxDepth = 10 }: CollectSourceFilesOptions = {},
): string[] {
  const extGlob = extensions.length === 1 ? extensions[0] : `{${extensions.join(',')}}`;
  const pattern = `**/*.${extGlob}`;
  return globSync(pattern, {
    cwd: targetDir,
    absolute: true,
    nodir: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/.next/**', '**/.yuva/**', '**/__pycache__/**', '**/.venv/**'],
    maxDepth,
  });
}

/**
 * Walk source files and call a callback with (filePath, content).
 * Replaces manual walkDir functions in plugin-gates, security-scanner.
 */
function walkSourceFiles(
  targetDir: string,
  { extensions = ['js', 'ts', 'jsx', 'tsx'], dirs = null, callback }: WalkSourceFilesOptions,
): void {
  const srcDirs = dirs || ['.'];
  const extGlob = extensions.length === 1 ? extensions[0] : `{${extensions.join(',')}}`;
  for (const dir of srcDirs) {
    const fullDir = path.join(targetDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    const files = globSync(`**/*.${extGlob}`, {
      cwd: fullDir,
      absolute: true,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
      maxDepth: 6,
    });
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        callback(filePath, content);
      } catch {}
    }
  }
}

export {
  copyDir,
  ensureDir,
  readJSON,
  writeJSON,
  fileExists,
  readFile,
  writeFile,
  listFiles,
  getProjectRoot,
  getTemplateDir,
  getPackageDir,
  collectSourceFiles,
  walkSourceFiles,
};
