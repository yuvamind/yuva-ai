/**
 * The subset of an agent tool call this module inspects. The index signature is
 * deliberate: these objects arrive as JSON from whichever AI CLI is driving, so
 * the real payload carries many more keys than the four read here, and the shape
 * differs per tool (Write/Edit/MultiEdit/NotebookEdit).
 */
export interface EditEntry {
  new_string?: unknown;
}

export interface ToolInput {
  file_path?: string;
  notebook_path?: string;
  content?: unknown;
  new_string?: unknown;
  edits?: EditEntry[];
  /** Bash tool: the command line to run. */
  command?: string;
  [key: string]: unknown;
}

const path = require('path') as typeof import('path');

/**
 * Single source of truth for what an AI worker must never touch — used both
 * to generate the human-readable warning in worker boot prompts AND to
 * actually enforce it via the Claude Code PreToolUse hook (lib/commands/hook.js).
 * Without this, "protected files" is just a promise the AI can ignore.
 */

// Internal plumbing directories: task bus, session state, agent config, and
// the AI tool's own config (including this enforcement hook itself). Workers
// interact with these only through yuva's own commands, never by writing
// into them directly — otherwise they could silently corrupt the bus or
// disable the hook that's supposed to constrain them.
const PROTECTED_DIRS = ['.yuva', '.session', '.aiautomations', '.claude', '.cursor'];

// Docs that may be edited freely, but must never be deleted or emptied.
const PROTECTED_DOCS = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

const FORBIDDEN_COMMANDS = [
  { pattern: /\byuva\s+swarm\s+clear\b/i, reason: '"yuva swarm clear" wipes the shared task bus' },
  { pattern: /\byuva\s+session\s+clear\b/i, reason: '"yuva session clear" wipes session state' },
];

const DELETE_VERBS = /\b(rm|rmdir|rd|del|erase|Remove-Item)\b/i;
const MOVE_VERBS = /\b(mv|move|Move-Item)\b/i;

function protectedFilesSummary() {
  const dirs = PROTECTED_DIRS.map(d => `${d}/`).join(', ');
  const docs = PROTECTED_DOCS.join(', ');
  return `${dirs}, ${docs} (or any AI config file)`;
}

function toRelPosix(filePath: string, cwd: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  return path.relative(cwd, abs).split(path.sep).join('/');
}

function isInProtectedDir(relPath: string): boolean {
  return PROTECTED_DIRS.some(dir => relPath === dir || relPath.startsWith(`${dir}/`));
}

function isProtectedDoc(relPath: string): boolean {
  return PROTECTED_DOCS.includes(relPath) || PROTECTED_DOCS.includes(path.basename(relPath));
}

function isEmptyingWrite(toolName: string | undefined, toolInput: ToolInput | null | undefined): boolean {
  if (!toolInput) return false;
  if (toolName === 'Write') {
    return toolInput.content !== undefined && !String(toolInput.content).trim();
  }
  if (toolName === 'Edit') {
    return toolInput.new_string !== undefined && !String(toolInput.new_string).trim();
  }
  if (toolName === 'MultiEdit' && Array.isArray(toolInput.edits)) {
    return toolInput.edits.some((e: EditEntry) => e.new_string !== undefined && !String(e.new_string).trim());
  }
  return false;
}

/** Check a file-touching tool call (Write/Edit/MultiEdit/NotebookEdit). Returns a block reason, or null to allow. */
function checkFileOp(toolName: string | undefined, toolInput: ToolInput | null | undefined, cwd: string): string | null {
  const filePath = toolInput && (toolInput.file_path || toolInput.notebook_path);
  if (!filePath) return null;
  const rel = toRelPosix(String(filePath), cwd);

  if (isInProtectedDir(rel)) {
    return `"${rel}" is inside a protected yuva-ai directory (task bus, session state, agent config, or AI tool config). Use the yuva CLI instead of editing it directly.`;
  }
  if (isProtectedDoc(rel) && isEmptyingWrite(toolName, toolInput)) {
    return `"${rel}" is a protected project doc — it may be edited but never emptied or deleted.`;
  }
  return null;
}

/**
 * Check a Bash command. Heuristic, not a full shell parser: looks for a
 * destructive verb (rm/mv/del/...) alongside a token matching a protected
 * path. Good enough to catch the obvious cases; not a substitute for the
 * directory/doc protection in checkFileOp, which is exact.
 */
function checkBashCommand(command: string | null | undefined): string | null {
  if (!command || typeof command !== 'string') return null;

  for (const { pattern, reason } of FORBIDDEN_COMMANDS) {
    if (pattern.test(command)) return reason;
  }

  const isDelete = DELETE_VERBS.test(command);
  const isMove = MOVE_VERBS.test(command);
  if (!isDelete && !isMove) return null;

  const tokens = command.split(/\s+/).map(t => t.replace(/^["']|["']$/g, '').replace(/\/+$/, ''));
  const protectedNames = [...PROTECTED_DIRS, ...PROTECTED_DOCS];
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^\.\//, '');
    for (const name of protectedNames) {
      if (token === name || token.startsWith(`${name}/`)) {
        return `command appears to ${isDelete ? 'delete' : 'move'} protected path "${name}" — blocked.`;
      }
    }
  }
  return null;
}

export {
  PROTECTED_DIRS,
  PROTECTED_DOCS,
  FORBIDDEN_COMMANDS,
  protectedFilesSummary,
  checkFileOp,
  checkBashCommand,
};