import path from 'path';
import fs from 'fs';
import * as P from './paths';
import { packageRoot } from './pkg-root';

function resolvePackagePath(): string | null {
  // 1. The package we are actually running from.
  //
  // This used to be `path.join(__dirname, '..')`, which assumed lib/ sat one
  // level below the package root. Compiled output lives at dist/lib/, so that
  // hop resolved to dist/ -- no template/ there, the check silently failed, and
  // resolution fell through to whatever GLOBAL yuva-ai install happened to
  // exist. A developer editing template/ here would have seen the global copy's
  // files instead, with no error to explain why.
  const root = packageRoot();
  if (root && fs.existsSync(path.join(root, 'template'))) {
    return root;
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

function getTemplatePath(): string | null {
  const pkg = resolvePackagePath();
  return pkg ? path.join(pkg, 'template') : null;
}

function getAgentPromptPath(agentName: string): string | null {
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

export { resolvePackagePath, getTemplatePath, getAgentPromptPath };