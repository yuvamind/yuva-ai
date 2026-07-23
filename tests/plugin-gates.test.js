const fs = require('fs');
const path = require('path');
const os = require('os');
const { runPluginGates, formatPluginGates, BUILTIN_RULES } = require('../lib/plugin-gates');

describe('PluginGates', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('BUILTIN_RULES', () => {
    it('should have expected rules', () => {
      expect(BUILTIN_RULES).toHaveProperty('no-console-log');
      expect(BUILTIN_RULES).toHaveProperty('no-todo-fixme');
      expect(BUILTIN_RULES).toHaveProperty('no-unused-deps');
      expect(BUILTIN_RULES).toHaveProperty('env-example-sync');
    });
  });

  describe('no-console-log rule', () => {
    it('should detect console.log in source files', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), `
console.log('debug output');
const x = 42;
`);

      const findings = BUILTIN_RULES['no-console-log'].run(tmpDir);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].file).toMatch(/src[/\\]app\.js/);
    });

    it('should not flag commented console.log', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), `
// console.log('debug output');
const x = 42;
`);

      const findings = BUILTIN_RULES['no-console-log'].run(tmpDir);
      expect(findings).toHaveLength(0);
    });
  });

  describe('no-todo-fixme rule', () => {
    it('should detect TODO comments', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), `
// TODO: fix this later
const x = 42;
`);

      const findings = BUILTIN_RULES['no-todo-fixme'].run(tmpDir);
      expect(findings.length).toBeGreaterThan(0);
    });
  });

  describe('env-example-sync rule', () => {
    it('should detect missing env vars in .env.example', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'config.js'), `
const secret = process.env.JWT_SECRET;
const db = process.env.DATABASE_URL;
`);
      fs.writeFileSync(path.join(tmpDir, '.env.example'), 'JWT_SECRET=\n');

      const findings = BUILTIN_RULES['env-example-sync'].run(tmpDir);
      expect(findings.some(f => f.message.includes('DATABASE_URL'))).toBe(true);
    });
  });

  describe('runPluginGates()', () => {
    it('should run all enabled gates', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'const x = 42;');

      const result = runPluginGates(tmpDir);
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('gates');
      expect(Array.isArray(result.gates)).toBe(true);
    });

    it('should respect config to disable gates', () => {
      fs.mkdirSync(path.join(tmpDir, '.aiautomations'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, '.aiautomations', 'config.json'),
        JSON.stringify({ pluginGates: { 'no-console-log': false } })
      );

      const result = runPluginGates(tmpDir);
      expect(result.gates.find(g => g.id === 'no-console-log')).toBeUndefined();
    });

    it('should pass for clean code', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'module.exports = { ok: true };');

      const result = runPluginGates(tmpDir);
      expect(result.passed).toBe(true);
    });
  });

  describe('formatPluginGates()', () => {
    it('should produce readable markdown', () => {
      const result = runPluginGates(tmpDir);
      const md = formatPluginGates(result);
      expect(md).toContain('Plugin Gate Results');
    });
  });
});
