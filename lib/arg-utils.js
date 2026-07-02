// Parse command args into positional values and --flag values.
// parseFlags(['fix', 'login', '--role', 'executor', '--auto'], { booleans: ['auto'] })
//   → { positional: ['fix', 'login'], flags: { role: 'executor', auto: true } }
// Flags listed in `booleans` never consume the next arg as their value.
function parseFlags(args = [], { booleans = [] } = {}) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!booleans.includes(key) && next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags };
}

module.exports = { parseFlags };
