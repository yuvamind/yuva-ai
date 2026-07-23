const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { fileExists, readJSON } = require('./fs-utils');
const { detectGates } = require('./gate-runner');

/**
 * Dynamic context injection engine for agent prompts.
 * Replaces static markdown templates with live project state.
 */

/**
 * Scan the project directory and build a structured context object.
 * This is the "brain" that gives agents real awareness of the codebase.
 */
function scanProject(targetDir) {
  const ctx = {
    rootDir: targetDir,
    languages: [],
    frameworks: [],
    packageManager: null,
    entryPoints: [],
    srcDirs: [],
    testDirs: [],
    configFiles: [],
    totalFiles: 0,
    totalLines: 0,
    fileTree: {},
    dependencies: {},
    devDependencies: {},
    scripts: {},
    gitBranch: null,
    gitStatus: 'unknown',
    recentCommits: [],
    hasTests: false,
    hasLint: false,
    hasCI: false,
    hasDocker: false,
    hasTypeScript: false,
    envFiles: [],
    lockFiles: [],
  };

  // Detect languages from manifest files
  const manifests = [
    { file: 'package.json', lang: 'javascript', parse: true },
    { file: 'tsconfig.json', lang: 'typescript', parse: false },
    { file: 'requirements.txt', lang: 'python', parse: false },
    { file: 'pyproject.toml', lang: 'python', parse: false },
    { file: 'setup.py', lang: 'python', parse: false },
    { file: 'go.mod', lang: 'go', parse: false },
    { file: 'Cargo.toml', lang: 'rust', parse: false },
    { file: 'pom.xml', lang: 'java', parse: false },
    { file: 'build.gradle', lang: 'java', parse: false },
    { file: 'Gemfile', lang: 'ruby', parse: false },
    { file: 'composer.json', lang: 'php', parse: false },
    { file: 'pubspec.yaml', lang: 'dart', parse: false },
  ];

  for (const { file, lang, parse } of manifests) {
    const fullPath = path.join(targetDir, file);
    if (fileExists(fullPath)) {
      if (!ctx.languages.includes(lang)) ctx.languages.push(lang);
      ctx.configFiles.push(file);
      if (parse) {
        const pkg = readJSON(fullPath);
        if (pkg) {
          ctx.dependencies = { ...ctx.dependencies, ...(pkg.dependencies || {}) };
          ctx.devDependencies = { ...ctx.devDependencies, ...(pkg.devDependencies || {}) };
          ctx.scripts = pkg.scripts || {};
          if (pkg.scripts && pkg.scripts.start) ctx.entryPoints.push('npm start');
        }
      }
    }
  }

  // Detect TypeScript
  ctx.hasTypeScript = fileExists(path.join(targetDir, 'tsconfig.json')) ||
    ctx.languages.includes('typescript');

  // Detect frameworks
  const allDeps = { ...ctx.dependencies, ...ctx.devDependencies };
  const frameworkMap = {
    'react': 'react', 'next': 'nextjs', 'vue': 'vue', 'nuxt': 'nuxt',
    'express': 'express', 'fastify': 'fastify', '@nestjs/core': 'nestjs',
    '@angular/core': 'angular', 'svelte': 'svelte', 'hono': 'hono',
    'fastapi': 'fastapi', 'django': 'django', 'flask': 'flask',
    'rails': 'rails', 'laravel': 'laravel', 'actix-web': 'actix',
    'rocket': 'rocket',
  };
  for (const [dep, name] of Object.entries(frameworkMap)) {
    if (allDeps[dep]) ctx.frameworks.push(name);
  }

  // Detect package manager
  if (fileExists(path.join(targetDir, 'pnpm-lock.yaml'))) ctx.packageManager = 'pnpm';
  else if (fileExists(path.join(targetDir, 'yarn.lock'))) ctx.packageManager = 'yarn';
  else if (fileExists(path.join(targetDir, 'package-lock.json'))) ctx.packageManager = 'npm';
  else if (fileExists(path.join(targetDir, 'poetry.lock'))) ctx.packageManager = 'poetry';
  else if (fileExists(path.join(targetDir, 'Pipfile.lock'))) ctx.packageManager = 'pipenv';
  else if (fileExists(path.join(targetDir, 'Cargo.lock'))) ctx.packageManager = 'cargo';

  // Detect directories
  const srcCandidates = ['src', 'lib', 'app', 'pages', 'api', 'server', 'cmd', 'internal', 'pkg'];
  for (const dir of srcCandidates) {
    if (fileExists(path.join(targetDir, dir))) ctx.srcDirs.push(dir);
  }
  const testCandidates = ['test', 'tests', '__tests__', 'spec', 'e2e', 'cypress'];
  for (const dir of testCandidates) {
    if (fileExists(path.join(targetDir, dir))) {
      ctx.testDirs.push(dir);
      ctx.hasTests = true;
    }
  }

  // Detect CI/CD
  ctx.hasCI = fileExists(path.join(targetDir, '.github', 'workflows')) ||
    fileExists(path.join(targetDir, '.gitlab-ci.yml')) ||
    fileExists(path.join(targetDir, 'Jenkinsfile')) ||
    fileExists(path.join(targetDir, '.circleci'));

  // Detect Docker
  ctx.hasDocker = fileExists(path.join(targetDir, 'Dockerfile')) ||
    fileExists(path.join(targetDir, 'docker-compose.yml')) ||
    fileExists(path.join(targetDir, 'docker-compose.yaml'));

  // Detect lint
  ctx.hasLint = !!ctx.scripts.lint ||
    fileExists(path.join(targetDir, '.eslintrc')) ||
    fileExists(path.join(targetDir, '.eslintrc.js')) ||
    fileExists(path.join(targetDir, '.eslintrc.json')) ||
    fileExists(path.join(targetDir, 'eslint.config.js')) ||
    fileExists(path.join(targetDir, '.prettierrc'));

  // Detect env files
  const envCandidates = ['.env', '.env.local', '.env.development', '.env.production', '.env.example'];
  for (const f of envCandidates) {
    if (fileExists(path.join(targetDir, f))) ctx.envFiles.push(f);
  }

  // Detect lock files
  const lockCandidates = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', 'go.sum'];
  for (const f of lockCandidates) {
    if (fileExists(path.join(targetDir, f))) ctx.lockFiles.push(f);
  }

  // Git info
  try {
    ctx.gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, encoding: 'utf8', timeout: 5000 }).trim();
  } catch {}
  try {
    const status = execSync('git status --porcelain', { cwd: targetDir, encoding: 'utf8', timeout: 5000 }).trim();
    ctx.gitStatus = status === '' ? 'clean' : 'dirty';
  } catch { ctx.gitStatus = 'not-a-repo'; }
  try {
    const log = execSync('git log --oneline -5', { cwd: targetDir, encoding: 'utf8', timeout: 5000 }).trim();
    ctx.recentCommits = log ? log.split('\n') : [];
  } catch {}

  // File tree (top 2 levels, excluding node_modules/.git)
  try {
    ctx.fileTree = buildFileTree(targetDir, 2);
  } catch {}

  // Count source files
  try {
    const exts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.dart'];
    const output = execSync(
      `find . -maxdepth 4 -type f \\( ${exts.map(e => `-name "*${e}"`).join(' -o ')} \\) ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" | head -500 | wc -l`,
      { cwd: targetDir, encoding: 'utf8', timeout: 10000 }
    ).trim();
    ctx.totalFiles = parseInt(output, 10) || 0;
  } catch {
    // Windows fallback
    try {
      const output = execSync(
        `cmd /c "dir /s /b *.js *.ts *.jsx *.tsx *.py 2>nul | find /c /v """`,
        { cwd: targetDir, encoding: 'utf8', timeout: 10000 }
      ).trim();
      ctx.totalFiles = parseInt(output, 10) || 0;
    } catch {}
  }

  return ctx;
}

/**
 * Build a file tree representation (directories only, 2 levels deep).
 */
function buildFileTree(dir, maxDepth, depth = 0) {
  if (depth >= maxDepth) return {};
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.venv', 'venv', '.yuva', '.session']);
  const tree = {};
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      if (entry.isDirectory()) {
        const subPath = path.join(dir, entry.name);
        const children = buildFileTree(subPath, maxDepth, depth + 1);
        tree[entry.name + '/'] = children;
      }
    }
  } catch {}
  return tree;
}

/**
 * Format a project context scan as a readable markdown section
 * for injection into agent prompts.
 */
function formatContextForPrompt(ctx) {
  const lines = [];
  lines.push('## Project Context (auto-detected)');
  lines.push('');
  lines.push(`- **Root:** ${ctx.rootDir}`);
  if (ctx.languages.length) lines.push(`- **Languages:** ${ctx.languages.join(', ')}`);
  if (ctx.frameworks.length) lines.push(`- **Frameworks:** ${ctx.frameworks.join(', ')}`);
  if (ctx.packageManager) lines.push(`- **Package Manager:** ${ctx.packageManager}`);
  if (ctx.hasTypeScript) lines.push(`- **TypeScript:** yes`);
  lines.push(`- **Source Files:** ~${ctx.totalFiles} files`);
  if (ctx.srcDirs.length) lines.push(`- **Source Dirs:** ${ctx.srcDirs.join(', ')}`);
  if (ctx.testDirs.length) lines.push(`- **Test Dirs:** ${ctx.testDirs.join(', ')}`);
  if (ctx.hasTests) lines.push(`- **Has Tests:** yes`);
  if (ctx.hasLint) lines.push(`- **Has Lint:** yes`);
  if (ctx.hasCI) lines.push(`- **Has CI/CD:** yes`);
  if (ctx.hasDocker) lines.push(`- **Has Docker:** yes`);
  if (ctx.gitBranch) lines.push(`- **Git Branch:** ${ctx.gitBranch}`);
  lines.push(`- **Git Status:** ${ctx.gitStatus}`);
  if (ctx.recentCommits.length) {
    lines.push(`- **Recent Commits:**`);
    for (const c of ctx.recentCommits.slice(0, 3)) lines.push(`  - ${c}`);
  }
  if (ctx.envFiles.length) lines.push(`- **Env Files:** ${ctx.envFiles.join(', ')} (NEVER read or expose these)`);
  lines.push('');

  // Key scripts
  const keyScripts = ['start', 'dev', 'build', 'test', 'lint', 'typecheck', 'deploy', 'db:migrate', 'db:seed'];
  const relevantScripts = keyScripts.filter(s => ctx.scripts[s]);
  if (relevantScripts.length) {
    lines.push('### Key Scripts');
    for (const s of relevantScripts) {
      lines.push(`- \`npm run ${s}\` → \`${ctx.scripts[s]}\``);
    }
    lines.push('');
  }

  // Quality gates
  const gates = detectGates(ctx.rootDir);
  if (gates.length) {
    lines.push('### Quality Gates (enforced — work is NOT done until these pass)');
    for (const g of gates) {
      lines.push(`- **${g.name}:** \`${g.command}\``);
    }
    lines.push('');
  }

  // File tree
  if (Object.keys(ctx.fileTree).length) {
    lines.push('### Project Structure');
    lines.push('```');
    lines.push(formatTree(ctx.fileTree, ''));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function formatTree(tree, prefix) {
  const lines = [];
  const entries = Object.entries(tree);
  entries.forEach(([name, children], i) => {
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    lines.push(`${prefix}${connector}${name}`);
    if (children && typeof children === 'object' && Object.keys(children).length > 0) {
      const subPrefix = prefix + (isLast ? '    ' : '│   ');
      lines.push(formatTree(children, subPrefix));
    }
  });
  return lines.join('\n');
}

/**
 * Inject dynamic context into an agent prompt.
 * Replaces {{CONTEXT}} placeholders with live project state.
 */
function injectContext(prompt, targetDir, extraContext = {}) {
  const ctx = scanProject(targetDir);
  const contextBlock = formatContextForPrompt(ctx);

  let result = prompt;

  // Replace {{CONTEXT}} with full project scan
  result = result.replace(/\{\{CONTEXT\}\}/g, contextBlock);

  // Replace individual placeholders
  result = result.replace(/\{\{LANGUAGES\}\}/g, ctx.languages.join(', ') || 'unknown');
  result = result.replace(/\{\{FRAMEWORKS\}\}/g, ctx.frameworks.join(', ') || 'none detected');
  result = result.replace(/\{\{GIT_BRANCH\}\}/g, ctx.gitBranch || 'unknown');
  result = result.replace(/\{\{GIT_STATUS\}\}/g, ctx.gitStatus);
  result = result.replace(/\{\{PROJECT_ROOT\}\}/g, ctx.rootDir);
  result = result.replace(/\{\{PACKAGE_MANAGER\}\}/g, ctx.packageManager || 'npm');
  result = result.replace(/\{\{FILE_COUNT\}\}/g, String(ctx.totalFiles));

  // Inject extra context (task-specific)
  for (const [key, value] of Object.entries(extraContext)) {
    result = result.replace(new RegExp(`\\{\\{${key.toUpperCase()}\\}\\}`, 'g'), String(value));
  }

  // Append context block if prompt has {{PROJECT_SCAN}} marker
  if (result.includes('{{PROJECT_SCAN}}')) {
    result = result.replace(/\{\{PROJECT_SCAN\}\}/g, contextBlock);
  }

  return { prompt: result, context: ctx };
}

module.exports = { scanProject, formatContextForPrompt, injectContext, buildFileTree };
