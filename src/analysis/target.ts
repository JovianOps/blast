import fs from 'node:fs';
import path from 'node:path';
import type { BlastTarget, ImportGraph } from '../graph/types.js';
import { BlastError } from '../utils/errors.js';
import { isWithin, toPosix } from '../utils/paths.js';

const PROBE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'] as const;

export interface ResolvedTarget {
  files: Set<string>;
  descriptor: BlastTarget;
}

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function probeSourceFile(graph: ImportGraph, base: string): string | null {
  for (const ext of PROBE_EXTENSIONS) {
    if (graph.files.has(base + ext)) return base + ext;
  }
  for (const ext of PROBE_EXTENSIONS) {
    const indexFile = path.join(base, `index${ext}`);
    if (graph.files.has(indexFile)) return indexFile;
  }
  return null;
}

/** Turn the CLI target (file | directory, optional --symbol) into the set of files that disappear. */
export function resolveTarget(
  graph: ImportGraph,
  cwd: string,
  targetArg: string,
  symbol: string | undefined,
): ResolvedTarget {
  const root = graph.root;
  const absolute = path.resolve(cwd, targetArg);
  if (!isWithin(root, absolute)) {
    throw new BlastError(`Target is outside the project root (${root}). Use --root to widen the analysis.`);
  }
  const rel = (p: string): string => toPosix(path.relative(root, p));
  const stat = safeStat(absolute);

  if (stat?.isDirectory()) {
    if (symbol !== undefined) throw new BlastError('--symbol requires a file target, not a directory.');
    const files = new Set([...graph.files.keys()].filter((f) => isWithin(absolute, f)));
    if (files.size === 0) throw new BlastError(`No analyzed source files under ${rel(absolute) || '.'}/`);
    let exportCount = 0;
    for (const file of files) exportCount += graph.files.get(file)?.exports.length ?? 0;
    return {
      files,
      descriptor: { path: `${rel(absolute) || '.'}/`, kind: 'directory', exportCount, fileCount: files.size },
    };
  }

  const filePath = stat?.isFile() ? absolute : probeSourceFile(graph, absolute);
  if (!filePath) throw new BlastError(`Target not found: ${targetArg}`);

  const node = graph.files.get(filePath);
  if (!node) {
    throw new BlastError(`${rel(filePath)} is not an analyzed source file (unsupported extension or git-ignored).`);
  }
  if (node.parseError) {
    throw new BlastError(`${rel(filePath)} could not be parsed: ${node.parseError}`);
  }

  if (symbol === undefined) {
    return {
      files: new Set([filePath]),
      descriptor: { path: rel(filePath), kind: 'file', exportCount: node.exports.length, fileCount: 1 },
    };
  }

  const exported = node.exports.find((e) => e.name === symbol);
  if (!exported) {
    const available = node.exports.map((e) => e.name).join(', ') || '(none)';
    throw new BlastError(`"${symbol}" is not exported by ${rel(filePath)}. Exports: ${available}`);
  }
  return {
    files: new Set([filePath]),
    descriptor: {
      path: rel(filePath),
      kind: 'symbol',
      symbol,
      symbolKind: exported.kind,
      exportCount: node.exports.length,
      fileCount: 1,
    },
  };
}
