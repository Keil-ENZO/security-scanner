# Contributing

Thanks for helping. Bugs, ideas and pull requests are welcome.

For a vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Local setup

Requirements: Node 24 and pnpm. The scanners are only needed to run real scans.

```bash
pnpm install
cp .env.example .env
node scripts/hash-password.mjs
scripts/install-tool.sh ~/.local/bin trivy syft grype nuclei
pnpm dev
```

## Before opening a pull request

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same checks, plus the security scans and a Docker smoke test.

## Guidelines

- Keep a pull request focused on one change.
- Add tests for new parsing, allowlist or crypto logic.
- Never run code from a scanned repository. Scanners run without a shell and with a minimal environment: keep it that way.
- Never render scanner output as HTML. No `v-html`.
- Write code, comments and docs in English.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org) when possible: `fix:`, `feat:`, `chore:`.

## Scanner versions

Scanner versions live in `scripts/tools.env`. A bump there updates the Docker image and the CI together.
