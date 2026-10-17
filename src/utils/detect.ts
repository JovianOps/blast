import fs from 'node:fs';
import path from 'node:path';
import { BlastError } from './errors.js';

export type ProjectLanguage = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'unknown';

export interface ProjectInfo {
  root: string;
  language: ProjectLanguage;
  tsconfigPath?: string;
}

const ROOT_MARKERS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'tsconfig.json', '.git'];

function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function findRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (ROOT_MARKERS.some((marker) => exists(path.join(dir, marker)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function hasTypeScriptDependency(packageJsonPath: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Boolean(pkg.dependencies?.typescript ?? pkg.devDependencies?.typescript);
  } catch {
    return false;
  }
}

export function detectProject(startDir: string, rootOverride?: string): ProjectInfo {
  const root = rootOverride ? path.resolve(startDir, rootOverride) : findRoot(startDir);
  if (!exists(root) || !fs.statSync(root).isDirectory()) {
    throw new BlastError(`Project root is not a directory: ${root}`);
  }

  const tsconfig = ['tsconfig.json', 'jsconfig.json']
    .map((name) => path.join(root, name))
    .find((candidate) => exists(candidate));
  const packageJson = path.join(root, 'package.json');

  let language: ProjectLanguage = 'unknown';
  if (tsconfig?.endsWith('tsconfig.json') || (exists(packageJson) && hasTypeScriptDependency(packageJson))) {
    language = 'typescript';
  } else if (exists(packageJson) || tsconfig) {
    language = 'javascript';
  } else if (exists(path.join(root, 'pyproject.toml'))) {
    language = 'python';
  } else if (exists(path.join(root, 'go.mod'))) {
    language = 'go';
  } else if (exists(path.join(root, 'Cargo.toml'))) {
    language = 'rust';
  }

  return { root, language, ...(tsconfig ? { tsconfigPath: tsconfig } : {}) };
}
