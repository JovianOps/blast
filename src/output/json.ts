import type { BlastResult } from '../graph/types.js';

export function renderJson(result: BlastResult): string {
  return JSON.stringify(result, null, 2);
}
