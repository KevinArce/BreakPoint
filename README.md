# BreakPoint

BreakPoint is a TypeScript [Probot](https://probot.github.io/) GitHub App that enforces API contract integrity on pull requests. It generates and compares OpenAPI schemas between the PR branch and the base branch, validates that version bumps match the scope of the change, and reports results through a GitHub Check Run and a single idempotent PR comment. Optional quality gates cover dead code, dependency risk, performance budgets, and test impact analysis.

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [GitHub App Registration](#github-app-registration)
- [Permissions and Webhook Events](#permissions-and-webhook-events)
- [Secrets](#secrets)
- [Configuration Reference](#configuration-reference)
- [Configuration Examples](#configuration-examples)
- [Override Label Behavior](#override-label-behavior)
- [Quality Gates](#quality-gates)
- [Local Development](#local-development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

## Architecture

BreakPoint has two cooperating layers:

| Layer | Responsibility |
| --- | --- |
| **Probot App** | Owns all GitHub API interaction: config loading, PR event handling, Check Runs, comments, labels, overrides, and annotations. |
| **GitHub Actions** | Owns compute: checkout, dependency install, OpenAPI schema generation, optional quality-gate scanners, and artifact upload. |

```
┌──────────────────────────────────────────────────┐
│              GitHub Actions Workflow              │
│                                                  │
│  1. Checkout PR branch (full history)            │
│  2. Detect package manager (npm/pnpm/yarn)       │
│  3. Install dependencies                         │
│  4. Run generate script → PR schema              │
│  5. Checkout base branch                         │
│  6. Install dependencies                         │
│  7. Run generate script → base schema            │
│  8. Invoke composite Probot action               │
│  9. Upload schema artifacts (7-day retention)    │
└──────────────────────┬───────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│               Probot App Layer                   │
│                                                  │
│  • Load & validate .github/api-contract.yml      │
│  • Diff schemas (openapi-diff)                   │
│  • Enforce semantic version bumps                │
│  • Create or update Check Run (idempotent)       │
│  • Upsert PR comment with report (idempotent)    │
│  • Handle override label                         │
│  • Aggregate quality gate results                │
└──────────────────────────────────────────────────┘
```

The Probot app supports two deployment modes:

1. **GitHub Actions** (primary) — via `@probot/adapter-github-actions`.
2. **Standalone webhook server** (optional) — for Railway, Fly.io, or similar.

## Quick Start

Use a test repository to try BreakPoint before deploying to production.

### 1. Fork or clone this repository

```bash
git clone https://github.com/YOUR_ORG/breakpoint.git
cd breakpoint
pnpm install
```

### 2. Register a GitHub App

See [GitHub App Registration](#github-app-registration) below.

### 3. Add secrets to the test repository

Add `APP_ID` and `PRIVATE_KEY` as repository secrets.

### 4. Copy the workflow

Copy `.github/workflows/api-contract.yml` and `.github/actions/api-contract-probot/` into your test repository.

### 5. Create a PR with an API change

Add or remove a route, change a request or response schema, then open a PR targeting `main`. BreakPoint will post a Check Run and a PR comment summarizing the change.

### 6. (Optional) Add config

Create `.github/api-contract.yml` to customize behavior. If the file is missing, BreakPoint uses [documented defaults](#configuration-reference).

## GitHub App Registration

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Set **GitHub App name** to something unique (e.g., `breakpoint-yourorg`).
3. Set **Homepage URL** to your repository URL.
4. **Webhook URL**: Leave blank or set to `https://example.com` if using Actions-only mode. Set to your server URL if using standalone mode.
5. **Webhook secret**: Generate a random secret and save it. Only needed for standalone mode.
6. Under **Permissions**, set:
   - **Repository → Checks**: Read & Write
   - **Repository → Contents**: Read-only
   - **Repository → Pull requests**: Read & Write
7. Under **Subscribe to events**, check:
   - `Pull request`
8. Click **Create GitHub App**.
9. On the app page, note the **App ID**.
10. Scroll to **Private keys** and click **Generate a private key**. Save the downloaded `.pem` file.
11. Install the app on your target repository.

## Permissions and Webhook Events

### Required Permissions

| Permission | Access | Why |
| --- | --- | --- |
| **Checks** | Read & Write | Create and update Check Runs with the schema diff summary, annotations, and conclusion. |
| **Contents** | Read-only | Read `package.json` (or configured `version_file`) from both branches to extract version numbers. |
| **Pull requests** | Read & Write | Read PR metadata, labels, and files. Create and update the report comment. |

### Required Webhook Events

| Event | Why |
| --- | --- |
| `pull_request` | Triggers schema diffing on `opened`, `synchronize`, `reopened`, and label changes on `labeled`. |

### What the Workflow Reads

The GitHub Actions workflow reads these files from your repository:

- `.github/api-contract.yml` — app configuration (optional).
- The file at `openapi_output` — generated OpenAPI schema.
- The file at `version_file` — version string (default: `package.json`).
- Lockfiles (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`) — to detect the package manager.

The workflow does **not** collect telemetry, phone home, or transmit data outside of GitHub.

## Secrets

| Secret | Required | Description |
| --- | --- | --- |
| `APP_ID` | Yes | The numeric ID of your registered GitHub App. |
| `PRIVATE_KEY` | Yes | The PEM-encoded private key generated during app registration. **Never log or echo this value.** |
| `SNYK_TOKEN` | No | Required only when `quality_gates.dependency_risk.snyk.enabled` is `true`. If the token is missing, Snyk is skipped with a warning — it never fails the build or leaks the token. |

Secrets are passed via environment variables and are **never printed to logs**. The composite action masks `PRIVATE_KEY` using `::add-mask::`.

## Configuration Reference

Create `.github/api-contract.yml` in your repository. All fields are optional and have defaults.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `openapi_output` | `string` | `openapi/schema.json` | Path where the generate script writes the OpenAPI schema. |
| `generate_script` | `string` | `generate:openapi` | npm/pnpm/yarn script name that generates the schema. |
| `version_file` | `string` | `package.json` | JSON file containing a top-level `version` field. |
| `base_branch` | `string` | `main` | Branch that PRs are compared against. |
| `monorepo.enabled` | `boolean` | `false` | Run commands from `monorepo.api_path` instead of the repo root. |
| `monorepo.api_path` | `string` | `apps/api` | Subdirectory for the API project when monorepo mode is enabled. |
| `enforcement.breaking_requires_major` | `boolean` | `true` | Require a major version bump when breaking changes are detected. |
| `enforcement.non_breaking_requires_minor` | `boolean` | `true` | Require a minor (or major) version bump when non-breaking changes are detected. |
| `enforcement.allow_override_label` | `string` | `override-breaking-change` | PR label name that overrides enforcement failures. |
| `quality_gates.dead_code.enabled` | `boolean` | `false` | Run dead code detection. |
| `quality_gates.dead_code.tool` | `knip` \| `ts-prune` | `knip` | Dead code detection tool. |
| `quality_gates.dead_code.max_findings` | `integer` | `0` | Maximum allowed findings before failure (when mode is `failure`). |
| `quality_gates.dead_code.mode` | `warning` \| `failure` | `warning` | Whether findings cause a warning or a hard failure. |
| `quality_gates.dependency_risk.enabled` | `boolean` | `true` | Run dependency vulnerability scanning. |
| `quality_gates.dependency_risk.npm_audit_level` | `low` \| `moderate` \| `high` \| `critical` | `high` | Minimum severity to fail on via `npm audit`. |
| `quality_gates.dependency_risk.snyk.enabled` | `boolean` | `false` | Also run Snyk vulnerability scanning. |
| `quality_gates.dependency_risk.snyk.severity_threshold` | `low` \| `medium` \| `high` \| `critical` | `high` | Minimum Snyk severity to fail on. |
| `quality_gates.performance_budget.enabled` | `boolean` | `false` | Run performance benchmarks. |
| `quality_gates.performance_budget.start_command` | `string` | `start` | npm script that starts the application server. |
| `quality_gates.performance_budget.warmup_seconds` | `integer` | `10` | Seconds to wait after the server is healthy before benchmarking. |
| `quality_gates.performance_budget.regression_threshold_percent` | `number` | `10` | Percentage regression that triggers a warning. |
| `quality_gates.performance_budget.endpoints` | `array` | `[]` | List of `{ method, path }` objects to benchmark. |
| `quality_gates.test_impact.enabled` | `boolean` | `false` | Run test impact analysis. |
| `quality_gates.test_impact.strategy` | `auto` \| `nx` \| `turbo` \| `vitest` \| `jest` \| `full` | `auto` | Strategy for determining which tests to run. |
| `quality_gates.test_impact.fallback_to_full_suite` | `boolean` | `true` | Fall back to running all tests if impact analysis fails. |

## Configuration Examples

### Basic — API enforcement only

```yaml
# .github/api-contract.yml
api-contract:
  generate_script: generate:openapi
  version_file: package.json
```

### Monorepo

```yaml
# .github/api-contract.yml
api-contract:
  monorepo:
    enabled: true
    api_path: packages/api
  generate_script: generate:openapi
  version_file: package.json
```

### Custom override label

```yaml
# .github/api-contract.yml
api-contract:
  enforcement:
    allow_override_label: api-break-approved
```

### Full quality gates

```yaml
# .github/api-contract.yml
api-contract:
  quality_gates:
    dead_code:
      enabled: true
      tool: knip
      max_findings: 0
      mode: failure
    dependency_risk:
      enabled: true
      npm_audit_level: moderate
      snyk:
        enabled: true
        severity_threshold: high
    performance_budget:
      enabled: true
      start_command: start:prod
      warmup_seconds: 15
      regression_threshold_percent: 5
      endpoints:
        - method: GET
          path: /health
        - method: GET
          path: /api/v1/status
    test_impact:
      enabled: true
      strategy: vitest
      fallback_to_full_suite: true
```

## Override Label Behavior

When the configured override label (default: `override-breaking-change`) is added to a PR:

- Breaking changes are **still reported** in the PR comment and Check Run.
- Version enforcement failures are **downgraded** — the Check Run conclusion becomes `neutral` instead of `failure`.
- The PR comment clearly states that enforcement was overridden.
- Breaking changes are **never hidden** — the override only affects whether the check blocks merging.

The override applies only to API contract enforcement. Quality gate failures are not overridden unless explicitly configured.

## Quality Gates

All quality gates are **optional** and **disabled by default** (except `dependency_risk`, which runs `npm audit` by default). Each gate runs as a standalone script, produces a JSON report, and integrates into the PR comment and Check Run.

| Gate | Tool | Default | Notes |
| --- | --- | --- | --- |
| Dead Code | knip / ts-prune | Disabled | `knip` is recommended for new projects. |
| Dependency Risk | npm audit / Snyk | Enabled (npm audit only) | Snyk requires `SNYK_TOKEN`. |
| Performance Budget | autocannon | Disabled | Best used in warning mode until baselines stabilize. |
| Test Impact | nx / turbo / vitest / jest | Disabled | `auto` detects the tool from config files. |

## Local Development

### Prerequisites

- Node.js ≥ 20
- pnpm (see `packageManager` in `package.json` for the exact version)

### Setup

```bash
git clone https://github.com/YOUR_ORG/breakpoint.git
cd breakpoint
pnpm install
```

### Running the Probot app locally

1. Install [smee.io](https://smee.io/) for webhook proxying:

   ```bash
   npx smee -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/api/github/webhooks
   ```

2. Create a `.env` file (this file is gitignored):

   ```env
   APP_ID=12345
   PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
   WEBHOOK_SECRET=your-webhook-secret
   WEBHOOK_PROXY_URL=https://smee.io/YOUR_CHANNEL
   LOG_LEVEL=debug
   ```

3. Start the app:

   ```bash
   pnpm start
   ```

4. Open a PR on a repository where the app is installed. The smee proxy forwards the webhook to your local instance.

## Testing

```bash
pnpm test              # Run all tests
pnpm test:watch        # Re-run tests on file changes
pnpm test:coverage     # Run tests with coverage report
pnpm typecheck         # Check types without emitting
```

All tests use [Vitest](https://vitest.dev/) and can be run without network access. Schema diffing tests use fixture files in `test/fixtures/`.

## Troubleshooting

### Check Run does not appear

- Verify the GitHub App has **Checks: Read & Write** permission.
- Verify the app is installed on the target repository.
- Check the Actions workflow log for errors.
- Ensure `APP_ID` and `PRIVATE_KEY` secrets are set and correct.

### PR comment is not posted

- Verify the GitHub App has **Pull requests: Read & Write** permission.
- Ensure the workflow has `pull-requests: write` in its `permissions` block.

### Config validation error in the PR comment

- Ensure `.github/api-contract.yml` uses valid YAML syntax.
- Refer to the [Configuration Reference](#configuration-reference) for valid field names and types.
- All fields have defaults — remove unrecognized fields to use defaults.

### Schema generation fails

- Ensure the `generate_script` (default: `generate:openapi`) exists in your `package.json` scripts.
- Verify the script writes valid JSON to the `openapi_output` path (default: `openapi/schema.json`).
- For monorepos, ensure `monorepo.api_path` points to the correct subdirectory.

### Version file not found

- Ensure `version_file` (default: `package.json`) exists on both the PR and base branches.
- The file must contain a top-level `"version"` field with a valid semver string.

### Snyk token missing

- Snyk scanning requires `SNYK_TOKEN` as a repository secret.
- If the token is missing and Snyk is enabled, the gate is **skipped** with a clear warning.
- The missing token is never logged or treated as a build failure.

### Duplicate comments

- BreakPoint uses a hidden HTML marker (`<!-- api-contract-report -->`) to find its own comments. If you see duplicates, ensure no other tool creates comments starting with the same marker.

## Security

For security vulnerabilities, please see [SECURITY.md](SECURITY.md).

BreakPoint does not collect telemetry. The workflow and Probot app communicate only with the GitHub API. No data is sent to third-party services unless you explicitly enable Snyk scanning.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, coding standards, and how to submit changes.

## License

[MIT](LICENSE)
