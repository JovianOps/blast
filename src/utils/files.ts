import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import ignoreImport from 'ignore';
import type { Ignore } from 'ignore';
import { toPosix } from './paths.js';

type IgnoreFactory = () => Ignore;
const createIgnore: IgnoreFactory =
  (ignoreImport as unknown as { default?: IgnoreFactory }).default ?? (ignoreImport as unknown as IgnoreFactory);

export const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

const ALWAYS_IGNORED_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', '.next', '.blast']);

interface ScopedMatcher {
  dir: string;
  matcher: Ignore;
}

async function loadGitignore(dir: string): Promise<ScopedMatcher | null> {
  try {
    const content = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    return { dir, matcher: createIgnore().add(content) };
  } catch {
    return null;
  }
}

function isIgnored(matchers: readonly ScopedMatcher[], fullPath: string, isDirectory: boolean): boolean {
  return matchers.some(({ dir, matcher }) => {
    const rel = toPosix(path.relative(dir, fullPath));
    if (rel === '' || rel.startsWith('..')) return false;
    return matcher.ignores(isDirectory ? `${rel}/` : rel);
  });
}

async function walk(dir: string, inherited: readonly ScopedMatcher[], out: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory: skip it rather than abort the whole scan
  }

  const local = await loadGitignore(dir);
  const active = local ? [...inherited, local] : inherited;

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ALWAYS_IGNORED_DIRS.has(entry.name) || isIgnored(active, full, true)) continue;
      await walk(full, active, out);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !isIgnored(active, full, false)) {
      out.push(full);
    }
  }
}

/** All JS/TS source files under `root`, honouring .gitignore files and the built-in ignore list. */
export async function discoverSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, [], out);
  return out.sort();
}
