const path = require('path');
const fs = require('fs');
const P = require('./paths');

function resolvePackagePath() {
  // 1. Check if running from source (development)
  const localTemplate = path.join(__dirname, '..', 'template');
  if (fs.existsSync(localTemplate)) {
    return path.join(__dirname, '..');
  }

  // 2. Check config.json for stored path
  const configPath = P.configFile(process.cwd());
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.packagePath && fs.existsSync(path.join(config.packagePath, 'template'))) {
        return config.packagePath;
      }
    } catch {}
  }

  // 3. Check global npm paths
  const globalPaths = require('module').globalPaths || [];
  for (const gp of globalPaths) {
    const candidate = path.join(gp, 'yuva-ai');
    if (fs.existsSync(path.join(candidate, 'template'))) {
      return candidate;
    }
  }

  // 4. Check common global install locations
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'yuva-ai'),
    path.join(process.env.HOME || '', '.npm-global', 'lib', 'node_modules', 'yuva-ai'),
    '/usr/lib/node_modules/yuva-ai',
    '/usr/local/lib/node_modules/yuva-ai',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'template'))) {
      return candidate;
    }
  }

  return null;
}

function getTemplatePath() {
  const pkg = resolvePackagePath();
  return pkg ? path.join(pkg, 'template') : null;
}

function getAgentPromptPath(agentName) {
  const templatePath = getTemplatePath();
  if (!templatePath) return null;

  const promptsDir = P.promptsDir(templatePath);
  // Try exact match first
  const exact = path.join(promptsDir, `${agentName}.md`);
  if (fs.existsSync(exact)) return exact;

  // Try with 'agent' suffix
  const withSuffix = path.join(promptsDir, `${agentName}agent.md`);
  if (fs.existsSync(withSuffix)) return withSuffix;

  return null;
}

module.exports = { resolvePackagePath, getTemplatePath, getAgentPromptPath };
