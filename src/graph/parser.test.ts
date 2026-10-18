import { describe, it, expect } from 'vitest';
import { parseSource } from './parser';

describe('parseSource', () => {
  it('detects static imports', () => {
    const { imports } = parseSource('test.ts', "import { foo } from './utils';");
    expect(imports).toHaveLength(1);
    expect(imports[0].specifier).toBe('./utils');
    expect(imports[0].kind).toBe('static');
    expect(imports[0].bindings[0].local).toBe('foo');
  });

  it('detects default imports', () => {
    const { imports } = parseSource('test.ts', "import stuff from './things';");
    expect(imports[0].specifier).toBe('./things');
    expect(imports[0].bindings[0].imported).toBe('default');
  });

  it('detects dynamic imports', () => {
    const { imports } = parseSource('test.ts', "const m = await import('./lazy');");
    expect(imports[0].kind).toBe('dynamic');
    expect(imports[0].specifier).toBe('./lazy');
  });

  it('detects barrel re-exports', () => {
    const result = parseSource('index.ts', "export * from './foo';");
    expect(result.isBarrel).toBe(true);
    expect(result.imports[0].kind).toBe('reexport-all');
  });

  it('detects named exports', () => {
    const { exports } = parseSource('test.ts', "export const x = 1;");
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('x');
  });

  it('detects default export declarations', () => {
    const { exports } = parseSource('test.ts', 'export default function foo() {}');
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('default');
    expect(exports[0].kind).toBe('function');
  });
});
