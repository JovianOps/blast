import path from 'node:path';
import { parse } from '@babel/parser';
import type { ParserPlugin } from '@babel/parser';
import traverseImport from '@babel/traverse';
import type { NodePath, Scope } from '@babel/traverse';
import * as t from '@babel/types';
import type { ExportInfo, ExportKind, ImportedBinding, ImportKind, UsageSite } from './types.js';

type TraverseFn = typeof traverseImport;
// @babel/traverse is CJS; under NodeNext the callable lives on `.default` at runtime.
const traverse: TraverseFn = (traverseImport as unknown as { default?: TraverseFn }).default ?? traverseImport;

export interface RawImport {
  specifier: string;
  line: number;
  kind: ImportKind;
  bindings: ImportedBinding[];
}

export interface ParsedFile {
  imports: RawImport[];
  exports: ExportInfo[];
  isBarrel: boolean;
}

function pluginsFor(filePath: string): ParserPlugin[] {
  switch (path.extname(filePath)) {
    case '.ts':
    case '.mts':
    case '.cts':
      return ['typescript', 'decorators-legacy'];
    case '.tsx':
      return ['typescript', 'jsx', 'decorators-legacy'];
    default:
      return ['jsx', 'decorators-legacy'];
  }
}

function lineOf(node: t.Node): number {
  return node.loc?.start.line ?? 0;
}

function moduleExportName(node: t.Identifier | t.StringLiteral): string {
  return t.isIdentifier(node) ? node.name : node.value;
}

function isInType(ref: NodePath): boolean {
  const parentType: string = ref.parent.type;
  return (
    parentType === 'TSTypeReference' ||
    parentType === 'TSQualifiedName' ||
    parentType === 'TSExpressionWithTypeArguments' ||
    parentType === 'TSTypeQuery' ||
    parentType === 'TSClassImplements' ||
    parentType === 'TSInterfaceHeritage'
  );
}

/** try { use() } catch {}  /  use?.()  /  ns?.member — failure is absorbed at runtime. */
function isGuarded(ref: NodePath): boolean {
  const parent = ref.parentPath;
  if (parent) {
    if (parent.isOptionalCallExpression() && parent.node.callee === ref.node) return true;
    if (parent.isOptionalMemberExpression() && parent.node.object === ref.node) return true;
  }

  let child: NodePath = ref;
  let current: NodePath | null = ref.parentPath;
  while (current) {
    if (current.isFunction()) return false; // a function body may run outside the try block
    if (current.isTryStatement() && Boolean(current.node.handler) && child.node === current.node.block) {
      return true;
    }
    child = current;
    current = current.parentPath;
  }
  return false;
}

function memberOf(ref: NodePath): { member?: string } {
  const parent = ref.parent;
  if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.object === ref.node) {
    if (!parent.computed && t.isIdentifier(parent.property)) return { member: parent.property.name };
    if (parent.computed && t.isStringLiteral(parent.property)) return { member: parent.property.value };
    return {};
  }
  if (t.isTSQualifiedName(parent) && parent.left === ref.node && t.isIdentifier(parent.right)) {
    return { member: parent.right.name };
  }
  return {};
}

function collectUsages(scope: Scope, local: string, isNamespace: boolean): UsageSite[] {
  const binding = scope.getBinding(local);
  if (!binding) return [];
  return binding.referencePaths.map((ref) => ({
    line: lineOf(ref.node),
    guarded: isGuarded(ref),
    typeUse: isInType(ref),
    ...(isNamespace ? memberOf(ref) : {}),
  }));
}

function kindOfBinding(scope: Scope, name: string): ExportKind {
  const binding = scope.getBinding(name);
  if (!binding) return 'unknown';
  const node = binding.path.node;
  if (t.isFunctionDeclaration(node)) return 'function';
  if (t.isClassDeclaration(node)) return 'class';
  if (t.isVariableDeclarator(node)) return 'variable';
  if (t.isTSTypeAliasDeclaration(node)) return 'type';
  if (t.isTSInterfaceDeclaration(node)) return 'interface';
  if (t.isTSEnumDeclaration(node)) return 'enum';
  if (t.isImportSpecifier(node) || t.isImportDefaultSpecifier(node) || t.isImportNamespaceSpecifier(node)) {
    return 'reexport';
  }
  return 'unknown';
}

function exportsFromDeclaration(decl: t.Declaration, line: number, typeOnlyExport: boolean, out: ExportInfo[]): void {
  const push = (name: string, kind: ExportKind, typeOnly = typeOnlyExport): void => {
    out.push({ name, kind, line, typeOnly });
  };

  if (t.isFunctionDeclaration(decl) || t.isTSDeclareFunction(decl)) {
    if (decl.id) push(decl.id.name, 'function');
  } else if (t.isClassDeclaration(decl)) {
    if (decl.id) push(decl.id.name, 'class');
  } else if (t.isVariableDeclaration(decl)) {
    for (const declarator of decl.declarations) {
      for (const name of Object.keys(t.getBindingIdentifiers(declarator.id))) push(name, 'variable');
    }
  } else if (t.isTSTypeAliasDeclaration(decl)) {
    push(decl.id.name, 'type', true);
  } else if (t.isTSInterfaceDeclaration(decl)) {
    push(decl.id.name, 'interface', true);
  } else if (t.isTSEnumDeclaration(decl)) {
    push(decl.id.name, 'enum');
  } else if (t.isTSModuleDeclaration(decl) && t.isIdentifier(decl.id)) {
    push(decl.id.name, 'namespace');
  }
}

function literalArgument(call: t.CallExpression): string | null {
  const first = call.arguments[0];
  if (t.isStringLiteral(first)) return first.value;
  if (t.isTemplateLiteral(first) && first.expressions.length === 0 && first.quasis.length === 1) {
    return first.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function isModuleExports(node: t.MemberExpression): boolean {
  return (
    t.isIdentifier(node.object, { name: 'module' }) && !node.computed && t.isIdentifier(node.property, { name: 'exports' })
  );
}

function memberName(node: t.MemberExpression): string | null {
  if (!node.computed && t.isIdentifier(node.property)) return node.property.name;
  if (node.computed && t.isStringLiteral(node.property)) return node.property.value;
  return null;
}

function collectCommonJsExports(p: NodePath<t.AssignmentExpression>, out: ExportInfo[]): void {
  if (p.node.operator !== '=') return;
  const statement = p.parentPath;
  if (!statement || !statement.isExpressionStatement() || !statement.parentPath?.isProgram()) return;

  const left = p.node.left;
  if (!t.isMemberExpression(left)) return;
  const line = lineOf(p.node);

  if (isModuleExports(left)) {
    out.push({ name: 'default', kind: 'default', line, typeOnly: false });
    const right = p.node.right;
    if (t.isObjectExpression(right)) {
      for (const prop of right.properties) {
        if ((t.isObjectProperty(prop) || t.isObjectMethod(prop)) && !prop.computed) {
          const key = prop.key;
          const name = t.isIdentifier(key) ? key.name : t.isStringLiteral(key) ? key.value : null;
          if (name) out.push({ name, kind: 'unknown', line, typeOnly: false });
        }
      }
    }
    return;
  }

  const name = memberName(left);
  const object = left.object;
  const targetsExports =
    t.isIdentifier(object, { name: 'exports' }) || (t.isMemberExpression(object) && isModuleExports(object));
  if (name && targetsExports) out.push({ name, kind: 'unknown', line, typeOnly: false });
}

function detectBarrel(program: t.Program): boolean {
  let reexports = 0;
  for (const statement of program.body) {
    if (t.isExportAllDeclaration(statement) || (t.isExportNamedDeclaration(statement) && statement.source)) {
      reexports += 1;
    } else if (!t.isEmptyStatement(statement)) {
      return false;
    }
  }
  return reexports > 0;
}

/** Parse one file into raw import/export facts. Throws if the file cannot be parsed. */
export function parseSource(filePath: string, source: string): ParsedFile {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: pluginsFor(filePath),
    errorRecovery: true,
    allowReturnOutsideFunction: true,
  });

  const imports: RawImport[] = [];
  const exports: ExportInfo[] = [];

  traverse(ast, {
    ImportDeclaration(p) {
      const node = p.node;
      const declTypeOnly = node.importKind === 'type' || node.importKind === 'typeof';
      const bindings: ImportedBinding[] = node.specifiers.map((spec) => {
        const local = spec.local.name;
        let imported: string;
        let typeOnly = declTypeOnly;
        if (t.isImportDefaultSpecifier(spec)) {
          imported = 'default';
        } else if (t.isImportNamespaceSpecifier(spec)) {
          imported = '*';
        } else {
          imported = moduleExportName(spec.imported);
          typeOnly = typeOnly || spec.importKind === 'type' || spec.importKind === 'typeof';
        }
        return { imported, local, typeOnly, usages: collectUsages(p.scope, local, imported === '*') };
      });
      imports.push({
        specifier: node.source.value,
        line: lineOf(node),
        kind: declTypeOnly ? 'type-only' : 'static',
        bindings,
      });
    },

    ExportNamedDeclaration(p) {
      const node = p.node;
      const line = lineOf(node);
      const declTypeOnly = node.exportKind === 'type';

      if (node.source) {
        const bindings: ImportedBinding[] = [];
        for (const spec of node.specifiers) {
          let imported: string;
          let exported: string;
          let typeOnly = declTypeOnly;
          if (t.isExportNamespaceSpecifier(spec)) {
            imported = '*';
            exported = moduleExportName(spec.exported);
          } else if (t.isExportDefaultSpecifier(spec)) {
            imported = 'default';
            exported = spec.exported.name;
          } else {
            imported = moduleExportName(spec.local);
            exported = moduleExportName(spec.exported);
            typeOnly = typeOnly || spec.exportKind === 'type';
          }
          bindings.push({ imported, local: exported, typeOnly, usages: [] });
          exports.push({ name: exported, kind: 'reexport', line, typeOnly });
        }
        imports.push({ specifier: node.source.value, line, kind: 'reexport', bindings });
        return;
      }

      if (node.declaration) {
        exportsFromDeclaration(node.declaration, line, declTypeOnly, exports);
        return;
      }

      for (const spec of node.specifiers) {
        if (!t.isExportSpecifier(spec)) continue;
        exports.push({
          name: moduleExportName(spec.exported),
          kind: kindOfBinding(p.scope, spec.local.name),
          line,
          typeOnly: declTypeOnly || spec.exportKind === 'type',
        });
      }
    },

    ExportAllDeclaration(p) {
      const node = p.node;
      imports.push({
        specifier: node.source.value,
        line: lineOf(node),
        kind: 'reexport-all',
        bindings: [{ imported: '*', local: '*', typeOnly: node.exportKind === 'type', usages: [] }],
      });
    },

    ExportDefaultDeclaration(p) {
      const decl = p.node.declaration;
      let kind: ExportKind = 'default';
      let typeOnly = false;
      if (t.isFunctionDeclaration(decl) || t.isTSDeclareFunction(decl)) kind = 'function';
      else if (t.isClassDeclaration(decl)) kind = 'class';
      else if (t.isTSInterfaceDeclaration(decl)) {
        kind = 'interface';
        typeOnly = true;
      }
      exports.push({ name: 'default', kind, line: lineOf(p.node), typeOnly });
    },

    TSImportEqualsDeclaration(p) {
      const ref = p.node.moduleReference;
      if (t.isTSExternalModuleReference(ref)) {
        imports.push({ specifier: ref.expression.value, line: lineOf(p.node), kind: 'require', bindings: [] });
      }
    },

    CallExpression(p) {
      const specifier = literalArgument(p.node);
      if (specifier === null) return;
      const callee = p.node.callee;
      if (t.isImport(callee)) {
        imports.push({ specifier, line: lineOf(p.node), kind: 'dynamic', bindings: [] });
      } else if (t.isIdentifier(callee, { name: 'require' }) && !p.scope.getBinding('require')) {
        imports.push({ specifier, line: lineOf(p.node), kind: 'require', bindings: [] });
      }
    },

    AssignmentExpression(p) {
      collectCommonJsExports(p, exports);
    },
  });

  return { imports, exports, isBarrel: detectBarrel(ast.program) };
}
