const fs = require('fs');
const path = require('path');
const os = require('os');
const { scanProject, formatContextForPrompt, injectContext } = require('../lib/prompt-engine');

describe('PromptEngine', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('scanProject()', () => {
    it('should detect JavaScript project', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        dependencies: { express: '^4.0.0' },
        scripts: { start: 'node index.js', test: 'jest' },
      }));

      const ctx = scanProject(tmpDir);
      expect(ctx.languages).toContain('javascript');
      expect(ctx.frameworks).toContain('express');
      expect(ctx.scripts.start).toBe('node index.js');
      expect(ctx.hasTests).toBe(false);
    });

    it('should detect TypeScript project', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');

      const ctx = scanProject(tmpDir);
      expect(ctx.hasTypeScript).toBe(true);
    });

    it('should detect source directories', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'));
      fs.mkdirSync(path.join(tmpDir, 'tests'));

      const ctx = scanProject(tmpDir);
      expect(ctx.srcDirs).toContain('src');
      expect(ctx.testDirs).toContain('tests');
      expect(ctx.hasTests).toBe(true);
    });

    it('should detect Docker and CI', () => {
      fs.writeFileSync(path.join(tmpDir, 'Dockerfile'), 'FROM node:18');
      fs.mkdirSync(path.join(tmpDir, '.github', 'workflows'), { recursive: true });

      const ctx = scanProject(tmpDir);
      expect(ctx.hasDocker).toBe(true);
      expect(ctx.hasCI).toBe(true);
    });

    it('should detect env files', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
      fs.writeFileSync(path.join(tmpDir, '.env.example'), 'SECRET=');

      const ctx = scanProject(tmpDir);
      expect(ctx.envFiles).toContain('.env');
      expect(ctx.envFiles).toContain('.env.example');
    });
  });

  describe('formatContextForPrompt()', () => {
    it('should produce readable markdown', () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        name: 'test',
        scripts: { test: 'jest' },
      }));

      const ctx = scanProject(tmpDir);
      const md = formatContextForPrompt(ctx);
      expect(md).toContain('Project Context');
      expect(md).toContain('javascript');
    });
  });

  describe('injectContext()', () => {
    it('should replace {{CONTEXT}} placeholder', () => {
      const prompt = 'Before\n{{CONTEXT}}\nAfter';
      const result = injectContext(prompt, tmpDir);
      expect(result.prompt).toContain('Project Context');
      expect(result.prompt).not.toContain('{{CONTEXT}}');
    });

    it('should replace individual placeholders', () => {
      const prompt = 'Languages: {{LANGUAGES}}, Branch: {{GIT_BRANCH}}';
      const result = injectContext(prompt, tmpDir);
      expect(result.prompt).not.toContain('{{LANGUAGES}}');
      expect(result.prompt).not.toContain('{{GIT_BRANCH}}');
    });

    it('should inject extra context', () => {
      const prompt = 'Task: {{TASK_TITLE}}';
      const result = injectContext(prompt, tmpDir, { TASK_TITLE: 'Build auth' });
      expect(result.prompt).toContain('Build auth');
    });
  });
});
