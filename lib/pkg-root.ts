import fs from 'fs';
import path from 'path';

/**
 * Locating the installed package's own root directory.
 *
 * Why this exists: code under lib/ used to find the package root with a fixed
 * hop, `path.join(__dirname, '..')`. That is correct only while the source
 * layout is the runtime layout. Compiling to dist/ nests every module one level
 * deeper —
 *
 *     source    <root>/lib/pkg-root.ts        -> '..'    is <root>      OK
 *     compiled  <root>/dist/lib/pkg-root.js   -> '..'    is <root>/dist WRONG
 *
 * — so a fixed hop silently resolves to dist/, where neither package.json nor
 * template/ exists. `yuva init` would then find no templates and fail with a
 * confusing "template not found" rather than an obvious build error.
 *
 * Walking upwards and testing for the real marker file is independent of how
 * deeply the caller is nested, so it survives the dist/ move, a future change of
 * outDir, and running straight from source during development.
 */

const PACKAGE_NAME = 'yuva-ai';

/** Resolved once per process — the directory never moves while running. */
let cached: string | null | undefined;

/** True when `dir` holds the package.json belonging to THIS package. */
function isPackageRoot(dir: string): boolean {
  const manifest = path.join(dir, 'package.json');
  if (!fs.existsSync(manifest)) return false;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { name?: unknown }).name === PACKAGE_NAME
    );
  } catch {
    // A malformed package.json higher up the tree must not abort the walk.
    return false;
  }
}

/**
 * Absolute path to this package's root, or null when it cannot be found.
 *
 * Only a package.json whose `name` is "yuva-ai" counts as a match, so the walk
 * cannot stop on a CONSUMER's package.json when yuva is installed into one —
 * it would otherwise hand back the host project's directory and write template
 * files into it.
 */
export function packageRoot(): string | null {
  if (cached !== undefined) return cached;

  let dir = __dirname;
  // Stop at the filesystem root, where dirname() becomes a fixed point.
  for (let parent = path.dirname(dir); ; dir = parent, parent = path.dirname(dir)) {
    if (isPackageRoot(dir)) {
      cached = dir;
      // Return `dir`, not `cached`: reading the memo back widens to its declared
      // `string | null | undefined` and loses the narrowing.
      return dir;
    }
    if (parent === dir) break;
  }

  cached = null;
  return cached;
}

/** Reset the memoised root. Tests only — nothing in the CLI should call this. */
export function _resetPackageRootCache(): void {
  cached = undefined;
}

/**
 * This package's declared version, or '0.0.0' when the manifest cannot be read.
 *
 * The CLI used to do `require('../package.json')` from bin/. That resolves to
 * <root>/package.json from source but to <root>/dist/package.json once compiled,
 * where nothing exists -- the same fixed-hop bug packageRoot() exists to kill.
 */
export function packageVersion(): string {
  const root = packageRoot();
  if (!root) return '0.0.0';
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version?: string };
    return parsed.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}
