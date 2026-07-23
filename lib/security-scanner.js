const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { fileExists } = require('./fs-utils');

/**
 * Real security scanning — runs actual tools, not just checklists.
 */

/**
 * Run all available security checks and return structured results.
 */
function runSecurityScan(targetDir) {
  const findings = [];
  const tools = [];

  // 1. Dependency audit (npm audit, pip-audit, cargo audit)
  const depFindings = scanDependencies(targetDir);
  findings.push(...depFindings.findings);
  if (depFindings.tool) tools.push(depFindings.tool);

  // 2. Hardcoded secrets detection
  const secretFindings = scanForSecrets(targetDir);
  findings.push(...secretFindings);

  // 3. Dangerous patterns
  const patternFindings = scanDangerousPatterns(targetDir);
  findings.push(...patternFindings);

  // 4. Configuration issues
  const configFindings = scanConfigIssues(targetDir);
  findings.push(...configFindings);

  // 5. Env file exposure
  const envFindings = scanEnvExposure(targetDir);
  findings.push(...envFindings);

  // Sort by severity
  const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  findings.sort((a, b) => (order[a.severity] ?? 5) - (order[b.severity] ?? 5));

  const summary = {
    critical: findings.filter(f => f.severity === 'critical').length,
    high: findings.filter(f => f.severity === 'high').length,
    medium: findings.filter(f => f.severity === 'medium').length,
    low: findings.filter(f => f.severity === 'low').length,
    info: findings.filter(f => f.severity === 'info').length,
    total: findings.length,
  };

  return { findings, summary, tools };
}

function scanDependencies(targetDir) {
  const findings = [];
  let tool = null;

  // npm audit
  if (fileExists(path.join(targetDir, 'package.json'))) {
    try {
      const output = execSync('npm audit --json 2>/dev/null || true', {
        cwd: targetDir, encoding: 'utf8', timeout: 30000,
      });
      const audit = JSON.parse(output);
      if (audit.vulnerabilities) {
        tool = 'npm audit';
        for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
          const severity = vuln.severity || 'medium';
          findings.push({
            severity,
            category: 'dependency',
            title: `Vulnerable dependency: ${name}`,
            description: vuln.via ? (Array.isArray(vuln.via) ? vuln.via.map(v => typeof v === 'string' ? v : v.title).join(', ') : String(vuln.via)) : 'Known vulnerability',
            file: 'package.json',
            remediation: vuln.fixAvailable ? `Run: npm audit fix` : `Update ${name} manually`,
            tool: 'npm-audit',
          });
        }
      }
    } catch {}
  }

  // pip-audit (if available)
  if (fileExists(path.join(targetDir, 'requirements.txt')) || fileExists(path.join(targetDir, 'pyproject.toml'))) {
    try {
      const output = execSync('pip-audit --format json 2>/dev/null || true', {
        cwd: targetDir, encoding: 'utf8', timeout: 30000,
      });
      const audit = JSON.parse(output);
      if (Array.isArray(audit)) {
        tool = 'pip-audit';
        for (const vuln of audit) {
          findings.push({
            severity: 'high',
            category: 'dependency',
            title: `Vulnerable dependency: ${vuln.name}`,
            description: vuln.vulnerabilities ? vuln.vulnerabilities.map(v => v.id || v.description).join(', ') : 'Known vulnerability',
            file: 'requirements.txt',
            remediation: `Update ${vuln.name} to ${vuln.vulnerabilities?.[0]?.fix_versions?.[0] || 'latest'}`,
            tool: 'pip-audit',
          });
        }
      }
    } catch {}
  }

  return { findings, tool };
}

function scanForSecrets(targetDir) {
  const findings = [];
  const secretPatterns = [
    { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{20,}['"]/, title: 'Hardcoded API key', severity: 'critical' },
    { pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{8,}['"]/, title: 'Hardcoded secret/password', severity: 'critical' },
    { pattern: /(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{20,}/, title: 'Stripe secret key', severity: 'critical' },
    { pattern: /ghp_[A-Za-z0-9]{36}/, title: 'GitHub personal access token', severity: 'critical' },
    { pattern: /glpat-[A-Za-z0-9\-]{20}/, title: 'GitLab personal access token', severity: 'critical' },
    { pattern: /AKIA[0-9A-Z]{16}/, title: 'AWS access key ID', severity: 'critical' },
    { pattern: /(?:private[_-]?key|PRIVATE[_-]?KEY)\s*[:=]\s*['"]-----BEGIN/, title: 'Private key in code', severity: 'critical' },
    { pattern: /mongodb(?:\+srv)?:\/\/[^'"\s]+:[^'"\s]+@/, title: 'MongoDB connection string with credentials', severity: 'high' },
    { pattern: /postgres(?:ql)?:\/\/[^'"\s]+:[^'"\s]+@/, title: 'PostgreSQL connection string with credentials', severity: 'high' },
  ];

  const codeExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.env'];
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.yuva']);

  function walk(dir, depth = 0) {
    if (depth > 5) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignore.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (codeExts.includes(path.extname(entry.name))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const { pattern, title, severity } of secretPatterns) {
              if (pattern.test(content)) {
                findings.push({
                  severity,
                  category: 'secrets',
                  title,
                  description: `Found in ${path.relative(targetDir, fullPath)}`,
                  file: path.relative(targetDir, fullPath),
                  remediation: 'Move to environment variables and rotate the exposed credential',
                  tool: 'pattern-scan',
                });
                break; // one finding per file per pattern type
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  walk(targetDir);
  return findings;
}

function scanDangerousPatterns(targetDir) {
  const findings = [];
  const patterns = [
    { pattern: /eval\s*\(/, title: 'eval() usage', severity: 'high', desc: 'eval() can execute arbitrary code — use safer alternatives' },
    { pattern: /new\s+Function\s*\(/, title: 'new Function() usage', severity: 'high', desc: 'Dynamic code execution — potential code injection vector' },
    { pattern: /child_process.*exec\s*\((?!.*(?:execFile|execSync))/, title: 'Shell command execution', severity: 'medium', desc: 'Use execFile or spawn instead of exec to prevent shell injection' },
    { pattern: /innerHTML\s*=/, title: 'innerHTML assignment', severity: 'medium', desc: 'Use textContent or a sanitization library to prevent XSS' },
    { pattern: /dangerouslySetInnerHTML/, title: 'dangerouslySetInnerHTML', severity: 'medium', desc: 'Ensure content is sanitized before rendering' },
    { pattern: /document\.write\s*\(/, title: 'document.write()', severity: 'medium', desc: 'Avoid document.write — use DOM manipulation instead' },
    { pattern: /disable.*(?:ssl|tls|cert).*verif/i, title: 'SSL/TLS verification disabled', severity: 'high', desc: 'Never disable SSL verification in production' },
    { pattern: /cors\s*\(\s*\{\s*origin:\s*(?:true|\*)/, title: 'CORS wildcard origin', severity: 'medium', desc: 'Restrict CORS to specific trusted origins' },
  ];

  const codeExts = ['.js', '.ts', '.jsx', '.tsx', '.py'];
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', '.yuva', 'test', 'tests', '__tests__']);

  function walk(dir, depth = 0) {
    if (depth > 4) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (ignore.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (codeExts.includes(path.extname(entry.name))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const { pattern, title, severity, desc } of patterns) {
              if (pattern.test(content)) {
                findings.push({
                  severity,
                  category: 'pattern',
                  title,
                  description: `${desc} — found in ${path.relative(targetDir, fullPath)}`,
                  file: path.relative(targetDir, fullPath),
                  remediation: desc,
                  tool: 'pattern-scan',
                });
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  walk(targetDir);
  return findings;
}

function scanConfigIssues(targetDir) {
  const findings = [];

  // .env committed to git
  if (fileExists(path.join(targetDir, '.env'))) {
    const gitignorePath = path.join(targetDir, '.gitignore');
    if (fileExists(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      if (!gitignore.includes('.env')) {
        findings.push({
          severity: 'high',
          category: 'config',
          title: '.env file not in .gitignore',
          description: 'The .env file exists but is not gitignored — secrets may be committed',
          file: '.env',
          remediation: 'Add .env to .gitignore and rotate any exposed secrets',
          tool: 'config-scan',
        });
      }
    }
  }

  // Debug mode in production configs
  const prodConfigs = ['next.config.js', 'nuxt.config.js', 'vite.config.js', 'webpack.config.js'];
  for (const cfg of prodConfigs) {
    const cfgPath = path.join(targetDir, cfg);
    if (fileExists(cfgPath)) {
      try {
        const content = fs.readFileSync(cfgPath, 'utf8');
        if (/debug\s*:\s*true/i.test(content)) {
          findings.push({
            severity: 'medium',
            category: 'config',
            title: `Debug mode enabled in ${cfg}`,
            description: 'Debug mode should be disabled in production',
            file: cfg,
            remediation: 'Set debug: false or use environment variable to control it',
            tool: 'config-scan',
          });
        }
      } catch {}
    }
  }

  return findings;
}

function scanEnvExposure(targetDir) {
  const findings = [];
  const gitignorePath = path.join(targetDir, '.gitignore');
  let gitignore = '';
  if (fileExists(gitignorePath)) {
    gitignore = fs.readFileSync(gitignorePath, 'utf8');
  }

  const envFiles = ['.env', '.env.local', '.env.development', '.env.production', '.env.staging'];
  for (const f of envFiles) {
    if (fileExists(path.join(targetDir, f)) && !gitignore.includes(f)) {
      findings.push({
        severity: 'high',
        category: 'config',
        title: `${f} not in .gitignore`,
        description: `Environment file ${f} may be committed to version control`,
        file: f,
        remediation: `Add ${f} to .gitignore`,
        tool: 'config-scan',
      });
    }
  }

  return findings;
}

/**
 * Format security scan results as markdown.
 */
function formatSecurityReport(scan) {
  const lines = [];
  lines.push('## Security Scan Results');
  lines.push('');
  lines.push(`- **Critical:** ${scan.summary.critical}`);
  lines.push(`- **High:** ${scan.summary.high}`);
  lines.push(`- **Medium:** ${scan.summary.medium}`);
  lines.push(`- **Low:** ${scan.summary.low}`);
  lines.push(`- **Info:** ${scan.summary.info}`);
  lines.push(`- **Tools Used:** ${scan.tools.join(', ') || 'pattern scanning'}`);
  lines.push('');

  if (scan.findings.length === 0) {
    lines.push('No security issues found.');
  } else {
    for (const f of scan.findings) {
      const icon = f.severity === 'critical' ? '🔴' : f.severity === 'high' ? '🟠' : f.severity === 'medium' ? '🟡' : '🔵';
      lines.push(`### ${icon} [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push(`- **Category:** ${f.category}`);
      lines.push(`- **File:** ${f.file}`);
      lines.push(`- **Description:** ${f.description}`);
      lines.push(`- **Fix:** ${f.remediation}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = { runSecurityScan, formatSecurityReport };
