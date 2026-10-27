# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability.

Report it privately through [GitHub private vulnerability reporting](https://github.com/Keil-ENZO/security-scanner/security/advisories/new). Include:

- the affected version or commit
- how to reproduce it
- what an attacker gains

You get a first answer within 7 days. Once a fix ships, the advisory is published and you are credited, unless you prefer not to be.

## Supported versions

Only the latest release gets security fixes.

## Scope

In scope:

- the web interface and its API
- the guardrails listed in the README: allowlists, credential handling, subprocess isolation, token checks
- the Docker image and the release pipeline

Out of scope:

- vulnerabilities in Trivy, Syft, Grype, Semgrep, Nuclei or Ollama themselves. Report them upstream
- findings that need the interface exposed to the internet without TLS or authentication, against the README advice
- scanning targets you are not authorised to test

## Verifying releases

Images are signed with cosign and carry SBOM attestations. See "Verify the image" in the README.
