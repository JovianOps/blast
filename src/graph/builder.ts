import { promises as fs } from 'node:fs';
import { errorMessage } from '../utils/errors.js';
import { parseSource } from './parser.js';
import type { ModuleResolver } from './resolver.js';
import type { FileNode, ImportEdge, ImportGraph } from './types.js';

const READ_BATCH_SIZE = 64;
const MAX_FILE_BYTES = 2_000_000; // skip bundles / generated blobs

async function readSource(file: string): Promise<string | Error> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function indexEdges(edges: readonly ImportEdge[], key: 'from' | 'to'): Map<string, ImportEdge[]> {
  const index = new Map<string, ImportEdge[]>();
  for (const edge of edges) {
    const bucket = index.get(edge[key]);
    if (bucket) bucket.push(edge);
    else index.set(edge[key], [edge]);
  }
  return index;
}

/** Phase 1: parse every file and build the directed import graph. Unparseable files are recorded, not fatal. */
export async function buildGraph(
  root: string,
  files: readonly string[],
  resolver: ModuleResolver,
  warn: (message: string) => void,
): Promise<ImportGraph> {
  const nodes = new Map<string, FileNode>();
  const edges: ImportEdge[] = [];

  const recordFailure = (file: string, reason: string): void => {
    nodes.set(file, { path: file, exports: [], isBarrel: false, parseError: reason });
    warn(`skipped ${file}: ${reason}`);
  };

  for (let start = 0; start < files.length; start += READ_BATCH_SIZE) {
    const batch = files.slice(start, start + READ_BATCH_SIZE);
    const sources = await Promise.all(batch.map(readSource));

    batch.forEach((file, i) => {
      const source = sources[i];
      if (source === undefined) return;
      if (source instanceof Error) {
        recordFailure(file, source.message);
        return;
      }
      if (source.length > MAX_FILE_BYTES) {
        recordFailure(file, `file larger than ${MAX_FILE_BYTES} bytes`);
        return;
      }

      try {
        const parsed = parseSource(file, source);
        nodes.set(file, { path: file, exports: parsed.exports, isBarrel: parsed.isBarrel });

        for (const raw of parsed.imports) {
          const to = resolver.resolve(file, raw.specifier);
          if (!to) continue; // external package or unresolvable path: outside the graph
          edges.push({
            from: file,
            to,
            specifier: raw.specifier,
            line: raw.line,
            kind: raw.kind,
            typeOnly: raw.kind === 'type-only' || (raw.bindings.length > 0 && raw.bindings.every((b) => b.typeOnly)),
            bindings: raw.bindings,
          });
        }
      } catch (error) {
        recordFailure(file, errorMessage(error));
      }
    });
  }

  return {
    root,
    files: nodes,
    edges,
    incoming: indexEdges(edges, 'to'),
    outgoing: indexEdges(edges, 'from'),
  };
}
