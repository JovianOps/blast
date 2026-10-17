import fs from 'node:fs';
import path from 'node:path';
import { BlastError, errorMessage } from '../utils/errors.js';
import { parseJsonc } from '../utils/jsonc.js';
import { isWithin } from '../utils/paths.js';

const EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'] as const;

/** TypeScript ESM style: `import './x.js'` is satisfied by `x.ts`. */
const JS_TO_TS: ReadonlyMap<string, readonly string[]> = new Map([
  ['.js', ['.ts', '.tsx']],
  ['.jsx', ['.tsx']],
  ['.mjs', ['.mts']],
  ['.cjs', ['.cts']],
]);

interface TsConfigJson {
  extends?: string | string[];
  compilerOptions?: {
    baseUrl?: unknown;
    paths?: unknown;
    rootDirs?: unknown;
  };
}

interface RawConfig {
  baseUrl?: string;
  paths?: { configDir: string; map: Record<string, string[]> };
  rootDirs?: string[];
}

interface AliasPattern {
  prefix: string;
  suffix: string;
  wildcard: boolean;
  targets: string[];
}

const MAX_EXTENDS_DEPTH = 8;

function loadConfig(file: string, depth = 0): RawConfig {
  if (depth > MAX_EXTENDS_DEPTH) throw new Error(`"extends" chain too deep at ${file}`);

  const dir = path.dirname(file);
  const json = parseJsonc(fs.readFileSync(file, 'utf8')) as TsConfigJson;

  let merged: RawConfig = {};
  const parents = typeof json.extends === 'string' ? [json.extends] : Array.isArray(json.extends) ? json.extends : [];
  for (const parent of parents) {
    if (!parent.startsWith('.')) continue; // package-based extends are not followed
    const resolved = path.resolve(dir, parent.endsWith('.json') ? parent : `${parent}.json`);
    if (fs.existsSync(resolved)) merged = { ...merged, ...loadConfig(resolved, depth + 1) };
  }

  const options = json.compilerOptions ?? {};
  if (typeof options.baseUrl === 'string') {
    merged.baseUrl = path.resolve(dir, options.baseUrl);
  }
  if (options.paths && typeof options.paths === 'object') {
    const map: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(options.paths as Record<string, unknown>)) {
      if (Array.isArray(value)) map[key] = value.filter((v): v is string => typeof v === 'string');
    }
    merged.paths = { configDir: dir, map };
  }
  if (Array.isArray(options.rootDirs)) {
    merged.rootDirs = options.rootDirs
      .filter((v): v is string => typeof v === 'string')
      .map((v) => path.resolve(dir, v));
  }
  return merged;
}

export class ModuleResolver {
  private readonly baseUrl?: string;
  private readonly pathsBase?: string;
  private readonly patterns: AliasPattern[];
  private readonly rootDirs: string[];

  constructor(
    private readonly files: ReadonlySet<string>,
    config: RawConfig,
  ) {
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    const pathsBase = config.baseUrl ?? config.paths?.configDir;
    if (pathsBase) this.pathsBase = pathsBase;
    this.rootDirs = config.rootDirs ?? [];
    this.patterns = Object.entries(config.paths?.map ?? {})
      .map(([key, targets]): AliasPattern => {
        const star = key.indexOf('*');
        return star === -1
          ? { prefix: key, suffix: '', wildcard: false, targets }
          : { prefix: key.slice(0, star), suffix: key.slice(star + 1), wildcard: true, targets };
      })
      .sort((a, b) => b.prefix.length - a.prefix.length);
  }

  /** Resolve `specifier` as imported from `from`. Returns null for externals and unresolvable specifiers. */
  resolve(from: string, specifier: string): string | null {
    const spec = specifier.split('?')[0] ?? specifier;
    if (spec === '' || spec.startsWith('node:')) return null;

    if (spec.startsWith('.') || path.isAbsolute(spec)) {
      return this.resolveRelative(from, spec);
    }

    const aliased = this.resolveAlias(spec);
    if (aliased) return aliased;

    if (this.baseUrl) {
      return this.probe(path.resolve(this.baseUrl, spec));
    }
    return null;
  }

  private resolveRelative(from: string, spec: string): string | null {
    const absolute = path.resolve(path.dirname(from), spec);
    const direct = this.probe(absolute);
    if (direct) return direct;

    for (const dir of this.rootDirs) {
      if (!isWithin(dir, absolute)) continue;
      const rel = path.relative(dir, absolute);
      for (const other of this.rootDirs) {
        if (other === dir) continue;
        const hit = this.probe(path.join(other, rel));
        if (hit) return hit;
      }
    }
    return null;
  }

  private resolveAlias(spec: string): string | null {
    if (!this.pathsBase) return null;

    for (const pattern of this.patterns) {
      let captured = '';
      if (pattern.wildcard) {
        const fits =
          spec.length >= pattern.prefix.length + pattern.suffix.length &&
          spec.startsWith(pattern.prefix) &&
          spec.endsWith(pattern.suffix);
        if (!fits) continue;
        captured = spec.slice(pattern.prefix.length, spec.length - pattern.suffix.length);
      } else if (spec !== pattern.prefix) {
        continue;
      }

      for (const target of pattern.targets) {
        const hit = this.probe(path.resolve(this.pathsBase, target.replace('*', captured)));
        if (hit) return hit;
      }
    }
    return null;
  }

  /** Try file, TS-for-JS mapping, appended extensions, then directory index. */
  private probe(base: string): string | null {
    if (this.files.has(base)) return base;

    const ext = path.extname(base);
    const mapped = JS_TO_TS.get(ext);
    if (mapped) {
      const stem = base.slice(0, -ext.length);
      for (const candidate of mapped) {
        if (this.files.has(stem + candidate)) return stem + candidate;
      }
    }

    for (const candidate of EXTENSIONS) {
      if (this.files.has(base + candidate)) return base + candidate;
    }
    for (const candidate of EXTENSIONS) {
      const indexFile = path.join(base, `index${candidate}`);
      if (this.files.has(indexFile)) return indexFile;
    }
    return null;
  }
}

export interface ResolverOptions {
  /** Absolute path to tsconfig.json / jsconfig.json, if any. */
  configPath?: string;
  /** True when the user passed --tsconfig: a broken file is then an error, not a warning. */
  configExplicit: boolean;
  warn: (message: string) => void;
}

export function createResolver(files: ReadonlySet<string>, options: ResolverOptions): ModuleResolver {
  let config: RawConfig = {};
  if (options.configPath) {
    try {
      config = loadConfig(options.configPath);
    } catch (error) {
      const message = `Could not read ${options.configPath}: ${errorMessage(error)}`;
      if (options.configExplicit) throw new BlastError(message);
      options.warn(`${message} (continuing without path aliases)`);
    }
  }
  return new ModuleResolver(files, config);
}
