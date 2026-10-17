export type ImportKind = 'static' | 'type-only' | 'dynamic' | 'require' | 'reexport' | 'reexport-all';

export type ExportKind =
  | 'function'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'namespace'
  | 'default'
  | 'reexport'
  | 'unknown';

/** One reference to an imported binding inside the importing file. */
export interface UsageSite {
  line: number;
  /** Inside a try block that has a catch clause, or used via optional call / optional member access. */
  guarded: boolean;
  /** Reference sits in a type position (annotation, `implements`, `typeof x` in a type, ...). */
  typeUse: boolean;
  /** For namespace imports: the member accessed (`ns.member`); undefined when the namespace escapes. */
  member?: string;
}

export interface ImportedBinding {
  /** Name in the source module: an export name, 'default', or '*' (namespace). */
  imported: string;
  /** Local name (for re-exports: the exported name). */
  local: string;
  typeOnly: boolean;
  usages: UsageSite[];
}

export interface ImportEdge {
  /** Absolute path of the importing file. */
  from: string;
  /** Absolute path of the resolved module. */
  to: string;
  specifier: string;
  line: number;
  kind: ImportKind;
  typeOnly: boolean;
  bindings: ImportedBinding[];
}

export interface ExportInfo {
  name: string;
  kind: ExportKind;
  line: number;
  typeOnly: boolean;
}

export interface FileNode {
  path: string;
  exports: ExportInfo[];
  /** Contains nothing but `export ... from` statements. */
  isBarrel: boolean;
  parseError?: string;
}

export interface ImportGraph {
  root: string;
  files: Map<string, FileNode>;
  edges: ImportEdge[];
  /** target file -> edges that import it */
  incoming: Map<string, ImportEdge[]>;
  /** importing file -> edges it declares */
  outgoing: Map<string, ImportEdge[]>;
}

export type Severity = 'critical' | 'degraded' | 'type-only';

export type Verdict = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';

export interface ImpactItem {
  /** Project-relative POSIX path of the affected file. */
  file: string;
  line: number;
  severity: Severity;
  depth: number;
  /** Project-relative path of the deleted file this item depends on. */
  target: string;
  kind: ImportKind;
  names: string[];
  usageCount: number;
  snippet: string;
  reason: string;
  suggestion?: string;
}

export interface BlastTarget {
  path: string;
  kind: 'file' | 'directory' | 'symbol';
  symbol?: string;
  symbolKind?: ExportKind;
  exportCount: number;
  fileCount: number;
}

export interface BlastSummary {
  totalFiles: number;
  critical: number;
  degraded: number;
  typeOnly: number;
  verdict: Verdict;
}

export interface BlastResult {
  target: BlastTarget;
  items: ImpactItem[];
  summary: BlastSummary;
}
