# Contributing to Blast

thanks for wanting to make blast better ❤️

## setup

this is a typescript project. you'll need node 20+ and pnpm (or any package manager).

```bash
# clone it
git clone https://github.com/athallajovian9-cyber/blast.git
cd blast

# install deps
pnpm install   # or npm i / yarn

# build
pnpm build     # tsc

# dev mode (no build needed)
pnpm dev
```

## running locally

```bash
# from the project root, try deleting a file
pnpm dev -- delete src/index.ts

# or from another directory
node dist/index.js delete ./some-file.ts
```

## testing

```bash
pnpm test
```

## code style

- typescript with strict mode
- `node:fs`, `node:path` — builtin modules only
- `node:` prefix for stdlib imports
- babel parser + traversal for AST work
- chalk for terminal output

## contributing

1. fork it
2. `git checkout -b feat/your-thing`
3. make your changes
4. `pnpm test` — make sure stuff still works
5. `git commit -am 'add: your thing'`
6. open a PR

## issues

found a bug? open an issue with:
- a repo or file that triggers the problem
- what you expected vs what actually happened
- your node version (`node --version`)
- blast version (`blast --version` or check package.json)

or just grab an issue with the `good first issue` label and go from there.
