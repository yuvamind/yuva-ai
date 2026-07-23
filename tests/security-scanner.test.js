const fs = require('fs');
const path = require('path');
const os = require('os');
const { runSecurityScan, formatSecurityReport } = require('../lib/security-scanner');

describe('SecurityScanner', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuva-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('runSecurityScan()', () => {
    it('should detect hardcoded secrets', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'config.js'), `
const apiKey = "REDACTED_STRIPE_KEY_EXAMPLE";
const password = "supersecretpassword123";
`);

      const scan = runSecurityScan(tmpDir);
      const secrets = scan.findings.filter(f => f.category === 'secrets');
      expect(secrets.length).toBeGreaterThan(0);
    });

    it('should detect .env not in .gitignore', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/');

      const scan = runSecurityScan(tmpDir);
      const config = scan.findings.filter(f => f.category === 'config');
      expect(config.some(f => f.title.includes('.env'))).toBe(true);
    });

    it('should detect dangerous patterns', () => {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), `
const result = eval(userInput);
`);

      const scan = runSecurityScan(tmpDir);
      const patterns = scan.findings.filter(f => f.category === 'pattern');
      expect(patterns.some(f => f.title.includes('eval'))).toBe(true);
    });

    it('should produce summary counts', () => {
      const scan = runSecurityScan(tmpDir);
      expect(scan.summary).toHaveProperty('critical');
      expect(scan.summary).toHaveProperty('high');
      expect(scan.summary).toHaveProperty('medium');
      expect(scan.summary).toHaveProperty('low');
      expect(scan.summary).toHaveProperty('total');
    });
  });

  describe('formatSecurityReport()', () => {
    it('should produce readable markdown', () => {
      const scan = runSecurityScan(tmpDir);
      const report = formatSecurityReport(scan);
      expect(report).toContain('Security Scan Results');
    });

    it('should report no issues for clean project', () => {
      const scan = runSecurityScan(tmpDir);
      const report = formatSecurityReport(scan);
      expect(report).toBeDefined();
    });
  });
});
