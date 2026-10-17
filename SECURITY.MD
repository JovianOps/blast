# Security

## reporting a vulnerability

found a security issue? don't open a public issue — email me directly or open a private issue on github.

you'll get a response within 48h. if it's a real issue, i'll patch and release asap.

## what to include

- description of the vulnerability
- steps to reproduce
- any suggested fixes (optional but helpful)

## scope

blast is a static analysis CLI — it only reads your files. it doesn't ship a server or expose any network. the main risks are:
- path traversal via `--root` or `--tsconfig` (both are validated)
- parser issues from untrusted files (babel runs in the same process)

## out of scope

- theoretical vulnerabilities in third-party dependencies (babel, chalk, commander)
- issues requiring a running server (this is a CLI only)
