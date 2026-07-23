const fs = require('fs');
const path = require('path');
const os = require('os');
const { analyzeCodebase, formatAnalysis } = require('../lib/code-analyzer');

describe('CodeAnalyzer', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('analyzeCodebase()', () => {
    it('should detect exports from JS files', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'auth.js'), `
const bcrypt = require('bcrypt');
function login(user) { return true; }
function logout(user) { return false; }
module.exports.login = login;
module.exports.logout = logout;
`);

      const analysis = analyzeCodebase(tmpDir);
      expect(analysis.modules.some(m => m.includes('auth.js'))).toBe(true);
    });

    it('should detect API routes', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'routes.js'), `
const express = require('express');
const app = express();
app.get('/api/users', handler);
app.post('/api/login', loginHandler);
`);

      const analysis = analyzeCodebase(tmpDir);
      expect(analysis.apiRoutes.length).toBeGreaterThanOrEqual(2);
      expect(analysis.apiRoutes.some(r => r.method === 'GET' && r.path === '/api/users')).toBe(true);
    });

    it('should detect env vars', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'config.js'), `
const dbUrl = process.env.DATABASE_URL;
const secret = process.env.JWT_SECRET;
`);

      const analysis = analyzeCodebase(tmpDir);
      expect(analysis.envVars).toContain('DATABASE_URL');
      expect(analysis.envVars).toContain('JWT_SECRET');
    });

    it('should calculate test coverage ratio', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(tmpDir, 'src', 'utils.js'), 'module.exports = {};');
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.test.js'), 'test("ok", () => {});');

      const analysis = analyzeCodebase(tmpDir);
      expect(analysis.testCoverage.testFiles).toBe(1);
      expect(analysis.testCoverage.sourceFiles).toBeGreaterThanOrEqual(2);
    });

    it('should estimate complexity', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      // Simple file
      fs.writeFileSync(path.join(tmpDir, 'src', 'simple.js'), 'module.exports = 42;');
      // Complex file
      fs.writeFileSync(path.join(tmpDir, 'src', 'complex.js'), `
function process(data) {
  if (data.type === 'a') {
    for (const item of data.items) {
      if (item.active) {
        try {
          if (item.level > 5) {
            while (item.count > 0) {
              switch (item.status) {
                case 'pending': item.count--; break;
                case 'done': break;
                default: throw new Error('bad');
              }
            }
          }
        } catch (e) { /* handle */ }
      }
    }
  } else if (data.type === 'b') {
    // more logic
  }
}
`);

      const analysis = analyzeCodebase(tmpDir);
      expect(analysis.complexity.total).toBeGreaterThan(0);
    });
  });

  describe('formatAnalysis()', () => {
    it('should produce readable output', () => {
      const analysis = analyzeCodebase(tmpDir);
      const output = formatAnalysis(analysis);
      expect(output).toContain('Codebase Analysis');
    });
  });
});
