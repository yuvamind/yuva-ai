import readline from 'readline';
import { log, colorize } from './colors';

/** Test seam: when set, the prompt is answered with this text instead of stdin. */
export interface PromptOptions {
  testInput?: string;
}

/** One choice offered by select(). */
export interface SelectOption {
  id: string;
  name: string;
  category?: string;
}

function confirm(message: string, options: PromptOptions = {}): Promise<boolean> {
  if (options.testInput !== undefined) {
    const input = options.testInput.trim().toLowerCase();
    return Promise.resolve(input !== 'n');
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${message} (Y/n): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

function select(message: string, options: SelectOption[], opts: PromptOptions = {}): Promise<string | null> {
  if (opts.testInput !== undefined) {
    const index = parseInt(opts.testInput, 10) - 1;
    if (index >= 0 && index < options.length) {
      return Promise.resolve(options[index].id);
    }
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    log(`\n  ${message}\n`);

    const categories: Record<string, SelectOption[]> = {};
    options.forEach((opt) => {
      const cat = opt.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(opt);
    });

    let index = 1;
    const indexMap: Record<number, string> = {};
    for (const [category, items] of Object.entries(categories)) {
      log(`  ${colorize(category + ':', 'bright')}`);
      const row: string[] = [];
      items.forEach((item) => {
        indexMap[index] = item.id;
        row.push(`    ${colorize(String(index) + '.', 'cyan')} ${item.name}`);
        index++;
      });
      for (let i = 0; i < row.length; i += 3) {
        log(row.slice(i, i + 3).map(r => r.padEnd(28)).join(''));
      }
      log('');
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  Enter number: ', (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      resolve(indexMap[num] || null);
    });
  });
}

export { confirm, select };
