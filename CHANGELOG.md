# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-01

### Added

- Probot app entry point with `pull_request.opened`, `pull_request.synchronize`, `pull_request.reopened`, and `pull_request.labeled` event handlers.
- Zod-validated configuration system for `.github/api-contract.yml` with documented defaults.
- OpenAPI schema diffing via `openapi-diff` with classification into breaking, non-breaking, and patch changes.
- Semantic version bump enforcement with configurable rules for breaking and non-breaking changes.
- Idempotent GitHub Check Run management (`API Contract` check).
- Idempotent PR comment with hidden marker (`<!-- api-contract-report -->`).
- Markdown report builder with summary table, change sections, version enforcement, override status, and quality gates.
- Override label support (default: `override-breaking-change`) that downgrades enforcement failures without hiding breaking changes.
- Package manager detection for npm, pnpm, and yarn.
- OpenAPI schema generation script with Zod and ts-json-schema-generator paths.
- GitHub Actions workflow for schema generation on both branches.
- Composite GitHub Action for invoking the Probot app.
- Dead code quality gate (knip / ts-prune).
- Dependency risk quality gate (npm audit / Snyk).
- Performance budget quality gate (autocannon).
- Test impact analysis quality gate (nx / turbo / vitest / jest).
- Quality gate runner scripts.
- Test suite: 75 tests covering config, package manager, version enforcer, comment builder, and schema differ.
- README with architecture overview, setup guide, config reference, and troubleshooting.
- CONTRIBUTING.md with development workflow and code style guide.
- SECURITY.md with vulnerability reporting instructions.
- CODE_OF_CONDUCT.md (Contributor Covenant v2.1).
- Issue templates for bug reports and feature requests.
- Pull request template.
- Dependabot configuration for automated dependency updates.

[Unreleased]: https://github.com/YOUR_ORG/breakpoint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/YOUR_ORG/breakpoint/releases/tag/v0.1.0
