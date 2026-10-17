import fs from 'node:fs';

const MAX_STATEMENT_LINES = 8;
const STATEMENT_END = /(\bfrom\s+['"][^'"]+['"]|\brequire\(|\bimport\()/;

/** Lazily reads source files and extracts one-line snippets of module statements. */
export class SourceLines {
  private readonly cache = new Map<string, string[]>();

  /** The statement starting at `line`, whitespace-collapsed (multi-line imports are joined). */
  get(file: string, line: number): string {
    const lines = this.load(file);
    let statement = '';
    for (let i = 0; i < MAX_STATEMENT_LINES; i += 1) {
      const text = lines[line - 1 + i];
      if (text === undefined) break;
      statement += `${statement ? ' ' : ''}${text.trim()}`;
      if (STATEMENT_END.test(statement)) break;
    }
    return statement.replace(/\s+/g, ' ').trim();
  }

  private load(file: string): string[] {
    const cached = this.cache.get(file);
    if (cached) return cached;
    let lines: string[];
    try {
      lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    } catch {
      lines = [];
    }
    this.cache.set(file, lines);
    return lines;
  }
}
