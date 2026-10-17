# blast

**Blast Radius for code deletions** — a CLI that tells you what breaks before you delete a file, directory, or single export.

## what this is

ever wanted to delete a file but had no idea what would break? `blast` builds an import graph of your codebase, then simulates the deletion and shows you every file that will crash. zero side effects — it never touches your source files. runs locally, read-only.

## quick start

```bash
npm create blast@latest   # coming soon
# or
npx blast delete src/utils/helpers.ts
```

## usage

```
blast delete <target> [options]

options:
  --symbol <name>    scope to a single export (e.g. --symbol formatDate)
  --severity <level> hard = breaking only, all = include soft impacts (default: all)
  --depth <n>        cascade depth (not yet implemented, depth 1 only)
  --json             machine-readable output
  --report           HTML report (not yet implemented)
  --root <dir>       project root override
  --tsconfig <path>  tsconfig.json to use
```

## examples

**delete a file:**
```bash
$ blast delete src/lib/auth.ts

┌──────────────────────────────────────────────────────────┐
│  BLAST RADIUS: src/lib/auth.ts                         │
└──────────────────────────────────────────────────────────┘

  🟥 CRITICAL (3 files)
     src/pages/login.tsx:5    import { login } from '@/lib/auth'
     src/pages/signup.tsx:12  import { login } from '@/lib/auth'
     src/hooks/useAuth.ts:3   import * as auth from '@/lib/auth'
        ↳ re-exports auth; consumers hit next

  🟨 DEGRADED (1 file)
     src/utils/logger.ts:2
        ↳ guarded by try/catch; fallback will run

  SUMMARY
  Total impact:  4 files
  Severity:      3 critical, 1 degraded, 0 type-only
  Verdict:       ⚠️  HIGH RISK — 3 files will crash
```

**delete a single export:**
```bash
blast delete src/utils/format.ts --symbol formatDate
```

**directory deletion:**
```bash
blast delete src/deprecated/
```

**CI integration:**
```bash
# block merges that break the build
blast delete src/old-module/ --severity hard --json > blast.json
```

## exit codes

| code | meaning |
|------|---------|
| 0 | safe — nothing breaks |
| 1 | impact found — some files will crash |
| 2 | error — bad target, bad config, unsupported language |

## how it works

1. **detect project** — finds your root (package.json, tsconfig, .git, etc.)
2. **discover files** — gitignore-aware scan (skips node_modules, dist, etc.)
3. **build graph** — parses every file with Babel, resolves every import
4. **classify** — marks each affected edge as critical, degraded, or type-only
5. **summarize** — verdict based on unique critical file count

**severity levels:**
- **critical** — will crash at runtime/compile
- **degraded** — fails in a fallback path (dynamic import, try/catch)
- **type-only** — loses type info but compiles fine

## supported languages

- ✅ TypeScript / JavaScript (full)
- ⏳ Python, Go, Rust (detected but not yet implemented — tree-sitter planned)

## roadmap

- cascade impact analysis (depth > 1)
- test file impact classification
- config and runtime scan (env vars, CI, Dockerfile)
- local cache in `.blast/cache.json`
- HTML report
- tree-sitter support for Python, Go, Rust

## license

MIT — see [LICENSE](LICENSE)
