const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SessionManager {
  constructor(projectDir) {
    this.projectDir = projectDir;
    // All AI runtime state lives inside .yuva/ — sessions included
    this.sessionDir = path.join(projectDir, '.yuva', 'session');

    // Migrate legacy .session/ dirs into .yuva/session/ transparently
    const legacyDir = path.join(projectDir, '.session');
    if (!fs.existsSync(this.sessionDir) && fs.existsSync(legacyDir)) {
      try {
        fs.mkdirSync(path.join(projectDir, '.yuva'), { recursive: true });
        fs.renameSync(legacyDir, this.sessionDir);
      } catch {
        this.sessionDir = legacyDir; // rename failed (locked?) — keep using legacy
      }
    }

    this.sessionFile = path.join(this.sessionDir, 'session.json');
    this.stateFile = path.join(this.sessionDir, 'state.md');
    this.logFile = path.join(this.sessionDir, 'log.md');
    this.contextFile = path.join(this.sessionDir, 'context.md');
  }

  _ensureDir() {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  _readSession() {
    try {
      return JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
    } catch {
      return null;
    }
  }

  _writeSession(session) {
    this._ensureDir();
    fs.writeFileSync(this.sessionFile, JSON.stringify(session, null, 2) + '\n');
  }

  _writeState(session) {
    const lines = [
      '# Session State',
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| ID | ${session.id} |`,
      `| Goal | ${session.goal} |`,
      `| Status | ${session.status} |`,
      `| Phase | ${session.phase} |`,
      `| Started | ${session.startedAt} |`,
      `| Last Saved | ${session.lastSavedAt || 'never'} |`,
      `| Summary | ${session.summary || 'none'} |`,
      `| Files Changed | ${session.filesChanged.length ? session.filesChanged.join(', ') : 'none'} |`,
      '',
    ];
    fs.writeFileSync(this.stateFile, lines.join('\n'));
  }

  _appendLog(entry) {
    this._ensureDir();
    const line = `- [${entry.timestamp}] **${entry.type}**: ${entry.message}\n`;
    fs.appendFileSync(this.logFile, line);
  }

  _buildContextMarkdown(session) {
    const lines = [
      '# Session Context',
      '',
      `## Goal`,
      session.goal,
      '',
      `## Status`,
      `${session.status} — phase: ${session.phase}`,
      '',
    ];

    if (session.summary) {
      lines.push('## Summary', session.summary, '');
    }

    if (session.entries.length > 0) {
      lines.push('## Log');
      for (const e of session.entries) {
        lines.push(`- [${e.timestamp}] **${e.type}**: ${e.message}`);
      }
      lines.push('');
    }

    if (session.decisions.length > 0) {
      lines.push('## Decisions');
      for (const d of session.decisions) {
        lines.push(`- **${d.what}**: ${d.why}`);
      }
      lines.push('');
    }

    if (session.filesChanged.length > 0) {
      lines.push('## Files Changed');
      for (const f of session.filesChanged) {
        lines.push(`- ${f}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  _writeContext(session) {
    fs.writeFileSync(this.contextFile, this._buildContextMarkdown(session));
  }

  hasActiveSession() {
    const session = this._readSession();
    return session !== null && session.status === 'active';
  }

  getSession() {
    return this._readSession();
  }

  start({ goal }) {
    const existing = this._readSession();
    if (existing && existing.status === 'active') {
      return existing;
    }

    const session = {
      id: crypto.randomBytes(8).toString('hex'),
      goal,
      status: 'active',
      phase: 'starting',
      startedAt: new Date().toISOString(),
      endedAt: null,
      lastSavedAt: null,
      entries: [],
      filesChanged: [],
      decisions: [],
      summary: null,
    };

    this._ensureDir();
    this._writeSession(session);
    this._writeState(session);
    this._writeContext(session);
    fs.writeFileSync(this.logFile, '# Session Log\n\n');

    return session;
  }

  log(message, { type = 'note' } = {}) {
    if (!this.hasActiveSession()) {
      this.start({ goal: 'Auto-started session' });
    }

    const session = this._readSession();
    const entry = {
      timestamp: new Date().toISOString(),
      message,
      type,
    };

    session.entries.push(entry);
    this._writeSession(session);
    this._appendLog(entry);
    this._writeContext(session);
  }

  decision(what, why) {
    // Log first (this handles auto-start and writes session)
    this.log(`Decision: ${what} — ${why}`, { type: 'decision' });

    // Now append the decision record
    const session = this.getSession();
    session.decisions.push({
      what,
      why,
      timestamp: new Date().toISOString(),
    });
    this._writeSession(session);
    this._writeContext(session);
  }

  captureGitState() {
    const { execSync } = require('child_process');
    const opts = { cwd: this.projectDir, encoding: 'utf8' };

    const result = { branch: null, recentCommits: [], uncommitted: [] };

    try {
      result.branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
    } catch {}

    try {
      const log = execSync('git log --oneline -10', opts).trim();
      result.recentCommits = log ? log.split('\n') : [];
    } catch {}

    try {
      const status = execSync('git status --porcelain', opts).trim();
      result.uncommitted = status ? status.split('\n').filter(Boolean) : [];
    } catch {}

    return result;
  }

  save({ summary, phase, filesChanged } = {}) {
    const session = this._readSession();
    if (!session) return;

    if (summary) session.summary = summary;
    if (phase) session.phase = phase;

    // Auto-capture git state
    session.gitState = this.captureGitState();

    // Merge files from git + explicit list
    const allFiles = new Set(session.filesChanged || []);
    if (filesChanged) filesChanged.forEach(f => allFiles.add(f));

    // Also add uncommitted files from git
    if (session.gitState.uncommitted) {
      session.gitState.uncommitted.forEach(line => {
        const file = line.slice(3).trim();
        if (file) allFiles.add(file);
      });
    }

    session.filesChanged = [...allFiles];
    session.lastSavedAt = new Date().toISOString();
    this._writeSession(session);
    this._writeState(session);
    this._writeContext(session);
  }

  resume() {
    const session = this._readSession();
    if (!session) {
      return 'No active session';
    }

    const content = this._buildContextMarkdown(session);
    this._ensureDir();
    fs.writeFileSync(this.contextFile, content);

    return content;
  }

  end() {
    const session = this._readSession();
    if (!session) return;

    session.status = 'completed';
    session.endedAt = new Date().toISOString();

    this._writeSession(session);
    this._writeState(session);
    this._writeContext(session);
  }

  clear() {
    if (fs.existsSync(this.sessionDir)) {
      fs.rmSync(this.sessionDir, { recursive: true, force: true });
    }
  }

  /** Auto-save: capture git state and update all session files silently */
  autoSave() {
    const session = this._readSession();
    if (!session || session.status !== 'active') return;

    // Capture git state
    session.gitState = this.captureGitState();

    // Merge uncommitted files
    const allFiles = new Set(session.filesChanged || []);
    if (session.gitState.uncommitted) {
      session.gitState.uncommitted.forEach(line => {
        const file = line.slice(3).trim();
        if (file) allFiles.add(file);
      });
    }
    session.filesChanged = [...allFiles];
    session.lastSavedAt = new Date().toISOString();

    this._writeSession(session);
    this._writeState(session);
    this._writeContext(session);
  }
}

module.exports = { SessionManager };
