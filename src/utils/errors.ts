/** Expected, user-facing failure. Maps to a process exit code (default 2). */
export class BlastError extends Error {
  public readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = 'BlastError';
    this.exitCode = exitCode;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
