import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { debug } from './debug';
import type { ExecSyncOptionsWithStringEncoding } from 'child_process';
import * as P from './paths';

const MAX_SESSION_ENTRIES = 500;

export interface SessionEntry {
  timestamp: string;
  type: string;
  message: string;
  [key: string]: unknown;
}

export interface SessionDecision {
  timestamp: string;
  what: string;
  why: string;
}

export interface GitState {
  branch: string | null;
  recentCommits: string[];
  uncommitted: string[];
}

/** The persisted session.json record. */
export interface SessionRecord {
  id: string;
  goal: string;
  status: string;
  phase: string;
  startedAt: string;
  endedAt: string | null;
  lastSavedAt: string | null;
  entries: SessionEntry[];
  filesChanged: string[];
  decisions: SessionDecision[];
  summary: string | null;
  gitState?: GitState;
  [key: string]: unknown;
}

export interface SaveOptions {
  summary?: string;
  phase?: string;
  filesChanged?: string[];
}

class SessionManager {
  projectDir: string;
  sessionDir: string;
  sessionFile: string;
  stateFile: string;
  logFile: string;
  contextFile: string;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    // Session state is runtime, not config — it lives under .yuva/run/
    this.sessionDir = P.sessionDir(projectDir);

    // Migrate legacy .session/ dirs into .yuva/run/session/ transparently
    const legacyDir = path.join(projectDir, '.session');
    if (!fs.existsSync(this.sessionDir) && fs.existsSync(legacyDir)) {
      try {
        fs.mkdirSync(path.dirname(this.sessionDir), { recursive: true });
        fs.renameSync(legacyDir, this.sessionDir);
      } catch (err) {
        debug('session-manager', 'legacy migration failed, using legacy dir', err);
        this.sessionDir = legacyDir;
      }
    }

    this.sessionFile = path.join(this.sessionDir, 'session.json');
    this.stateFile = path.join(this.sessionDir, 'state.md');
    this.logFile = path.join(this.sessionDir, 'log.md');
    this.contextFile = path.join(this.sessionDir, 'context.md');
  }

  _ensureDir(): void {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  _readSession(): SessionRecord | null {
    try {
      return JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
    } catch {
      return null;
    }
  }

  _writeSession(session: SessionRecord): void {
    this._ensureDir();
    fs.writeFileSync(this.sessionFile, JSON.stringify(session, null, 2) + '\n');
  }

  _writeState(session: SessionRecord): void {
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

  _appendLog(entry: SessionEntry): void {
    this._ensureDir();
    const line = `- [${entry.timestamp}] **${entry.type}**: ${entry.message}\n`;
    fs.appendFileSync(this.logFile, line);
  }

  _buildContextMarkdown(session: SessionRecord): string {
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

  _writeContext(session: SessionRecord): void {
    fs.writeFileSync(this.contextFile, this._buildContextMarkdown(session));
  }

  hasActiveSession(): boolean {
    const session = this._readSession();
    return session !== null && session.status === 'active';
  }

  getSession(): SessionRecord | null {
    return this._readSession();
  }

  start({ goal }: { goal: string }): SessionRecord {
    const existing = this._readSession();
    if (existing && existing.status === 'active') {
      return existing;
    }

    const session: SessionRecord = {
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

  log(message: string, { type = 'note' }: { type?: string } = {}) {
    if (!this.hasActiveSession()) {
      this.start({ goal: 'Auto-started session' });
    }

    // Non-null: hasActiveSession()/start() above guarantee a record on disk.
    const session = this._readSession()!;
    const entry: SessionEntry = {
      timestamp: new Date().toISOString(),
      message,
      type,
    };

    session.entries.push(entry);
    // Cap entries to prevent unbounded growth
    if (session.entries.length > MAX_SESSION_ENTRIES) {
      session.entries = session.entries.slice(-MAX_SESSION_ENTRIES);
    }
    this._writeSession(session);
    this._appendLog(entry);
    this._writeContext(session);
  }

  decision(what: string, why: string) {
    // Log first (this handles auto-start and writes session)
    this.log(`Decision: ${what} — ${why}`, { type: 'decision' });

    // Now append the decision record. Non-null: this.log() auto-started it.
    const session = this.getSession()!;
    session.decisions.push({
      what,
      why,
      timestamp: new Date().toISOString(),
    });
    this._writeSession(session);
    this._writeContext(session);
  }

  captureGitState(): GitState {
    const { execSync } = require('child_process') as typeof import('child_process');
    // Typed against execSync's string-returning overload so `.trim()` below is
    // valid; an untyped literal widens `encoding` to string and selects Buffer.
    const opts: ExecSyncOptionsWithStringEncoding = { cwd: this.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };

    const result: GitState = { branch: null, recentCommits: [], uncommitted: [] };

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

  /**
   * Save a checkpoint. Returns false when there is no session to save into —
   * the CLI printed "Checkpoint saved." unconditionally, which was a lie.
   */
  save({ summary, phase, filesChanged }: SaveOptions = {}) {
    const session = this._readSession();
    if (!session) return false;

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
    return true;
  }

  resume(): string {
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

  clear(): void {
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

export { SessionManager };