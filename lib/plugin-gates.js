const fs = require('fs');
const path = require('path');
const { readJSON, fileExists } = require('./fs-utils');

/**
 * Plugin-based gate system.
 * Beyond simple shell commands, allows rule-based gates that analyze
 * code patterns, structure, and conventions.
 */

// Built-in gate rules
const BUILTIN_RULES = {
  'no-console-log': {
    name: 'No console.log in production',
    description: 'Detects console.log statements in source files',
    severity: 'warning',
    run(targetDir) {
      const findings = [];
      const srcDirs = ['src', 'lib', 'app', 'pages', 'api', 'server'];
      const exts = ['.js', '.ts', '.jsx', '.tsx'];
      const ignore = new Set(['node_modules', '.git', 'dist', 'build', 'test', 'tests']);

      for (const dir of srcDirs) {
        const fullDir = path.join(targetDir, dir);
        if (!fs.existsSync(fullDir)) continue;
        walkDir(fullDir, exts, ignore, (filePath, content) => {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (/console\.(log|debug|info)\s*\(/.test(lines[i]) && !lines[i].trim().startsWith('//')) {
              findings.push({
                file: path.relative(targetDir, filePath),
                line: i + 1,
                message: 'console.log/debug/info found — use a logger library',
              });
            }
          }
        });
      }
      return findings;
    },
  },

  'no-todo-fixme': {
    name: 'No TODO/FIXME in production',
    description: 'Detects TODO/FIXME/HACK comments',
    severity: 'info',
    run(targetDir) {
      const findings = [];
      const exts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs'];
      const ignore = new Set(['node_modules', '.git', 'dist', 'build']);

      walkDir(targetDir, exts, ignore, (filePath, content) => {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/(?:TODO|FIXME|HACK|XXX)[:\s]*(.*)/i);
          if (match) {
            findings.push({
              file: path.relative(targetDir, filePath),
              line: i + 1,
              message: match[0].trim().slice(0, 100),
            });
          }
        }
      });
      return findings;
    },
  },

  'require-jsdoc-exports': {
    name: 'JSDoc on exports',
    description: 'Checks that exported functions have JSDoc comments',
    severity: 'info',
    run(targetDir) {
      const findings = [];
      const srcDirs = ['src', 'lib'];
      const exts = ['.js', '.ts'];
      const ignore = new Set(['node_modules', '.git', 'dist', 'build', 'test', 'tests']);

      for (const dir of srcDirs) {
        const fullDir = path.join(targetDir, dir);
        if (!fs.existsSync(fullDir)) continue;
        walkDir(fullDir, exts, ignore, (filePath, content) => {
          const lines = content.split('\n');
          for (let i = 1; i < lines.length; i++) {
            if (/^export\s+(?:default\s+)?(?:async\s+)?function\s+\w+/.test(lines[i]) ||
                /^module\.exports/.test(lines[i])) {
              // Check if previous line is a JSDoc closing
              if (i > 0 && !lines[i - 1].trim().endsWith('*/')) {
                const match = lines[i].match(/function\s+(\w+)/);
                findings.push({
                  file: path.relative(targetDir, filePath),
                  line: i + 1,
                  message: `Exported function \`${match ? match[1] : 'unknown'}\` missing JSDoc comment`,
                });
              }
            }
          }
        });
      }
      return findings;
    },
  },

  'no-unused-deps': {
    name: 'No unused dependencies',
    description: 'Checks for dependencies not imported anywhere in source',
    severity: 'warning',
    run(targetDir) {
      const findings = [];
      const pkgPath = path.join(targetDir, 'package.json');
      if (!fileExists(pkgPath)) return findings;

      const pkg = readJSON(pkgPath);
      if (!pkg || !pkg.dependencies) return findings;

      const srcDirs = ['src', 'lib', 'app', 'pages', 'api'];
      const allSource = [];
      const exts = ['.js', '.ts', '.jsx', '.tsx'];
      const ignore = new Set(['node_modules', '.git', 'dist', 'build']);

      for (const dir of srcDirs) {
        const fullDir = path.join(targetDir, dir);
        if (!fs.existsSync(fullDir)) continue;
        walkDir(fullDir, exts, ignore, (filePath, content) => {
          allSource.push(content);
        });
      }

      const combined = allSource.join('\n');
      for (const dep of Object.keys(pkg.dependencies)) {
        // Check if the dependency is imported/required anywhere
        const pattern = new RegExp(`(?:require\\s*\\(\\s*['"]${dep}['"]|from\\s+['"]${dep})`);
        if (!pattern.test(combined)) {
          findings.push({
            file: 'package.json',
            line: 0,
            message: `Dependency \`${dep}\` appears unused — not imported in any source file`,
          });
        }
      }
      return findings;
    },
  },

  'env-example-sync': {
    name: '.env.example sync',
    description: 'Checks that all used env vars are documented in .env.example',
    severity: 'warning',
    run(targetDir) {
      const findings = [];
      const envExamplePath = path.join(targetDir, '.env.example');
      const envPath = path.join(targetDir, '.env');

      // Find all process.env.X references
      const usedVars = new Set();
      const exts = ['.js', '.ts', '.jsx', '.tsx'];
      const ignore = new Set(['node_modules', '.git', 'dist', 'build']);
      walkDir(targetDir, exts, ignore, (filePath, content) => {
        const matches = content.matchAll(/process\.env\.(\w+)/g);
        for (const m of matches) usedVars.add(m[1]);
      });

      if (usedVars.size === 0) return findings;

      // Check .env.example
      let documented = new Set();
      if (fileExists(envExamplePath)) {
        const content = fs.readFileSync(envExamplePath, 'utf8');
        const matches = content.matchAll(/^(\w+)=/gm);
        for (const m of matches) documented.add(m[1]);
      }

      for (const v of usedVars) {
        if (!documented.has(v)) {
          findings.push({
            file: '.env.example',
            line: 0,
            message: `Environment variable \`${v}\` is used in code but not documented in .env.example`,
          });
        }
      }
      return findings;
    },
  },
};

function walkDir(dir, exts, ignore, callback) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, exts, ignore, callback);
      } else if (exts.includes(path.extname(entry.name))) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          callback(fullPath, content);
        } catch {}
      }
    }
  } catch {}
}

/**
 * Run all enabled plugin gates.
 * Gates are configured in .aiautomations/config.json:
 *   { "pluginGates": { "no-console-log": true, "no-todo-fixme": false } }
 *
 * Custom rules can be added in .aiautomations/gates/<name>.js
 */
function runPluginGates(targetDir) {
  const configPath = path.join(targetDir, '.aiautomations', 'config.json');
  const config = readJSON(configPath) || {};
  const gateConfig = config.pluginGates || {};

  const results = [];

  // Run built-in rules that are enabled (or not explicitly disabled)
  for (const [ruleId, rule] of Object.entries(BUILTIN_RULES)) {
    const enabled = gateConfig[ruleId] !== false; // default: enabled
    if (!enabled) continue;

    const findings = rule.run(targetDir);
    results.push({
      id: ruleId,
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      passed: findings.length === 0,
      findings: findings.slice(0, 20), // cap
      totalFindings: findings.length,
    });
  }

  // Load custom rules from .aiautomations/gates/
  const gatesDir = path.join(targetDir, '.aiautomations', 'gates');
  if (fs.existsSync(gatesDir)) {
    const customFiles = fs.readdirSync(gatesDir).filter(f => f.endsWith('.js'));
    for (const f of customFiles) {
      const ruleId = f.replace('.js', '');
      if (gateConfig[ruleId] === false) continue;

      try {
        const rule = require(path.join(gatesDir, f));
        if (typeof rule.run === 'function') {
          const findings = rule.run(targetDir);
          results.push({
            id: ruleId,
            name: rule.name || ruleId,
            description: rule.description || '',
            severity: rule.severity || 'warning',
            passed: Array.isArray(findings) && findings.length === 0,
            findings: Array.isArray(findings) ? findings.slice(0, 20) : [],
            totalFindings: Array.isArray(findings) ? findings.length : 0,
          });
        }
      } catch (err) {
        results.push({
          id: ruleId,
          name: ruleId,
          severity: 'error',
          passed: false,
          findings: [{ message: `Failed to load: ${err.message}` }],
          totalFindings: 1,
        });
      }
    }
  }

  const allPassed = results.every(r => r.passed);
  return { passed: allPassed, gates: results };
}

/**
 * Format plugin gate results as markdown.
 */
function formatPluginGates(result) {
  const lines = [];
  lines.push('## Plugin Gate Results');
  lines.push('');

  for (const gate of result.gates) {
    const icon = gate.passed ? '✅' : '❌';
    lines.push(`${icon} **${gate.name}** — ${gate.findings.length} finding(s)`);
    if (!gate.passed && gate.findings.length > 0) {
      for (const f of gate.findings.slice(0, 5)) {
        const loc = f.file ? `${f.file}:${f.line}` : '';
        lines.push(`   - ${loc} ${f.message}`);
      }
      if (gate.totalFindings > 5) {
        lines.push(`   - ... and ${gate.totalFindings - 5} more`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = { BUILTIN_RULES, runPluginGates, formatPluginGates, walkDir };
