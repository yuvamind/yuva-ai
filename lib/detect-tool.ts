import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

function commandExists(cmd: string): boolean {
  const isWin = process.platform === 'win32';
  const probe = isWin ? 'where' : 'which';
  try {
    return spawnSync(probe, [cmd], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function detectTool(targetDir: string): string {
  // 1. Check environment variables for IDE
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_SESSION) return 'cursor';
  if (process.env.VSCODE_GIT_ASKPASS_MAIN) return 'claude';
  if (process.env.CODEX_ENV) return 'codex';

  // 2. Check existing config files in project
  const configChecks = [
    { file: '.cursor/rules', tool: 'cursor' },
    { file: '.github/copilot-instructions.md', tool: 'copilot' },
    { file: '.windsurfrules', tool: 'windsurf' },
    { file: '.kilo/instructions.md', tool: 'kilo-code' },
    { file: '.sourcegraph/instructions.md', tool: 'cody' },
    { file: '.amazonq/instructions.md', tool: 'amazon-q' },
    { file: '.continue/instructions.md', tool: 'continue' },
    { file: '.aider.conf.yml', tool: 'aider' },
  ];
  for (const { file, tool } of configChecks) {
    if (fs.existsSync(path.join(targetDir, file))) return tool;
  }

  // 3. Check installed CLIs
  const cliChecks = [
    { cmd: 'agy', tool: 'antigravity' },
    { cmd: 'claude', tool: 'claude' },
    { cmd: 'opencode', tool: 'opencode' },
    { cmd: 'codex', tool: 'codex' },
    { cmd: 'aider', tool: 'aider' },
    { cmd: 'ollama', tool: 'ollama' },
  ];
  for (const { cmd, tool } of cliChecks) {
    if (commandExists(cmd)) return tool;
  }

  // 4. Fallback
  return 'claude';
}

export { detectTool, commandExists };