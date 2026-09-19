const path = require('path');
const { checkFileOp, checkBashCommand, protectedFilesSummary } = require('../lib/enforcement-rules');

const cwd = path.join('C:', 'project');

describe('checkFileOp()', () => {
  it('blocks writes inside protected directories', () => {
    expect(checkFileOp('Write', { file_path: '.yuva/run/loop.json' }, cwd)).toMatch(/protected yuva-ai directory/);
    expect(checkFileOp('Edit', { file_path: '.session/state.md' }, cwd)).toMatch(/protected yuva-ai directory/);
    expect(checkFileOp('Write', { file_path: '.claude/settings.json' }, cwd)).toMatch(/protected yuva-ai directory/);
  });

  it('blocks nested files inside protected directories', () => {
    expect(checkFileOp('Write', { file_path: '.aiautomations/prompts/executor.md' }, cwd)).toMatch(/protected/);
  });

  it('allows normal edits to protected docs', () => {
    expect(checkFileOp('Edit', { file_path: 'CLAUDE.md', new_string: 'updated instructions' }, cwd)).toBeNull();
    expect(checkFileOp('Write', { file_path: 'AGENTS.md', content: 'real content here' }, cwd)).toBeNull();
  });

  it('blocks emptying a protected doc via Write', () => {
    expect(checkFileOp('Write', { file_path: 'CLAUDE.md', content: '' }, cwd)).toMatch(/never emptied or deleted/);
    expect(checkFileOp('Write', { file_path: 'CLAUDE.md', content: '   ' }, cwd)).toMatch(/never emptied or deleted/);
  });

  it('blocks emptying a protected doc via Edit', () => {
    expect(checkFileOp('Edit', { file_path: 'GEMINI.md', new_string: '' }, cwd)).toMatch(/never emptied or deleted/);
  });

  it('blocks emptying a protected doc via MultiEdit', () => {
    expect(checkFileOp('MultiEdit', { file_path: 'AGENTS.md', edits: [{ new_string: 'ok' }, { new_string: '' }] }, cwd))
      .toMatch(/never emptied or deleted/);
  });

  it('allows unrelated files', () => {
    expect(checkFileOp('Write', { file_path: 'src/index.js', content: '' }, cwd)).toBeNull();
    expect(checkFileOp('Edit', { file_path: 'README.md', new_string: '' }, cwd)).toBeNull();
  });

  it('is a no-op when there is no file path', () => {
    expect(checkFileOp('Write', {}, cwd)).toBeNull();
  });
});

describe('checkBashCommand()', () => {
  it('blocks yuva swarm clear and yuva session clear', () => {
    expect(checkBashCommand('yuva swarm clear')).toMatch(/wipes the shared task bus/);
    expect(checkBashCommand('yuva session clear')).toMatch(/wipes session state/);
  });

  it('blocks deleting a protected directory', () => {
    expect(checkBashCommand('rm -rf .yuva')).toMatch(/delete protected path/);
    expect(checkBashCommand('rm -rf ./.session')).toMatch(/delete protected path/);
  });

  it('blocks moving a protected doc', () => {
    expect(checkBashCommand('mv CLAUDE.md /tmp/backup.md')).toMatch(/move protected path/);
  });

  it('allows normal deletes unrelated to protected paths', () => {
    expect(checkBashCommand('rm -rf node_modules')).toBeNull();
    expect(checkBashCommand('rm build/output.log')).toBeNull();
  });

  it('allows reading or editing files inside protected dirs via non-destructive commands', () => {
    expect(checkBashCommand('cat .yuva/run/loop.json')).toBeNull();
  });

  it('is a no-op for empty or missing commands', () => {
    expect(checkBashCommand('')).toBeNull();
    expect(checkBashCommand(undefined)).toBeNull();
  });
});

describe('protectedFilesSummary()', () => {
  it('contains no double quotes (embedded in shell-passed prompts)', () => {
    expect(protectedFilesSummary()).not.toContain('"');
  });

  it('mentions the key protected paths', () => {
    const summary = protectedFilesSummary();
    expect(summary).toContain('.yuva/');
    expect(summary).toContain('CLAUDE.md');
  });
});
