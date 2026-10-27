# Security Scanner

[![CI](https://github.com/Keil-ENZO/security-scanner/actions/workflows/ci.yml/badge.svg)](https://github.com/Keil-ENZO/security-scanner/actions/workflows/ci.yml)
[![Security](https://github.com/Keil-ENZO/security-scanner/actions/workflows/security.yml/badge.svg)](https://github.com/Keil-ENZO/security-scanner/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Keil-ENZO/security-scanner/badge)](https://scorecard.dev/viewer/?uri=github.com/Keil-ENZO/security-scanner)

Self-hosted security audits for your own sites and repositories.

Give it a GitHub repository, a URL and, if needed, test credentials. It runs open source scanners, builds an SBOM, normalises the results and writes a short report with a local LLM. It can open a pull request with dependency upgrades and security headers, then follow it to production.

Code and findings never leave your machine.

## What gets scanned

| Surface | Tool |
|---|---|
| SBOM, CycloneDX, downloadable per scan | Syft |
| Vulnerable dependencies, read from the SBOM | Grype |
| Secrets, Dockerfile and IaC misconfigurations | Trivy |
| Code, static analysis | Semgrep, `p/default` rules |
| Live site | Nuclei, no intrusive or DoS templates, 30 requests/s |
| Report | Ollama, local. Optional: without it the report is plain text |

## Guardrails

A leaky security tool would be ironic.

1. **GitHub owner allowlist.** Outside the list, no repository is cloned.
2. **Domain allowlist.** Outside the list, no site is scanned. Checked again on every scan.
3. **Scanners run as subprocesses, never through a shell.** They get a minimal environment and see none of the app secrets.
4. **GitHub token through `GIT_ASKPASS`.** It never shows in a URL or on a command line.
5. **Test credentials encrypted at rest** with AES-256-GCM. Passed to Nuclei through a `0600` file scoped to the domain, deleted after the scan.
6. **No `v-html`.** Findings come from external sources and render as text.
7. **Token-protected automation.** `/api/automation/*` needs a bearer token, compared in constant time. Starting a batch while one runs returns the running batch.

Only scan targets you own, or that you have written permission to test.

## Quick start

Requirements: Node 24, pnpm, and `trivy`, `syft`, `grype`, `semgrep`, `nuclei` in the `PATH`. Ollama is optional.

`scripts/install-tool.sh ~/.local/bin trivy syft grype nuclei` installs the pinned versions with the same checks as the image.

```bash
pnpm install
cp .env.example .env    # then fill it in, see the comments
node scripts/hash-password.mjs
pnpm dev
```

## Docker

Released images ship with every scanner. Each binary is checked against its release checksums, and cosign verifies the signature of those checksums when the project publishes one. Images are signed with cosign and carry a Syft SBOM, in CycloneDX and SPDX, plus a SLSA provenance attestation.

```yaml
services:
  security-scanner:
    image: ghcr.io/keil-enzo/security-scanner:0.5
    restart: unless-stopped
    env_file: .env
    environment:
      NITRO_HOST: 0.0.0.0
      NUXT_OLLAMA_URL: http://host.docker.internal:11434
    extra_hosts:
      - host.docker.internal:host-gateway
    ports:
      - 127.0.0.1:3003:3003
    volumes:
      - ./data:/data
```

The image listens on `127.0.0.1` by default. That suits `network_mode: host`. With a port mapping, set `NITRO_HOST=0.0.0.0` and keep the published port on `127.0.0.1`. Put a reverse proxy with TLS, a VPN or a tailnet in front: the interface should not face the internet.

### Verify the image

```bash
cosign verify ghcr.io/keil-enzo/security-scanner:0.5 \
  --certificate-identity-regexp '^https://github.com/Keil-ENZO/security-scanner/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

cosign verify-attestation ghcr.io/keil-enzo/security-scanner:0.5 --type cyclonedx \
  --certificate-identity-regexp '^https://github.com/Keil-ENZO/security-scanner/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  | jq -r .payload | base64 -d | jq .predicate > sbom.cdx.json

gh attestation verify oci://ghcr.io/keil-enzo/security-scanner:0.5 --owner Keil-ENZO
```

## Configuration

Everything goes through environment variables. `.env.example` lists them all.

| Variable | Required | Purpose |
|---|---|---|
| `NUXT_SESSION_PASSWORD` | yes | Session encryption, 32 characters minimum |
| `NUXT_PASSWORD_HASH` | yes | Interface password, from `scripts/hash-password.mjs` |
| `NUXT_SECRET_KEY` | yes | 32 bytes in hex, encrypts test credentials |
| `NUXT_ALLOWED_OWNERS` | yes | GitHub owners that may be cloned |
| `NUXT_ALLOWED_HOSTS` | yes | Domains that may be scanned. `*.example.com` covers subdomains |
| `NUXT_SESSION_COOKIE_SECURE` | | `false` when served over plain HTTP |
| `NUXT_GITHUB_TOKEN` | | Private repositories, fixes, reviews and merges |
| `NUXT_GIT_AUTHOR_NAME`, `NUXT_GIT_AUTHOR_EMAIL` | | Author of the fix commits |
| `NUXT_VERCEL_TOKEN` | | Build log of failed Vercel deployments |
| `NUXT_OLLAMA_URL`, `NUXT_OLLAMA_MODEL` | | Local LLM for the report |
| `NUXT_AUTOMATION_TOKEN` | | Enables `/api/automation/*`, 32 characters minimum |
| `NUXT_PUBLIC_URL` | | Interface address, for links in notifications |
| `NUXT_PUBLIC_INSTANCE_NAME` | | Shown in the top bar |
| `NUXT_PUBLIC_TIME_ZONE`, `NUXT_PUBLIC_LOCALE` | | Date display, `UTC` and `en-GB` by default |
| `NUXT_TELEGRAM_BOT_TOKEN`, `NUXT_TELEGRAM_CHAT_ID` | | Telegram notifications |
| `NUXT_SLACK_WEBHOOK_URL` | | Slack incoming webhook |
| `NUXT_DISCORD_WEBHOOK_URL` | | Discord webhook |
| `NUXT_WEBHOOK_URL` | | Generic webhook, receives `POST {"text": "..."}` |

### GitHub token

Use a fine-grained token limited to the repositories you scan.

- **Contents**: read to clone private repositories, write to push fix branches and merge.
- **Pull requests**: write, to open and merge pull requests.
- **Commit statuses** and **Checks**: read, for the Vercel preview and CI state.

`git` runs without global or system config: no credential other than this token can be used.

## Fix, review, merge

1. **Fix** pushes a `security/scan-N-fix-M` branch, then scans it. Nothing lands on the default branch.
2. **Branches**: the repository branches, read from GitHub. Each one can be scanned. A branch is only tested through its code: the live site is production.
3. **Review**: branch scan compared with the default branch scan, Vercel preview, commits, diff file by file.
4. **Approve** opens the pull request.
5. **Merge** squashes. Blocked until the latest commit is scanned, the preview is green, the branch is up to date with the base, and it introduces no finding. These conditions are checked again on the server, and GitHub refuses the merge if a commit lands in between. The branch is then deleted and the default branch scanned again.
6. **Update** a branch that is behind: the base is merged into it, the preview and the scan run again. On conflict, a `security/*` branch is recreated from the current base, and the old one and its PR are closed.
7. **Production.** After the merge, the Vercel deployment is followed for up to 20 min and the result is sent as a notification. The target page shows the production state. With `NUXT_VERCEL_TOKEN`, the build log of a failed deployment shows up, for production and previews.

How fixes work:

- **npm dependencies.** A direct dependency is raised in `package.json`. A transitive one gets an `override` scoped to the vulnerable version, `"proxy-addr@2.0.7": "2.0.8"`. A major version is never forced on a transitive dependency.
- **Lockfile** regenerated with `npm install --package-lock-only --ignore-scripts`: no code from the repository runs. Then `npm ci --dry-run`, the way Vercel will install it. An override that breaks an exact peer, `@tiptap/core` without `@tiptap/pm`, goes back to the manual list.
- **Verification.** Grype runs again on the branch. Only what it no longer sees is marked fixed.
- **HTTP headers** added to `vercel.json`, only the ones that cannot break anything. CSP and `Cross-Origin-*` stay manual.
- **The local LLM** never touches the code. It writes in the PR what to test in the preview.

## Scheduled audits

Mark targets as scheduled, then call the automation API from any scheduler: cron, a systemd timer, a CI job or an agent.

```bash
batch=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3003/api/automation/scan)
# then GET /api/automation/report?batch=$batch: 202 while running, 200 with the summary
```

`examples/scheduled-scan.sh` does the polling and prints the summary. Add `NOTIFY=1` to also send it to the configured channels. Every Thursday at 8 pm:

```cron
0 20 * * 4  NOTIFY=1 /opt/security-scanner/examples/scheduled-scan.sh
```

An agent like [Hermes](https://github.com/NousResearch/hermes-agent) can run the same script in a no-agent cron and post its output as is.

## Development

```bash
pnpm lint        # ESLint, Nuxt config with stylistic rules
pnpm typecheck   # vue-tsc through nuxt typecheck
pnpm test        # Vitest: allowlists, crypto, scanner parsers, version picking
pnpm build
```

## Supply chain

- **CI** runs lint, typecheck, tests, build, and a smoke test of the Docker image on every push and PR.
- **The scanner scans itself.** Syft with Grype, Trivy for secrets and misconfigurations, and Semgrep on every push, plus CodeQL. Results go to the Security tab. Fixable high and critical issues fail the build. The source SBOM is kept as a build artifact.
- **Dependency review** blocks PRs that add a high severity vulnerability.
- **Pinned everything.** GitHub Actions by commit SHA, base images by digest. Dependabot keeps them current. Scanner versions live in `scripts/tools.env`, bumped by hand.
- **Verified downloads.** `scripts/install-tool.sh` trusts one pinned hash, the cosign binary. Cosign then verifies the signed checksums of Trivy, Syft and Grype before any archive is used.
- **Releases** on `v*` tags: image on GHCR, SBOM by Syft, Grype blocks fixable high and critical vulnerabilities, cosign signs the image and attests the SBOM. SLSA provenance on top.
- **OpenSSF Scorecard** publishes the repository score weekly.

## Stack

Nuxt 4 · Nitro · SQLite through `node:sqlite` · nuxt-auth-utils · Docker

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE). Provided as is, without warranty. You are responsible for only scanning targets you are authorised to test.
