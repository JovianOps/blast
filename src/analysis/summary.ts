import type { BlastSummary, ImpactItem, Severity, Verdict } from '../graph/types.js';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  degraded: 1,
  'type-only': 2,
};

function verdictFor(critical: number, soft: number): Verdict {
  if (critical === 0) return soft === 0 ? 'SAFE' : 'LOW';
  if (critical <= 2) return 'MEDIUM';
  if (critical <= 9) return 'HIGH';
  return 'SEVERE';
}

/** Each affected file counts once, at its worst severity. */
export function summarize(items: readonly ImpactItem[]): BlastSummary {
  const worst = new Map<string, Severity>();
  for (const item of items) {
    const current = worst.get(item.file);
    if (current === undefined || SEVERITY_RANK[item.severity] < SEVERITY_RANK[current]) {
      worst.set(item.file, item.severity);
    }
  }

  let critical = 0;
  let degraded = 0;
  let typeOnly = 0;
  for (const severity of worst.values()) {
    if (severity === 'critical') critical += 1;
    else if (severity === 'degraded') degraded += 1;
    else typeOnly += 1;
  }

  return {
    totalFiles: worst.size,
    critical,
    degraded,
    typeOnly,
    verdict: verdictFor(critical, degraded + typeOnly),
  };
}
