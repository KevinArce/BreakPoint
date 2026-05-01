# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| Latest release | ✅ |
| Older releases | ❌ |

Only the latest release receives security updates.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

To report a security vulnerability, use [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) if enabled on this repository. If private reporting is not enabled yet, contact the repository maintainer directly before sharing details publicly.

Include:

- A description of the vulnerability.
- Steps to reproduce or a proof of concept.
- The potential impact.
- Any suggested fix, if you have one.

## Response Timeline

- **Acknowledgment**: Within 48 hours.
- **Initial assessment**: Within 5 business days.
- **Fix or mitigation**: As soon as practical, targeting 30 days for critical issues.

We will coordinate disclosure timing with you. We will not pursue legal action against researchers who report vulnerabilities responsibly.

## Scope

The following are in scope:

- The Probot application code in `src/`.
- The GitHub Actions workflow and composite action in `.github/`.
- The quality gate scripts in `scripts/`.
- Configuration parsing and validation in `src/config.ts`.

The following are out of scope:

- Vulnerabilities in upstream dependencies (report these to the upstream project).
- GitHub's infrastructure or API.
- Social engineering attacks.

## Security Design

BreakPoint follows these security principles:

- **Secrets are never logged.** Actions mode uses the built-in `GITHUB_TOKEN`. Standalone mode uses `PRIVATE_KEY` and `WEBHOOK_SECRET`; no code path should print these values to stdout or stderr.
- **No telemetry.** The app does not phone home, collect analytics, or transmit data outside of the GitHub API.
- **Minimal permissions.** The app requests only the permissions it needs: Checks (read/write), Contents (read), and Pull requests (read/write). See the [README](README.md#permissions-and-webhook-events) for a full explanation of why each permission is needed.
- **Optional Snyk token.** The `SNYK_TOKEN` is only used when `quality_gates.dependency_risk.snyk.enabled` is `true`. If the token is missing, the gate is skipped with a warning — it never causes a build failure or logs the token's absence as an error.
- **Config validation.** All user-supplied configuration is validated with Zod schemas. Invalid config fails fast with a clear error message rather than silently accepting bad input.
