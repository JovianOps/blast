#!/usr/bin/env node
import { run } from './cli.js';

run(process.argv).catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
