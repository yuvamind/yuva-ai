/**
 * Fast structured-decision classifier for triaging scanner findings.
 *
 * Two tiers, cheapest first:
 *   1. Heuristic  — instant, local, no network. Catches obvious placeholder/
 *      test/example matches before anything else runs.
 *   2. LLM        — only when ANTHROPIC_API_KEY is set. Calls a small, fast
 *      Claude model with a forced tool call so the response is a typed
 *      {verdict, confidence, reasoning} object, never free-form text.
 *
 * Network failures, missing keys, and parse errors all fall back to the
 * heuristic result — classification quality is a bonus, never a dependency.
 */

const { debug } = require('./debug');

const DECISION_MODEL = process.env.YUVA_DECISION_MODEL || 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 8000;

const FALSE_POSITIVE_VALUE_HINTS = [
  /\bexample\b/i, /\bplaceholder\b/i, /\bchangeme\b/i, /\bredacted\b/i,
  /your[_-]?(api[_-]?)?key/i, /\bdummy\b/i, /\bfake\b/i, /\btodo\b/i,
  /x{6,}/i, /0{6,}/, /\btest[_-]?key\b/i,
];
const FALSE_POSITIVE_PATH_HINTS = [
  /\.example$/i, /\.sample$/i, /(^|[/\\])(test|tests|__tests__|__mocks__|fixtures|mocks?)([/\\]|$)/i,
];

/**
 * Zero-network first pass. Runs on every finding, always.
 */
function heuristicClassify(finding) {
  const file = finding.file || '';
  if (FALSE_POSITIVE_PATH_HINTS.some((r) => r.test(file))) {
    return {
      verdict: 'false_positive',
      confidence: 0.75,
      reasoning: 'File path looks like a test/fixture/example location.',
      source: 'heuristic',
    };
  }

  const haystack = `${finding.snippet || ''} ${finding.description || ''}`;
  if (FALSE_POSITIVE_VALUE_HINTS.some((r) => r.test(haystack))) {
    return {
      verdict: 'false_positive',
      confidence: 0.7,
      reasoning: 'Matched value looks like a placeholder/example token, not a real credential.',
      source: 'heuristic',
    };
  }

  return {
    verdict: 'true_positive',
    confidence: 0.5,
    reasoning: 'No placeholder/test signal found — treat as real until a human reviews it.',
    source: 'heuristic',
  };
}

/**
 * ★ Your call: what leaves this machine before a finding's matched text is
 * sent to an external API for LLM classification?
 *
 * The scanner's `snippet` field can contain a live secret (a real API key,
 * password, or connection string) — that's the whole point of the finding.
 * Sending it to a third-party model to ask "is this real?" is itself a
 * secret-exposure risk if done carelessly.
 *
 * Trade-offs to weigh:
 *   - Reveal a short prefix/suffix only (e.g. "sk_live_AB••••••••wx12") —
 *     gives the model shape/context, keeps the middle hidden.
 *   - Strip the value entirely and send only the surrounding shape
 *     (variable name, format, length) — safest, but the model has less to
 *     reason about and may be less accurate.
 *   - Hash the value and send only the hash — safe, but useless as context
 *     for the model (it can't "read" a hash).
 *
 * Implement whichever policy you're comfortable with below. This function
 * must NEVER return the raw, unmodified snippet.
 *
 * @param {string} snippet - the raw matched line/value from the scanner
 * @returns {string} a redacted version safe to send to an external API
 */
function redactSnippet(snippet) {
  throw new Error(
    'redactSnippet() is not implemented — see the TODO in lib/decision-engine.js. ' +
    'LLM-tier classification is disabled until this is filled in.'
  );
}

async function llmClassify(finding, apiKey) {
  let safeSnippet;
  try {
    safeSnippet = redactSnippet(finding.snippet || '');
  } catch (err) {
    throw new Error(`redaction unavailable: ${err.message}`);
  }

  const body = {
    model: DECISION_MODEL,
    max_tokens: 200,
    temperature: 0,
    tools: [{
      name: 'classify_finding',
      description: 'Classify a static-analysis security finding as a true or false positive.',
      input_schema: {
        type: 'object',
        properties: {
          verdict: { type: 'string', enum: ['true_positive', 'false_positive'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' },
        },
        required: ['verdict', 'confidence', 'reasoning'],
      },
    }],
    tool_choice: { type: 'tool', name: 'classify_finding' },
    messages: [{
      role: 'user',
      content: `Static-analysis finding:\n` +
        `Rule: ${finding.title}\n` +
        `Severity: ${finding.severity}\n` +
        `File: ${finding.file}\n` +
        `Redacted match: ${safeSnippet}\n\n` +
        `Is this a real security issue, or a false positive (test/example/placeholder data)? ` +
        `Call classify_finding with your decision.`,
    }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();
    const toolUse = (data.content || []).find((b) => b.type === 'tool_use');
    if (!toolUse || !toolUse.input) throw new Error('No structured decision in response');
    return { ...toolUse.input, source: 'llm' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classify a single security-scanner finding as true/false positive.
 * Always resolves — never throws — so a scan can't fail because triage did.
 */
async function classifyFinding(finding, { apiKey = process.env.ANTHROPIC_API_KEY } = {}) {
  const heuristic = heuristicClassify(finding);
  if (!apiKey) return heuristic;

  // High-confidence heuristic false positives aren't worth a paid API call.
  if (heuristic.verdict === 'false_positive' && heuristic.confidence >= 0.75) {
    return heuristic;
  }

  try {
    return await llmClassify(finding, apiKey);
  } catch (err) {
    debug('decision-engine', 'llm classify failed, falling back to heuristic', err);
    return heuristic;
  }
}

module.exports = { classifyFinding, heuristicClassify, redactSnippet };
