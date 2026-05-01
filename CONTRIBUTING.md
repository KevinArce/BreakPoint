# Contributing to BreakPoint

Thank you for your interest in contributing to BreakPoint! This guide will help you get set up and understand our development workflow.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Running the App Locally](#running-the-app-locally)
- [Code Style](#code-style)
- [Adding a Quality Gate](#adding-a-quality-gate)
- [Testing](#testing)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 20 | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage versions. |
| pnpm | See `packageManager` in `package.json` | Install via `corepack enable && corepack prepare` or `npm install -g pnpm`. |
| Git | ≥ 2.30 | |

## Getting Started

```bash
# Clone the repository
git clone https://github.com/KevinArce/BreakPoint.git
cd BreakPoint

# Install dependencies
pnpm install

# Verify setup
pnpm typecheck   # Should report 0 errors
pnpm test        # Should report all tests passing
```

## Development Workflow

### Commands

| Command | Description |
| --- | --- |
| `pnpm install` | Install all dependencies. |
| `pnpm typecheck` | Run TypeScript type checking (`tsc --noEmit`). |
| `pnpm test` | Run the full test suite once. |
| `pnpm test:watch` | Re-run tests on file changes. |
| `pnpm test:coverage` | Run tests and generate a coverage report. |
| `pnpm build` | Compile TypeScript to `dist/`. |
| `pnpm start` | Start the Probot app locally (requires `.env`). |
| `pnpm generate:openapi` | Run the OpenAPI schema generation script. |

### Project Structure

```
src/
├── index.ts                  # Probot entry point — registers event handlers
├── config.ts                 # Zod-validated config loader
├── types.ts                  # Shared TypeScript types
├── handlers/
│   ├── pull-request.ts       # PR open/sync/reopen handler
│   └── label-override.ts     # Override label handler
└── lib/
    ├── check-runs.ts         # Check Run create/update
    ├── comment-builder.ts    # Markdown report builder
    ├── comments.ts           # PR comment upsert
    ├── package-manager.ts    # Package manager detection
    ├── schema-differ.ts      # OpenAPI diff wrapper
    ├── version-enforcer.ts   # Semver bump enforcement
    └── quality-gates/
        ├── types.ts          # Quality gate result loader
        ├── dead-code.ts      # knip/ts-prune integration
        ├── dependency-risk.ts # npm audit/Snyk integration
        ├── performance-budget.ts # autocannon benchmarking
        └── test-impact.ts    # nx/turbo/vitest/jest detection

scripts/
├── generate-openapi.ts       # Schema generation script
└── quality-gates/
    ├── run-dead-code.ts
    ├── run-dependency-risk.ts
    ├── run-performance-budget.ts
    └── run-test-impact.ts

test/
├── fixtures/                 # OpenAPI schema fixtures
├── config.test.ts
├── comment-builder.test.ts
├── package-manager.test.ts
├── schema-differ.test.ts
└── version-enforcer.test.ts
```

## Running the App Locally

To test the Probot app against a real GitHub repository:

### 1. Register a GitHub App

Follow the [standalone GitHub App registration](README.md#standalone-github-app-registration) instructions in the README. Use a test organization or personal repository.

### 2. Set up webhook proxying

```bash
# Install smee-client globally
npm install -g smee-client

# Start the proxy (use the URL from smee.io)
smee -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/api/github/webhooks
```

### 3. Create a `.env` file

```env
APP_ID=12345
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
WEBHOOK_SECRET=your-webhook-secret
WEBHOOK_PROXY_URL=https://smee.io/YOUR_CHANNEL
LOG_LEVEL=debug
```

The `.env` file is gitignored. Never commit it.

### 4. Start the app

```bash
pnpm start
```

### 5. Trigger a webhook

Open a PR on the repository where the app is installed. The smee proxy forwards the event to your local Probot instance.

## Code Style

### TypeScript

- **Strict mode** is enabled (`strict: true`, `noUncheckedIndexedAccess: true`).
- Do not use `any`. Use `unknown`, Zod validation, and type guards instead.
- The only exceptions are `Context<any>` workarounds for Probot's TS2590 union complexity, which must be annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`.

### Probot Patterns

- Use `context.octokit` for all GitHub API calls.
- Use `context.repo()` for owner/repo context.
- Use `context.payload` for event data.
- Do not use raw `fetch` or raw `GITHUB_TOKEN` calls inside the Probot layer.

### Configuration

- All user-facing config comes from `.github/api-contract.yml`.
- Config is validated with Zod schemas in `src/config.ts`.
- Do not hardcode schema paths, version files, or script names.
- Do not rename config fields without a migration path and a changelog entry.

### General

- No `TODO` stubs or placeholder implementations in production code.
- Never log secrets, especially `PRIVATE_KEY` in standalone mode and third-party scanner tokens such as `SNYK_TOKEN`.
- Keep `src/index.ts` small — logic belongs in handlers and libraries.

## Adding a Quality Gate

Quality gates are modular. To add a new gate:

### 1. Add the config fields

Add a new sub-schema to `src/config.ts` under `qualityGatesConfigSchema`. Include an `enabled: boolean` field defaulting to `false`.

### 2. Implement the gate library

Create `src/lib/quality-gates/your-gate.ts`. The function should:

- Accept config options.
- Run the underlying tool.
- Return a `QualityGateResult` object.
- Write a JSON report to the output directory.

### 3. Add a runner script

Create `scripts/quality-gates/run-your-gate.ts` that reads config from environment variables, calls the library function, and exits with the appropriate code.

### 4. Register the report file

Add the filename to `GATE_FILES` in `src/lib/quality-gates/types.ts` so the loader picks it up.

### 5. Add tests

Add unit tests for the library function. Use fixtures, not live network calls.

### 6. Update documentation

- Add the gate to the config reference in `README.md`.
- Add an example in the configuration examples section.
- Mention the gate in `CHANGELOG.md`.

## Testing

### Writing Tests

- Tests live in `test/` and use [Vitest](https://vitest.dev/).
- Use `describe` / `it` blocks. Write descriptive test names.
- External tools and APIs must be mocked or use fixtures.
- Use snapshot tests only for stable Markdown output.
- Config tests should cover every documented config example.

### Running Tests

```bash
pnpm test                # Full suite
pnpm test:watch          # Watch mode
pnpm test:coverage       # With coverage
```

### CI

Tests run automatically on every PR via GitHub Actions. A PR must pass `pnpm typecheck` and `pnpm test` before it can be merged.

## Submitting Changes

1. **Fork** the repository and create a feature branch from `main`.
2. Make your changes. Write tests. Run `pnpm typecheck && pnpm test`.
3. Write a clear commit message. Use [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat: add new quality gate for bundle size`
   - `fix: handle empty schema diff correctly`
   - `docs: update config reference for performance budget`
4. Open a **pull request** targeting `main`.
5. Fill out the PR template.
6. Wait for CI checks and a code review.

### What Makes a Good PR

- Focused: one feature or fix per PR.
- Tested: includes tests for new behavior.
- Documented: updates README or config reference if user-facing behavior changes.
- Clean: no unrelated formatting changes, no leftover debug code.

## Release Process

BreakPoint follows [Semantic Versioning](https://semver.org/):

- **Major**: Breaking changes to config schema, removal of features, or changes to PR comment format that could break user workflows.
- **Minor**: New features, new quality gates, new config fields with defaults.
- **Patch**: Bug fixes, documentation improvements, dependency updates.

### Release Checklist

1. Update `version` in `package.json`.
2. Update `CHANGELOG.md` with the new version and date.
3. Run `pnpm typecheck && pnpm test`.
4. Commit: `git commit -m "chore: release vX.Y.Z"`.
5. Tag: `git tag vX.Y.Z`.
6. Push: `git push origin main --tags`.

### Changelog Format

See [CHANGELOG.md](CHANGELOG.md) for the format. Each release lists changes under `Added`, `Changed`, `Fixed`, or `Removed`.
