import pc from 'picocolors';

const COLOR_MAP = {
  reset: pc.reset,
  bright: pc.bold,
  dim: pc.dim,
  green: pc.green,
  yellow: pc.yellow,
  blue: pc.blue,
  cyan: pc.cyan,
  red: pc.red,
  magenta: pc.magenta,
  white: pc.white,
  bgGreen: pc.bgGreen,
  bgRed: pc.bgRed,
  bgYellow: pc.bgYellow,
  bgBlue: pc.bgBlue,
};

/**
 * The colour names this module accepts, derived from COLOR_MAP rather than
 * written out a second time -- adding a key above is enough to make it callable,
 * and a typo at a call site (`'grene'`) is now a compile error instead of
 * silently printing unstyled text.
 */
export type Color = keyof typeof COLOR_MAP;

function colorize(text: string, color: Color): string {
  const fn = COLOR_MAP[color];
  // The guard is unreachable for typed callers but is kept for JS callers and
  // for a key whose formatter is undefined under a colour-stripped picocolors.
  return fn ? fn(text) : text;
}

function log(message: string, color: Color = 'reset'): void {
  console.log(colorize(message, color));
}

function success(message: string): void { log(`✅ ${message}`, 'green'); }
function warn(message: string): void { log(`⚠️  ${message}`, 'yellow'); }
function error(message: string): void { log(`❌ ${message}`, 'red'); }
function info(message: string): void { log(`ℹ️  ${message}`, 'blue'); }
function heading(message: string): void { log(`\n${message}`, 'bright'); }

function box(title: string, color: Color = 'cyan'): void {
  const line = '═'.repeat(58);
  log(`\n╔${line}╗`, color);
  log(`║     ${title.padEnd(53)}║`, color);
  log(`╚${line}╝\n`, color);
}

/**
 * `rows` is `unknown[][]` rather than `string[][]`: callers pass numbers, nulls
 * and booleans straight through, and every cell is run through String() below.
 */
function table(headers: string[], rows: unknown[][]): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] || '').length))
  );
  const separator = colWidths.map(w => '─'.repeat(w + 2)).join('┼');

  const formatRow = (row: unknown[]): string => row.map((cell, i) =>
    ` ${String(cell).padEnd(colWidths[i])} `
  ).join('│');

  log('┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐', 'dim');
  log('│' + formatRow(headers) + '│', 'bright');
  log('├' + separator + '┤', 'dim');
  rows.forEach(row => log('│' + formatRow(row) + '│'));
  log('└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘', 'dim');
}

export { colorize, log, success, warn, error, info, heading, box, table };
