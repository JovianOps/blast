import fs from 'node:fs';
import path from 'node:path';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { analyzeDirectImpact } from './analysis/direct.js';
import { summarize } from './analysis/summary.js';
import { resolveTarget } from './analysis/target.js';
import { buildGraph } from './graph/builder.js';
import { createResolver } from './graph/resolver.js';
import type { BlastResult } from './graph/types.js';
import { renderJson } from './output/json.js';
import { renderTerminal } from './output/terminal.js';
import { detectProject } from './utils/detect.js';
import { BlastError, errorMessage } from './utils/errors.js';
import { discoverSourceFiles } from './utils/files.js';
import { SourceLines } from './utils/source.js';

interface DeleteOptions {
  symbol?: string;
  severity: 'hard' | 'all';
  depth?: number;
  json?: boolean;
  report?: boolean;
  root?: string;
  tsconfig?: string;
}

const MAX_PRINTED_WARNINGS = 5;

function parseDepth(value: string): number {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1) {
    throw new InvalidArgumentError('depth must be a positive integer.');
  }
  return depth;
}

function readVersion(): string {
  try {
    const pkgUrl = new URL('../package.json', import.meta.url);
    return (JSON.parse(fs.readFileSync(pkgUrl, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printWarnings(warnings: readonly string[]): void {
  for (const message of warnings.slice(0, MAX_PRINTED_WARNINGS)) {
    process.stderr.write(`warning: ${message}\n`);
  }
  if (warnings.length > MAX_PRINTED_WARNINGS) {
    process.stderr.write(`warning: ...and ${warnings.length - MAX_PRINTED_WARNINGS} more\n`);
  }
}

/** Returns the process exit code: 0 = safe, 1 = impact found, 2 = error. */
async function executeDelete(targetArg: string, options: DeleteOptions): Promise<number> {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };

  try {
    const cwd = process.cwd();
    const project = detectProject(cwd, options.root);
    if (project.language === 'python' || project.language === 'go' || project.language === 'rust') {
      throw new BlastError(
        `${project.language} projects are not supported yet (tree-sitter support is planned). ` +
          'Currently supported: TypeScript / JavaScript.',
      );
    }

    const files = await discoverSourceFiles(project.root);
    if (files.length === 0) {
      throw new BlastError(`No JS/TS source files found under ${project.root}.`);
    }

    const configPath = options.tsconfig ? path.resolve(cwd, options.tsconfig) : project.tsconfigPath;
    const resolver = createResolver(new Set(files), {
      configExplicit: Boolean(options.tsconfig),
      warn,
      ...(configPath ? { configPath } : {}),
    });

    const graph = await buildGraph(project.root, files, resolver, warn);
    const { files: targetFiles, descriptor } = resolveTarget(graph, cwd, targetArg, options.symbol);

    let items = analyzeDirectImpact(
      graph,
      targetFiles,
      { root: project.root, ...(options.symbol !== undefined ? { symbol: options.symbol } : {}) },
      new SourceLines(),
    );
    if (options.severity === 'hard') {
      items = items.filter((item) => item.severity === 'critical');
    }

    const result: BlastResult = { target: descriptor, items, summary: summarize(items) };

    printWarnings(warnings);
    if (options.depth !== undefined && options.depth > 1) {
      process.stderr.write('note: cascade propagation (--depth > 1) is not implemented yet; showing depth 1 only.\n');
    }
    if (options.report) {
      process.stderr.write('note: --report is not implemented yet; no HTML file was written.\n');
    }

    const output = options.json
      ? renderJson(result)
      : renderTerminal(result, { hardOnly: options.severity === 'hard' });
    process.stdout.write(`${output}\n`);

    return items.length === 0 ? 0 : 1;
  } catch (error) {
    printWarnings(warnings);
    process.stderr.write(`error: ${errorMessage(error)}\n`);
    if (!(error instanceof BlastError) && process.env.BLAST_DEBUG && error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    }
    return error instanceof BlastError ? error.exitCode : 2;
  }
}

export async function run(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name('blast')
    .description('Cascade impact simulator: see what breaks before you delete code.')
    .version(readVersion())
    .exitOverride(); // set before subcommands are created so they inherit it

  program
    .command('delete')
    .description('Simulate deleting a file, directory, or a single exported symbol.')
    .argument('<target>', 'file or directory to delete')
    .option('--symbol <name>', 'only this export is deleted (file targets only)')
    .addOption(
      new Option('--severity <level>', 'hard = breaking impacts only, all = include soft impacts')
        .choices(['hard', 'all'])
        .default('all'),
    )
    .option('--depth <n>', 'limit cascade depth (cascade not implemented yet)', parseDepth)
    .option('--json', 'print machine-readable JSON')
    .option('--report', 'write blast-report.html (not implemented yet)')
    .option('--root <dir>', 'project root (default: nearest directory with a project marker)')
    .option('--tsconfig <path>', 'tsconfig.json / jsconfig.json to use for module resolution')
    .action(async (target: string, options: DeleteOptions) => {
      process.exitCode = await executeDelete(target, options);
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      // Commander already printed its message; map usage errors to exit code 2.
      process.exitCode = error.exitCode === 0 ? 0 : 2;
      return;
    }
    throw error;
  }
}
