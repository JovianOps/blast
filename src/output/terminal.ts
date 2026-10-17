import chalk from 'chalk';
import type { BlastResult, ImpactItem, Severity } from '../graph/types.js';

const WIDTH = 72;
const MAX_LOCATION_WIDTH = 52;
const MIN_COLUMNS = 60;

interface SeverityStyle {
  icon: string;
  label: string;
  paint: (text: string) => string;
}

const STYLES: Record<Severity, SeverityStyle> = {
  critical: { icon: '🔴', label: 'CRITICAL', paint: (s) => chalk.red(s) },
  degraded: { icon: '🟡', label: 'DEGRADED', paint: (s) => chalk.yellow(s) },
  'type-only': { icon: '🔵', label: 'TYPE-ONLY', paint: (s) => chalk.blue(s) },
};

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'degraded', 'type-only'];

export interface TerminalOptions {
  /** True when --severity hard filtered out soft impacts (noted in the output). */
  hardOnly: boolean;
  columns?: number;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function truncateEnd(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 0))}…`;
}

function truncateStart(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - Math.max(max - 1, 0))}`;
}

function sectionRule(label: string): string {
  return chalk.bold(`── ${label} ${'─'.repeat(Math.max(WIDTH - label.length - 4, 3))}`);
}

function renderHeader(result: BlastResult): string[] {
  const inner = WIDTH - 2;
  const { target } = result;
  const title = `BLAST RADIUS: ${target.path}${target.symbol ? ` → ${target.symbol}` : ''}`;
  const text = truncateEnd(title, inner - 4).padEnd(inner - 4);
  return [chalk.bold(`┌${'─'.repeat(inner)}┐`), `│  ${chalk.bold(text)}  │`, chalk.bold(`└${'─'.repeat(inner)}┘`)];
}

function describeTarget(result: BlastResult): string {
  const { target } = result;
  switch (target.kind) {
    case 'symbol':
      return `${target.symbol ?? ''} (${target.symbolKind ?? 'export'}) in ${target.path}`;
    case 'directory':
      return `${target.path} (directory, ${plural(target.fileCount, 'file')}, ${plural(target.exportCount, 'export')})`;
    default:
      return `${target.path} (file, ${plural(target.exportCount, 'export')})`;
  }
}

function showsReason(item: ImpactItem): boolean {
  return item.severity === 'degraded' || item.kind === 'reexport' || item.kind === 'reexport-all';
}

function renderGroup(severity: Severity, items: readonly ImpactItem[], columns: number): string[] {
  const style = STYLES[severity];
  const fileCount = new Set(items.map((i) => i.file)).size;
  const lines = ['', `  ${style.icon} ${style.paint(chalk.bold(`${style.label} (${plural(fileCount, 'file')})`))}`];

  const locations = items.map((i) => `${i.file}:${i.line}`);
  const locationWidth = Math.min(Math.max(...locations.map((l) => l.length)), MAX_LOCATION_WIDTH);
  const snippetWidth = Math.max(columns - 5 - locationWidth - 2, 10);

  items.forEach((item, index) => {
    const location = truncateStart(locations[index] ?? '', locationWidth).padEnd(locationWidth);
    lines.push(`     ${location}  ${chalk.dim(truncateEnd(item.snippet, snippetWidth))}`);
    if (showsReason(item)) lines.push(chalk.dim(`        ↳ ${truncateEnd(item.reason, columns - 12)}`));
    if (item.suggestion) lines.push(chalk.dim(`        ↳ 💡 ${truncateEnd(item.suggestion, columns - 15)}`));
  });
  return lines;
}

function verdictText(result: BlastResult): string {
  const { verdict, critical } = result.summary;
  switch (verdict) {
    case 'SAFE':
      return chalk.green('✅ SAFE — nothing imports this target');
    case 'LOW':
      return chalk.green('🟢 LOW RISK — nothing will crash');
    case 'MEDIUM':
      return chalk.yellow(`⚠️  MEDIUM RISK — ${plural(critical, 'file')} will crash`);
    case 'HIGH':
      return chalk.red.bold(`⚠️  HIGH RISK — ${plural(critical, 'file')} will crash`);
    case 'SEVERE':
      return chalk.bgRed.white.bold(`🚨 SEVERE RISK — ${plural(critical, 'file')} will crash`);
  }
}

export function renderTerminal(result: BlastResult, options: TerminalOptions): string {
  const columns = Math.max(options.columns ?? process.stdout.columns ?? 100, MIN_COLUMNS);
  const out: string[] = [...renderHeader(result)];

  out.push('', `  ${chalk.bold('🎯 TARGET:')} ${describeTarget(result)}`, '');
  out.push(sectionRule('DIRECT IMPACT (depth 1)'));

  if (result.items.length === 0) {
    out.push('', chalk.green('  No importers affected.'));
  } else {
    for (const severity of SEVERITY_ORDER) {
      const group = result.items.filter((item) => item.severity === severity);
      if (group.length > 0) out.push(...renderGroup(severity, group, columns));
    }
  }

  const { summary } = result;
  out.push('', sectionRule('SUMMARY'), '');
  out.push(`  Total impact:  ${plural(summary.totalFiles, 'file')}`);
  out.push(
    `  Severity:      ${summary.critical} critical, ${summary.degraded} degraded, ${summary.typeOnly} type-only`,
  );
  out.push(`  Verdict:       ${verdictText(result)}`, '');
  out.push(
    chalk.dim(
      `  Scope: direct importers only (depth 1).${options.hardOnly ? ' Showing hard breaks only (--severity hard).' : ''}`,
    ),
  );

  return out.join('\n');
}
