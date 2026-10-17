import path from 'node:path';
import type { ImpactItem, ImportEdge, ImportedBinding, ImportGraph, ImportKind, Severity } from '../graph/types.js';
import { toPosix } from '../utils/paths.js';
import type { SourceLines } from '../utils/source.js';
import { SEVERITY_RANK } from './summary.js';

export interface DirectImpactOptions {
  root: string;
  /** When set, only this export is deleted; the rest of the file survives. */
  symbol?: string;
}

interface Judgement {
  severity: Severity;
  reason: string;
  suggestion?: string;
}

type RelFn = (file: string) => string;

function displayName(binding: ImportedBinding): string {
  return binding.imported === '*' ? `* as ${binding.local}` : binding.imported;
}

function isTypeOnlyBinding(binding: ImportedBinding): boolean {
  return binding.typeOnly || (binding.usages.length > 0 && binding.usages.every((usage) => usage.typeUse));
}

function isTypeOnlyEdge(edge: ImportEdge, relevant: readonly ImportedBinding[]): boolean {
  return edge.kind === 'type-only' || (relevant.length > 0 && relevant.every(isTypeOnlyBinding));
}

function isGuarded(relevant: readonly ImportedBinding[]): boolean {
  return relevant.length > 0 && relevant.every((b) => b.usages.length > 0 && b.usages.every((u) => u.guarded));
}

function matchesSymbol(binding: ImportedBinding, kind: ImportKind, symbol: string): boolean {
  if (binding.imported === symbol) return true;
  if (binding.imported !== '*') return false;
  // `export * from` / `export * as ns from` carry every export along.
  if (kind === 'reexport-all' || kind === 'reexport') return true;
  // Namespace import: affected if the symbol is accessed, or the namespace escapes (unknown member).
  return binding.usages.some((usage) => usage.member === undefined || usage.member === symbol);
}

/** Bindings that touch the deleted thing; null means this edge is unaffected. */
function selectRelevantBindings(edge: ImportEdge, symbol: string | undefined): ImportedBinding[] | null {
  if (symbol === undefined) return edge.bindings;
  if (edge.kind === 'dynamic' || edge.kind === 'require') return []; // usage is not statically known
  const matched = edge.bindings.filter((b) => matchesSymbol(b, edge.kind, symbol));
  return matched.length > 0 ? matched : null;
}

function barrelSuggestion(
  graph: ImportGraph,
  barrel: string,
  relevant: readonly ImportedBinding[],
  rel: RelFn,
): string {
  const sources = (graph.outgoing.get(barrel) ?? []).filter((e) => e.kind === 'reexport' || e.kind === 'reexport-all');
  const stars = sources.filter((e) => e.kind === 'reexport-all');
  const targets = new Set<string>();

  for (const binding of relevant) {
    const named = sources.find((e) => e.kind === 'reexport' && e.bindings.some((b) => b.local === binding.imported));
    if (named) targets.add(rel(named.to));
    else if (stars.length === 1 && stars[0]) targets.add(rel(stars[0].to));
    else for (const source of stars) targets.add(rel(source.to));
  }
  if (targets.size === 0) for (const source of sources) targets.add(rel(source.to));

  return `Update import to point to ${[...targets].join(' or ')} directly.`;
}

function judge(
  edge: ImportEdge,
  relevant: readonly ImportedBinding[],
  graph: ImportGraph,
  symbol: string | undefined,
  rel: RelFn,
): Judgement {
  if (edge.kind === 'dynamic') {
    return {
      severity: 'degraded',
      reason: symbol
        ? 'dynamic import(): usage cannot be determined statically; fails at runtime, not compile time'
        : 'dynamic import(): fails at runtime, not compile time',
    };
  }
  if (edge.kind === 'require') {
    return {
      severity: 'degraded',
      reason: symbol
        ? 'require(): usage cannot be determined statically; fails at runtime, not compile time'
        : 'require(): fails at runtime, not compile time',
    };
  }

  const typeOnly = isTypeOnlyEdge(edge, relevant);

  if (edge.kind === 'reexport' || edge.kind === 'reexport-all') {
    return typeOnly
      ? { severity: 'type-only', reason: 'type-only re-export of the deleted module' }
      : {
          severity: 'critical',
          reason: `re-exports the deleted module; consumers of ${rel(edge.from)} are affected next (cascade)`,
        };
  }

  if (graph.files.get(edge.to)?.isBarrel && !typeOnly) {
    return {
      severity: 'degraded',
      reason: 'imports through a barrel file that is being deleted',
      suggestion: barrelSuggestion(graph, edge.to, relevant, rel),
    };
  }

  if (typeOnly) {
    return { severity: 'type-only', reason: 'type annotations only: compiles, but type information is lost' };
  }

  if (isGuarded(relevant)) {
    return {
      severity: 'degraded',
      reason: 'every use is guarded (try/catch or optional call); the fallback path will run',
    };
  }

  const usageCount = relevant.reduce((n, b) => n + b.usages.length, 0);
  return {
    severity: 'critical',
    reason:
      relevant.length === 0
        ? 'side-effect import of the deleted module'
        : `imports deleted ${symbol ?? 'module'} (${usageCount} reference${usageCount === 1 ? '' : 's'})`,
  };
}

function classifyEdge(
  edge: ImportEdge,
  graph: ImportGraph,
  symbol: string | undefined,
  rel: RelFn,
  lines: SourceLines,
): ImpactItem | null {
  const relevant = selectRelevantBindings(edge, symbol);
  if (relevant === null) return null;

  const judgement = judge(edge, relevant, graph, symbol, rel);
  return {
    file: rel(edge.from),
    line: edge.line,
    severity: judgement.severity,
    depth: 1,
    target: rel(edge.to),
    kind: edge.kind,
    names: relevant.map(displayName),
    usageCount: relevant.reduce((n, b) => n + b.usages.length, 0),
    snippet: lines.get(edge.from, edge.line),
    reason: judgement.reason,
    ...(judgement.suggestion ? { suggestion: judgement.suggestion } : {}),
  };
}

function compareItems(a: ImpactItem, b: ImpactItem): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return a.line - b.line;
}

/** Phase 2: classify every edge that points into the deleted set from outside it. */
export function analyzeDirectImpact(
  graph: ImportGraph,
  targetFiles: ReadonlySet<string>,
  options: DirectImpactOptions,
  lines: SourceLines,
): ImpactItem[] {
  const rel: RelFn = (file) => toPosix(path.relative(options.root, file));
  const items: ImpactItem[] = [];

  for (const target of targetFiles) {
    for (const edge of graph.incoming.get(target) ?? []) {
      if (targetFiles.has(edge.from)) continue; // goes away together with its target
      const item = classifyEdge(edge, graph, options.symbol, rel, lines);
      if (item) items.push(item);
    }
  }
  return items.sort(compareItems);
}
