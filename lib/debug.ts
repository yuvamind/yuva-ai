/**
 * Lightweight debug logger for yuva-ai.
 * Respects YUVA_DEBUG=1 env var. Silent by default (no performance cost).
 */

const DEBUG = process.env.YUVA_DEBUG === '1' || process.env.YUVA_DEBUG === 'true';

function debug(module: string, message: string, err?: unknown): void {
  if (!DEBUG) return;
  const ts = new Date().toISOString();
  const prefix = `[yuva:${module}] ${ts}`;
  if (err) {
    // Deliberately `err.message || err` and not `err instanceof Error`: callers
    // throw plain strings and non-Error objects too, and an Error carrying an
    // empty message must still fall back to printing the value itself.
    const detail = (err as { message?: unknown }).message || err;
    console.error(`${prefix} ${message}: ${detail}`);
  } else {
    console.error(`${prefix} ${message}`);
  }
}

/**
 * Wrap a catch block to log the error instead of silently swallowing it.
 * Usage: catch (logCatch('neural-graph', 'load failed'))
 */
function logCatch(module: string, message: string): (err: unknown) => void {
  return (err: unknown) => debug(module, message, err);
}

export { debug, logCatch, DEBUG };
