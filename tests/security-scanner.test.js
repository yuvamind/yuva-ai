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

    it('should scan exact .env files and .env variants for secrets', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'api_key="aaaaaaaaaaaaaaaaaaaaaaaa"');
      fs.writeFileSync(path.join(tmpDir, '.env.local'), 'password="supersecretpassword123"');

      const scan = runSecurityScan(tmpDir);
      const secretFiles = scan.findings
        .filter(f => f.category === 'secrets')
        .map(f => f.file);

      expect(secretFiles).toContain('.env');
      expect(secretFiles).toContain('.env.local');
    });

    it('should detect .env not in .gitignore', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'node_modules/');

      const scan = runSecurityScan(tmpDir);
      const config = scan.findings.filter(f => f.category === 'config');
      expect(config.some(f => f.title.includes('.env'))).toBe(true);
    });

    it('should match .gitignore entries exactly instead of using substrings', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=123');
      fs.writeFileSync(path.join(tmpDir, '.env.local'), 'SECRET=456');
      fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.env.local\n# .env\n');

      const scan = runSecurityScan(tmpDir);
      const titles = scan.findings
        .filter(f => f.category === 'config')
        .map(f => f.title);

      expect(titles).toContain('.env file not in .gitignore');
      expect(titles).toContain('.env not in .gitignore');
      expect(titles).not.toContain('.env.local not in .gitignore');
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
