const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Real code analysis — not just "does package.json exist" but actual
 * understanding of the codebase structure, complexity, and patterns.
 */

/**
 * Analyze source files in the project. Returns structured insights.
 * Works without AST parsers by using regex patterns + file structure analysis.
 */
function analyzeCodebase(targetDir) {
  const result = {
    modules: [],
    exports: {},
    imports: {},
    patterns: [],
    complexity: { total: 0, byFile: [] },
    apiRoutes: [],
    components: [],
    databaseModels: [],
    envVars: [],
    testCoverage: { testFiles: 0, sourceFiles: 0, ratio: 0 },
  };

  const srcDirs = ['src', 'lib', 'app', 'pages', 'api', 'server', 'cmd', 'internal'];
  const codeExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java'];

  // Collect all source files
  const sourceFiles = [];
  for (const dir of srcDirs) {
    const fullDir = path.join(targetDir, dir);
    if (!fs.existsSync(fullDir)) continue;
    collectFiles(fullDir, codeExts, sourceFiles, 0, 10);
  }

  // Also collect root-level source files
  try {
    const rootFiles = fs.readdirSync(targetDir).filter(f => {
      const ext = path.extname(f);
      return codeExts.includes(ext) && !f.startsWith('.');
    });
    for (const f of rootFiles) sourceFiles.push(path.join(targetDir, f));
  } catch {}

  // Analyze each file
  for (const filePath of sourceFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const ext = path.extname(filePath);
      const relPath = path.relative(targetDir, filePath).replace(/\\/g, '/');

      // Detect exports
      const exports = detectExports(content, ext);
      if (exports.length > 0) {
        result.exports[relPath] = exports;
      }

      // Detect imports
      const imports = detectImports(content, ext);
      if (imports.length > 0) {
        result.imports[relPath] = imports;
      }

      // Detect API routes
      const routes = detectAPIRoutes(content, ext, relPath);
      result.apiRoutes.push(...routes);

      // Detect React components
      if (['.jsx', '.tsx', '.js', '.ts'].includes(ext)) {
        const components = detectComponents(content, relPath);
        result.components.push(...components);
      }

      // Detect database models
      const models = detectDBModels(content, ext, relPath);
      result.databaseModels.push(...models);

      // Detect env var usage
      const envVars = detectEnvVars(content, ext);
      result.envVars.push(...envVars);

      // Simple complexity score (lines + nesting depth + branches)
      const complexity = estimateComplexity(content);
      result.complexity.total += complexity;
      if (complexity > 50) {
        result.complexity.byFile.push({ file: relPath, score: complexity });
      }

      result.modules.push(relPath);
    } catch {}
  }

  // Dedupe
  result.envVars = [...new Set(result.envVars)];
  result.apiRoutes = dedupeBy(result.apiRoutes, r => `${r.method}:${r.path}`);
  result.components = dedupeBy(result.components, c => c.name);
  result.databaseModels = dedupeBy(result.databaseModels, m => m.name);
  result.complexity.byFile.sort((a, b) => b.score - a.score);

  // Test coverage ratio
  const testFiles = sourceFiles.filter(f => {
    const rel = path.relative(targetDir, f).replace(/\\/g, '/');
    return /(?:test|spec|__tests__)/.test(rel) || /\.(test|spec)\./.test(path.basename(f));
  });
  result.testCoverage = {
    testFiles: testFiles.length,
    sourceFiles: sourceFiles.length,
    ratio: sourceFiles.length > 0 ? Math.round((testFiles.length / sourceFiles.length) * 100) : 0,
  };

  return result;
}

function collectFiles(dir, exts, results, depth, maxDepth) {
  if (depth >= maxDepth) return;
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.yuva', '__pycache__', '.venv', 'venv']);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath, exts, results, depth + 1, maxDepth);
      } else if (exts.includes(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  } catch {}
}

function detectExports(content, ext) {
  const exports = [];
  if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
    // module.exports, exports.X, export default, export const/function/class
    const patterns = [
      /module\.exports\s*=\s*(\w+)/g,
      /exports\.(\w+)\s*=/g,
      /export\s+default\s+(?:class|function)?\s*(\w+)?/g,
      /export\s+(?:const|let|var|function|class|async\s+function)\s+(\w+)/g,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        if (m[1]) exports.push(m[1]);
      }
    }
  } else if (ext === '.py') {
    const patterns = [
      /def\s+(\w+)\s*\(/g,
      /class\s+(\w+)/g,
    ];
    // Only top-level definitions (rough heuristic)
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        exports.push(m[1]);
      }
    }
  }
  return [...new Set(exports)].slice(0, 30);
}

function detectImports(content, ext) {
  const imports = [];
  if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
    const patterns = [
      /require\s*\(\s*['"]([^'".][^'"]*)['"]\s*\)/g,
      /from\s+['"]([^'".][^'"]*)['"]/g,
      /import\s+['"]([^'".][^'"]*)['"]/g,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        const pkg = m[1].split('/')[0];
        if (!imports.includes(pkg)) imports.push(pkg);
      }
    }
  }
  return imports.slice(0, 30);
}

function detectAPIRoutes(content, ext, relPath) {
  const routes = [];
  if (['.js', '.ts'].includes(ext)) {
    // Express/Fastify/Hono/Koa patterns
    const patterns = [
      /\.(get|post|put|patch|delete|all)\s*\(\s*['"]([^'"]+)['"]/g,
      /router\.(get|post|put|patch|delete|all)\s*\(\s*['"]([^'"]+)['"]/g,
      /app\.(get|post|put|patch|delete|all)\s*\(\s*['"]([^'"]+)['"]/g,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        routes.push({ method: m[1].toUpperCase(), path: m[2], file: relPath });
      }
    }
    // Next.js App Router: export async function GET/POST/etc
    const nextPatterns = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
    let m;
    while ((m = nextPatterns.exec(content)) !== null) {
      routes.push({ method: m[1], path: relPath.replace(/\/route\.(js|ts)$/, ''), file: relPath });
    }
  } else if (ext === '.py') {
    // FastAPI/Flask patterns
    const patterns = [
      /@(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        routes.push({ method: m[1].toUpperCase(), path: m[2], file: relPath });
      }
    }
  }
  return routes;
}

function detectComponents(content, relPath) {
  const components = [];
  // React function components
  const patterns = [
    /export\s+(?:default\s+)?(?:function|const)\s+(\w+)\s*(?:=\s*(?:\([^)]*\)|React\.FC))?(?:\s*\(\s*(?:\{[^}]*\}|props)\s*\))?/g,
    /function\s+(\w+)\s*\(\s*(?:\{[^}]*\}|props)\s*\)/g,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(content)) !== null) {
      // Heuristic: React components start with uppercase
      if (m[1] && m[1][0] === m[1][0].toUpperCase() && m[1][0] !== m[1][0].toLowerCase()) {
        components.push({ name: m[1], file: relPath });
      }
    }
  }
  return components.slice(0, 20);
}

function detectDBModels(content, ext, relPath) {
  const models = [];
  if (['.js', '.ts'].includes(ext)) {
    // Mongoose, Sequelize, Prisma patterns
    const patterns = [
      /(?:mongoose\.model|model)\s*\(\s*['"](\w+)['"]/g,
      /@Entity\s*\(\s*['"]?(\w+)?['"]?\s*\)/g,
      /class\s+(\w+)\s+extends\s+(?:Model|Entity)/g,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        if (m[1]) models.push({ name: m[1], file: relPath });
      }
    }
  } else if (ext === '.py') {
    // Django, SQLAlchemy
    const patterns = [
      /class\s+(\w+)\s*\(.*?(?:Model|Base)\)/g,
    ];
    for (const pat of patterns) {
      let m;
      while ((m = pat.exec(content)) !== null) {
        models.push({ name: m[1], file: relPath });
      }
    }
  }
  return models;
}

function detectEnvVars(content, ext) {
  const vars = [];
  const patterns = [
    /process\.env\.(\w+)/g,
    /os\.environ\.(?:get\()?['"]?(\w+)/g,
    /os\.getenv\(\s*['"](\w+)/g,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(content)) !== null) {
      vars.push(m[1]);
    }
  }
  return vars;
}

function estimateComplexity(content) {
  const lines = content.split('\n');
  let score = 0;
  score += Math.min(lines.length, 500); // base: line count (capped)

  // Count branching/looping constructs
  const branchPatterns = /\b(if|else|switch|case|for|while|do|try|catch|\?\?|\?\.|&&|\|\|)\b/g;
  const matches = content.match(branchPatterns);
  score += (matches ? matches.length : 0) * 2;

  // Count nesting depth (rough: max indent level)
  let maxIndent = 0;
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)[1].length;
    if (indent > maxIndent) maxIndent = indent;
  }
  score += Math.floor(maxIndent / 2) * 3;

  return score;
}

function dedupeBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Format analysis results as a readable markdown section.
 */
function formatAnalysis(analysis) {
  const lines = [];
  lines.push('### Codebase Analysis');
  lines.push('');
  lines.push(`- **Source Modules:** ${analysis.modules.length}`);
  lines.push(`- **API Routes:** ${analysis.apiRoutes.length}`);
  lines.push(`- **Components:** ${analysis.components.length}`);
  lines.push(`- **DB Models:** ${analysis.databaseModels.length}`);
  lines.push(`- **Env Vars Used:** ${analysis.envVars.length}`);
  lines.push(`- **Test Coverage Ratio:** ${analysis.testCoverage.ratio}% (${analysis.testCoverage.testFiles} test / ${analysis.testCoverage.sourceFiles} source)`);
  lines.push(`- **Complexity Score:** ${analysis.complexity.total}`);

  if (analysis.complexity.byFile.length > 0) {
    lines.push('');
    lines.push('**High Complexity Files:**');
    for (const f of analysis.complexity.byFile.slice(0, 5)) {
      lines.push(`- ${f.file} (score: ${f.score})`);
    }
  }

  if (analysis.apiRoutes.length > 0) {
    lines.push('');
    lines.push('**API Routes:**');
    for (const r of analysis.apiRoutes.slice(0, 15)) {
      lines.push(`- ${r.method} ${r.path} → ${r.file}`);
    }
  }

  if (analysis.databaseModels.length > 0) {
    lines.push('');
    lines.push('**Database Models:**');
    for (const m of analysis.databaseModels) {
      lines.push(`- ${m.name} → ${m.file}`);
    }
  }

  if (analysis.envVars.length > 0) {
    lines.push('');
    lines.push('**Environment Variables Required:**');
    for (const v of analysis.envVars.slice(0, 15)) {
      lines.push(`- ${v}`);
    }
  }

  return lines.join('\n');
}

module.exports = { analyzeCodebase, formatAnalysis };
