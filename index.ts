/**
 * Yuva AI — programmatic API entry point.
 * Exposes the core modules for use as a library (not just CLI).
 */

import { NeuralGraph, NODE_TYPES, EDGE_TYPES } from './lib/neural-graph';
import { GraphBuilder } from './lib/graph-builder';
import { TaskBus, TASK_STATUSES, STALE_WORKER_MS } from './lib/task-bus';
import { LoopEngine, extractJSON, normalizePlannedTasks, normalizeReview } from './lib/loop-engine';
import { PromptEnforcer, formatEnforcementResult, PROTECTED_PATTERNS } from './lib/prompt-enforcer';
import { FileConflictManager } from './lib/file-conflict';
import { GitIsolation } from './lib/git-isolation';
import { CostTracker, MODEL_COSTS, CHARS_PER_TOKEN } from './lib/cost-tracker';
import { StreamingWorker } from './lib/streaming-worker';
import { runSecurityScan, formatSecurityReport } from './lib/security-scanner';
import { runPluginGates, formatPluginGates, BUILTIN_RULES } from './lib/plugin-gates';
import { detectGates, runGates, runAllGates, GATE_ORDER } from './lib/gate-runner';
import { analyzeCodebase, formatAnalysis } from './lib/code-analyzer';
import { scanProject, formatContextForPrompt, injectContext } from './lib/prompt-engine';
import { SessionManager } from './lib/session-manager';
import { buildWorkPackage, ROLES, resolveTemplateFile } from './lib/work-package';
import { resolveWorkingCli, preflight, commandExists, diagnose } from './lib/ai-cli';
import { buildSpawnSpec, openTerminal } from './lib/terminal-spawn';

export {
  NeuralGraph,
  NODE_TYPES,
  EDGE_TYPES,
  GraphBuilder,
  TaskBus,
  TASK_STATUSES,
  STALE_WORKER_MS,
  LoopEngine,
  PromptEnforcer,
  formatEnforcementResult,
  PROTECTED_PATTERNS,
  FileConflictManager,
  GitIsolation,
  CostTracker,
  MODEL_COSTS,
  CHARS_PER_TOKEN,
  StreamingWorker,
  SessionManager,
  buildWorkPackage,
  ROLES,
  resolveTemplateFile,
  runSecurityScan,
  formatSecurityReport,
  runPluginGates,
  formatPluginGates,
  BUILTIN_RULES,
  detectGates,
  runGates,
  runAllGates,
  GATE_ORDER,
  analyzeCodebase,
  formatAnalysis,
  scanProject,
  formatContextForPrompt,
  injectContext,
  resolveWorkingCli,
  preflight,
  commandExists,
  diagnose,
  extractJSON,
  normalizePlannedTasks,
  normalizeReview,
  buildSpawnSpec,
  openTerminal,
};