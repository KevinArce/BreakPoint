# AI Coding Agent Implementation Plan

## Project

Build a TypeScript Probot GitHub App that enforces API contract integrity on pull requests by comparing generated OpenAPI schemas between the PR branch and the base branch, validating semantic version bumps, and reporting results through GitHub Check Runs and a single idempotent PR comment.

This repository is currently treated as a greenfield implementation.

## Target Architecture

The implementation has two cooperating layers:

| Layer | Responsibility |
| --- | --- |
| Probot App | Owns all GitHub API interaction: config loading, PR event handling, Check Runs, comments, labels, overrides, annotations |
| GitHub Actions | Owns compute: checkout, dependency install, OpenAPI schema generation, optional scanners, benchmark execution, artifact upload |

The Probot app must support two deployment modes:

1. GitHub Actions-compatible execution via `@probot/adapter-github-actions`.
2. Optional standalone webhook server deployment for Railway, Fly.io, or similar.

The Actions-compatible path is the primary implementation target.

## Hard Constraints

- Use TypeScript with `strict: true`.
- Do not use `any`; use `unknown`, Zod validation, and type guards.
- Use Probot patterns only for GitHub interactions:
  - `context.octokit`
  - `context.repo()`
  - `context.payload`
- Do not use raw `fetch` or raw `GITHUB_TOKEN` calls inside the Probot layer.
- All user-facing configuration must come from `.github/api-contract.yml`.
- Check Runs and PR comments must be idempotent.
- Do not hardcode schema, version, script, or monorepo paths.
- Never log secrets, especially `PRIVATE_KEY`.
- Do not leave pseudo-code, `TODO` stubs, or placeholder implementations in production code.

## Expected File Structure

```text
.
├── src/
│   ├── index.ts
│   ├── handlers/
│   │   ├── pull-request.ts
│   │   └── label-override.ts
│   ├── lib/
│   │   ├── check-runs.ts
│   │   ├── comment-builder.ts
│   │   ├── comments.ts
│   │   ├── package-manager.ts
│   │   ├── schema-differ.ts
│   │   ├── schema-generator.ts
│   │   ├── version-enforcer.ts
│   │   └── quality-gates/
│   │       ├── dead-code.ts
│   │       ├── dependency-risk.ts
│   │       ├── performance-budget.ts
│   │       ├── test-impact.ts
│   │       └── types.ts
│   ├── config.ts
│   └── types.ts
├── scripts/
│   ├── generate-openapi.ts
│   └── quality-gates/
│       ├── run-dead-code.ts
│       ├── run-dependency-risk.ts
│       ├── run-performance-budget.ts
│       └── run-test-impact.ts
├── test/
│   ├── fixtures/
│   │   ├── openapi-base.json
│   │   ├── openapi-breaking.json
│   │   ├── openapi-non-breaking.json
│   │   └── package-json/
│   ├── comment-builder.test.ts
│   ├── config.test.ts
│   ├── package-manager.test.ts
│   ├── schema-differ.test.ts
│   └── version-enforcer.test.ts
├── .github/
│   ├── actions/
│   │   └── api-contract-probot/
│   │       └── action.yml
│   └── workflows/
│       └── api-contract.yml
├── openapi/
│   └── .gitkeep
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Phase 1: Bootstrap the Project

### Tasks

1. Initialize `package.json` for a TypeScript Probot app.
2. Configure `pnpm` as the preferred package manager.
3. Add TypeScript config with strict checks.
4. Add Vitest config.
5. Add lint/type/test scripts.
6. Add `.gitignore` entries for generated schemas, build output, coverage, and environment files.

### Required Dependencies

Runtime:

- `probot`
- `@probot/adapter-github-actions`
- `@probot/octokit-plugin-config`
- `zod`
- `semver`
- `openapi-diff`
- `yaml`

Development:

- `typescript`
- `tsx`
- `vitest`
- `@types/node`
- `@types/semver`
- `ts-json-schema-generator`
- `zod-to-openapi` or its maintained equivalent used by the chosen OpenAPI generator

Quality-gate dependencies should be added only when the corresponding gate is implemented:

- `knip`
- `ts-prune`, optional compatibility only
- `snyk`, optional
- `autocannon`

### Acceptance Criteria

- `pnpm typecheck` runs without TypeScript errors.
- `pnpm test` runs and finds the initial test suite.
- No `any` types are introduced.

## Phase 2: Configuration System

### Goal

Create a Zod-validated config loader for `.github/api-contract.yml`.

### Config Shape

```yaml
api-contract:
  openapi_output: openapi/schema.json
  generate_script: generate:openapi
  version_file: package.json
  base_branch: main
  monorepo:
    enabled: false
    api_path: apps/api
  enforcement:
    breaking_requires_major: true
    non_breaking_requires_minor: true
    allow_override_label: override-breaking-change
  quality_gates:
    dead_code:
      enabled: false
      tool: knip
      max_findings: 0
      mode: warning
    dependency_risk:
      enabled: true
      npm_audit_level: high
      snyk:
        enabled: false
        severity_threshold: high
    performance_budget:
      enabled: false
      start_command: start
      warmup_seconds: 10
      regression_threshold_percent: 10
      endpoints:
        - method: GET
          path: /health
    test_impact:
      enabled: false
      strategy: auto
      fallback_to_full_suite: true
```

### Implementation Notes

- `src/config.ts` owns defaults, Zod schemas, and typed parsing.
- The Probot handler should load config with:

```ts
const config = await context.config<ApiContractConfig>('api-contract.yml', defaults)
```

- Validate the loaded object after merging defaults.
- If config is invalid, fail the Check Run with a clear message and update the PR comment.

### Acceptance Criteria

- Missing config file uses documented defaults.
- Invalid config produces a deterministic validation error.
- Tests cover defaulting, invalid enum values, and nested overrides.

## Phase 3: Probot App Entry Point

### Goal

Register event handlers and keep `src/index.ts` intentionally small.

### Required Events

```ts
import { Probot } from 'probot'
import { handleLabelOverride } from './handlers/label-override'
import { handlePullRequest } from './handlers/pull-request'

export default (app: Probot) => {
  app.on(
    ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
    handlePullRequest
  )

  app.on('pull_request.labeled', handleLabelOverride)
}
```

### Acceptance Criteria

- All required PR events are handled.
- `pull_request.labeled` can re-evaluate an existing report when the override label is added.
- Handlers are typed against Probot context types.

## Phase 4: Check Run Management

### Goal

Create or update a deterministic GitHub Check Run for each PR head SHA.

### Implementation Notes

- Use Check Run name: `API Contract`.
- On PR open/sync/reopen:
  - create or update status to `in_progress`
  - set `started_at`
  - include a short output summary
- On completion:
  - set `completed_at`
  - conclusion is `success`, `failure`, or `neutral` depending on result and override state
  - include annotations for important breaking changes and quality gate failures

### Idempotency Strategy

1. List Check Runs for the PR head SHA.
2. Find the newest run with the exact name `API Contract`.
3. Update it when possible.
4. Create one only when no matching Check Run exists.

### Acceptance Criteria

- Re-running on `pull_request.synchronize` does not create duplicate Check Runs for the same head SHA when an existing matching run can be updated.
- Check Run output contains the schema diff summary, version enforcement summary, and quality gate summary.
- Annotation count is capped to GitHub API limits.

## Phase 5: PR Comment Upsert

### Goal

Post a single human-readable PR report and update it on future runs.

### Hidden Marker

Every generated comment must start with:

```md
<!-- api-contract-report -->
```

### Report Sections

1. API contract summary table.
2. Breaking changes.
3. Non-breaking changes.
4. Patch-only changes.
5. Version enforcement.
6. Override status.
7. Optional quality gates summary.

### Acceptance Criteria

- Existing report comments are edited.
- New comments are created only if no marker exists.
- Comment rendering is deterministic and snapshot-tested.

## Phase 6: Schema Generation Layer

### Goal

Provide a reusable local schema generation script and workflow integration.

### Implementation Notes

- `scripts/generate-openapi.ts` should:
  - detect Zod schemas where possible
  - prefer the Zod OpenAPI path if configured or discoverable
  - fallback to `ts-json-schema-generator`
  - write to configured `openapi_output`
- The GitHub Actions workflow remains responsible for running the configured package script on both PR and base branches.
- The Probot app should consume generated schema files from:
  - `PR_SCHEMA_PATH`
  - `BASE_SCHEMA_PATH`

### Acceptance Criteria

- Schema output path is config-driven.
- Missing schema files produce a clear failure.
- Monorepo `api_path` is respected when enabled.

## Phase 7: Schema Diffing

### Goal

Wrap `openapi-diff` and normalize output into a stable internal model.

### Types

```ts
export type ChangeClass = 'breaking' | 'non-breaking' | 'patch'

export interface ApiChange {
  id: string
  class: ChangeClass
  path?: string
  method?: string
  location?: string
  message: string
}

export interface DiffResult {
  breaking: ApiChange[]
  nonBreaking: ApiChange[]
  patch: ApiChange[]
}
```

### Classification Rules

Breaking:

- Removed endpoint.
- Removed method.
- Removed required request or response field.
- Type narrowing.
- Stricter enum, length, range, or required validation.

Non-breaking:

- Added endpoint.
- Added optional request or response field.
- Relaxed validation.
- Added response code that does not replace existing behavior.

Patch:

- `description`
- `summary`
- `example`
- docs-only metadata
- `x-*` extension changes

### Acceptance Criteria

- Fixture tests cover breaking, non-breaking, and patch-only changes.
- Diff results are sorted deterministically.
- The differ does not throw raw vendor errors into comments; it maps them to readable messages.

## Phase 8: Version Enforcement

### Goal

Validate that `version_file` was bumped correctly for the detected API changes.

### Rules

- Breaking changes require a major bump when `breaking_requires_major` is true.
- Non-breaking changes require a minor or major bump when `non_breaking_requires_minor` is true.
- Patch-only changes should not require major or minor bumps.
- Invalid, missing, or unparsable versions should fail enforcement.

### Return Model

```ts
export interface VersionEnforcementResult {
  passed: boolean
  requiredBump: 'major' | 'minor' | 'patch' | 'none'
  actualBump: 'major' | 'minor' | 'patch' | 'none'
  baseVersion: string
  prVersion: string
  message: string
}
```

### Acceptance Criteria

- Tests cover major, minor, patch, no bump, invalid versions, and disabled enforcement flags.
- The Check Run and comment use the same enforcement result.

## Phase 9: Override Label

### Goal

Support a configured label, defaulting to `override-breaking-change`, that allows merging while preserving visibility.

### Behavior

When the override label is present:

- Breaking changes are still reported.
- Version enforcement failures are downgraded.
- Check Run passes with a warning-oriented summary.
- PR comment clearly states that enforcement was overridden.
- A warning annotation is added when possible.

### Acceptance Criteria

- Override behavior works on initial PR handling and on `pull_request.labeled`.
- Override label name comes from config.
- Override never hides the detected breaking changes.

## Phase 10: GitHub Actions Workflow

### Goal

Create `.github/workflows/api-contract.yml` to generate schemas on both branches and invoke the Probot app.

### Required Workflow Behavior

1. Trigger on PRs targeting `main`.
2. Checkout PR branch with full history.
3. Detect package manager from `packageManager` or lockfiles.
4. Install dependencies for PR branch.
5. Generate PR OpenAPI schema.
6. Copy PR schema to `/tmp/pr-schema.json`.
7. Checkout base branch.
8. Install dependencies for base branch.
9. Generate base OpenAPI schema.
10. Run local Probot action.
11. Upload both schemas and optional quality-gate reports as artifacts.

### Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
  checks: write
```

### Bonus Workflow Behavior

- Add dependency caching keyed by lockfile hash.
- Upload artifacts with 7-day retention.
- Support monorepo `api_path` by running commands from the configured directory.

### Acceptance Criteria

- Workflow is valid YAML.
- Workflow does not log secrets.
- The Probot step receives `PR_SCHEMA_PATH` and `BASE_SCHEMA_PATH`.

## Phase 11: Composite GitHub Action

### Goal

Create `.github/actions/api-contract-probot/action.yml` to run the Probot app from the workflow.

### Inputs and Env

Required env:

- `GITHUB_TOKEN`
- `APP_ID`
- `PRIVATE_KEY`
- `PR_SCHEMA_PATH`
- `BASE_SCHEMA_PATH`

Optional env:

- `QUALITY_REPORT_DIR`
- `LOG_LEVEL`

### Acceptance Criteria

- Action invokes `@probot/adapter-github-actions`.
- Missing required env vars fail with clear messages.
- Secrets are masked and never echoed.

## Phase 12: Quality Gates Addendum

These gates should be optional and config-driven. Implement them after the API contract MVP is stable.

### 12.1 Dead Code Detector

Feasibility: High.

Recommendation: Prefer `knip` for new projects, with optional `ts-prune` compatibility if specifically requested.

Rationale:

- `ts-prune` is useful for unused exports but is in maintenance mode.
- `knip` covers unused exports, files, and dependencies and has better monorepo support.

Implementation:

- Add `scripts/quality-gates/run-dead-code.ts`.
- Run `knip --reporter json` where available.
- Fall back to parsing `ts-prune` line output only when configured.
- Emit `quality-dead-code.json`.

Policy:

- `mode: warning` by default.
- Fail only when `mode: failure` and findings exceed `max_findings`.

Acceptance Criteria:

- Findings are summarized in the PR comment.
- Failure mode affects the Check Run conclusion.
- False-positive suppressions are documented.

### 12.2 Dependency Risk Scanner

Feasibility: High.

Recommendation:

- Enable `npm audit` by default.
- Make Snyk optional because it requires `SNYK_TOKEN`.

Implementation:

- Add `scripts/quality-gates/run-dependency-risk.ts`.
- Support:
  - `npm audit --json --audit-level=<level>`
  - package-manager equivalents where practical
  - optional `snyk test --json --severity-threshold=<level>`
- Emit `quality-dependency-risk.json`.

Policy:

- Default fail threshold: `high`.
- Snyk runs only if enabled and token is available.

Acceptance Criteria:

- Missing Snyk token produces a clear skipped/warning result, not a secret leak.
- `npm audit` nonzero exit is converted into structured findings.
- PR comment lists vulnerability counts by severity.

### 12.3 Performance Budget Check

Feasibility: Medium.

Recommendation:

- Start as opt-in warning mode.
- Use `autocannon` for lightweight endpoint benchmarking.
- Require a baseline artifact before failing builds.

Risks:

- CI runners are noisy.
- `autocannon` is CPU-bound, so results can vary by runner load.
- Benchmarks need a reliable app startup command and health check.

Implementation:

- Add `scripts/quality-gates/run-performance-budget.ts`.
- Start the app using configured `start_command`.
- Wait for health endpoint.
- Warm up for `warmup_seconds`.
- Benchmark configured endpoints.
- Compare PR results against base results or the latest stored baseline artifact.
- Emit `quality-performance-budget.json`.

Policy:

- Default regression threshold: 10%.
- Prefer warning mode until enough baseline data exists.
- Fail only on sustained regressions above threshold.

Acceptance Criteria:

- Handles app startup timeout.
- Handles endpoint failure distinctly from performance regression.
- Produces p50, p95, p99, requests/sec, and error-rate summaries.

### 12.4 Test Impact Analysis

Feasibility: Medium.

Recommendation:

- Use native tooling when present.
- Fall back to full suite unless the project has reliable dependency graph support.

Strategy Detection:

1. Nx: `nx affected -t test --base=<base> --head=<head>`
2. Turbo: use affected/filter support where configured.
3. Vitest: `vitest --changed <base>`
4. Jest: changed/related test options where configured.
5. Fallback: run full test suite.

Risks:

- Dynamic imports and framework conventions can hide dependencies.
- Config, package, lockfile, and shared test utility changes should force a full suite.
- A bad test-impact strategy can create false confidence.

Implementation:

- Add `scripts/quality-gates/run-test-impact.ts`.
- Detect tool from config and repository files.
- Respect force-full-suite triggers.
- Emit `quality-test-impact.json`.

Policy:

- Never fail just because test-impact optimization is unavailable.
- If selected tests fail, the gate fails.
- If impact analysis is uncertain and `fallback_to_full_suite` is true, run the full suite.

Acceptance Criteria:

- Changed config files trigger full suite.
- Lockfile changes trigger full suite unless a monorepo tool provides reliable affected-project calculation.
- PR comment says whether the suite was reduced or full.

## Phase 13: Report Aggregation

### Goal

Combine API contract results and quality-gate results into a single Probot-owned report.

### Report Model

```ts
export interface ContractReport {
  diff: DiffResult
  version: VersionEnforcementResult
  override: {
    active: boolean
    label: string
  }
  qualityGates: QualityGateResult[]
}
```

### Quality Gate Result Model

```ts
export type QualityGateStatus = 'passed' | 'failed' | 'warning' | 'skipped'

export interface QualityGateResult {
  id: string
  name: string
  status: QualityGateStatus
  summary: string
  annotations: Array<{
    path?: string
    startLine?: number
    message: string
    level: 'notice' | 'warning' | 'failure'
  }>
}
```

### Acceptance Criteria

- API contract failures and quality gate failures are represented independently.
- Override label applies only to API breaking-change enforcement unless explicitly configured otherwise.
- Comment and Check Run output are generated from the same report object.

## Phase 14: README

### Required Sections

1. What the app does.
2. Architecture diagram or explanation.
3. GitHub App registration steps.
4. Required GitHub App permissions.
5. Required webhook events.
6. Required repository secrets:
   - `APP_ID`
   - `PRIVATE_KEY`
   - optional `SNYK_TOKEN`
7. Workflow setup.
8. `.github/api-contract.yml` reference.
9. Override label behavior.
10. Monorepo setup.
11. Local development with `smee.io`.
12. Troubleshooting.

### Acceptance Criteria

- A new user can register the GitHub App and wire the workflow without reading source code.
- Defaults are documented in one place.
- Quality gates are clearly marked as optional.

## Phase 15: Open Source Readiness

### Refined Instruction

This project will be open source, so treat documentation, contributor experience, repository hygiene, and public-facing defaults as first-class deliverables. Do not stop at working code. Make the repository understandable, installable, testable, and welcoming for maintainers and first-time contributors.

### Required Repository Files

Add or update:

- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/dependabot.yml`

### Documentation Details

The README should include:

- Clear one-paragraph project summary.
- Architecture overview explaining the Probot layer and Actions compute layer.
- Quick start for a test repository.
- GitHub App registration walkthrough.
- Required permissions and webhook events.
- Required and optional secrets.
- Full `.github/api-contract.yml` reference with defaults.
- Examples for basic, monorepo, override-label, and quality-gate configurations.
- Local development instructions.
- Testing instructions.
- Troubleshooting section for common setup and permission failures.
- Security and responsible disclosure links.

### Contributor Experience

Add contributor guidance covering:

- Required Node and package manager versions.
- Setup commands.
- Test commands.
- Typecheck commands.
- How to run the Probot app locally with `smee.io`.
- How to add new quality gates.
- Code style expectations.
- Release and changelog process.

### Public API and Config Stability

Because configuration is part of the public user contract:

- Document all config fields and defaults.
- Validate config with actionable error messages.
- Avoid renaming config fields without a migration path.
- Add tests for every documented config example.
- Keep generated PR comments stable enough for users to recognize between releases.

### Security and Trust

Open source users need to understand what the app can access:

- Document the minimum GitHub App permissions.
- Explain why each permission is needed.
- Document which files the workflow reads.
- State that secrets must never be printed.
- Document optional Snyk token usage.
- Avoid collecting telemetry unless explicitly documented and disabled by default.

### Packaging and Release Hygiene

Add:

- Semantic versioning policy.
- Changelog format.
- Release checklist.
- Package entry points.
- `files` allowlist in `package.json` if publishing to npm.
- Badges only if they reflect real project state.

### Acceptance Criteria

- A first-time user can install and test the app by following only the README.
- A first-time contributor can set up the repo and run tests by following `CONTRIBUTING.md`.
- Security reporting instructions are clear.
- Issue and PR templates gather enough information to reproduce bugs.
- Config examples are valid and covered by tests.
- No placeholder badges, fake roadmap claims, or undocumented telemetry are present.

## Phase 16: Testing Strategy

### Unit Tests

Required:

- `config.test.ts`
- `schema-differ.test.ts`
- `version-enforcer.test.ts`
- `comment-builder.test.ts`
- `package-manager.test.ts`

Optional after quality gates:

- `dead-code.test.ts`
- `dependency-risk.test.ts`
- `performance-budget.test.ts`
- `test-impact.test.ts`

### Integration-Style Tests

Use mocked Probot contexts and mocked Octokit calls to verify:

- Check Run create/update behavior.
- Comment upsert behavior.
- Override label behavior.
- Config validation failure path.

### Acceptance Criteria

- Tests cover success, failure, override, and config-error paths.
- Snapshot tests are used only for stable Markdown output.
- External scanner tests use fixtures, not live network calls.

## Phase 17: Implementation Order

Recommended order for an AI coding agent:

1. Bootstrap package, TypeScript, Vitest, and basic file layout.
2. Implement config schema and tests.
3. Implement package manager detection and tests.
4. Implement version enforcement and tests.
5. Implement comment builder and tests.
6. Implement schema differ with fixtures and tests.
7. Implement Check Run and PR comment helpers.
8. Implement PR handler.
9. Implement label override handler.
10. Implement GitHub Actions workflow.
11. Implement composite action.
12. Write README.
13. Add open-source repository files and templates.
14. Add dependency-risk quality gate.
15. Add dead-code quality gate.
16. Add performance-budget quality gate in warning mode.
17. Add test-impact optimization.
18. Run final verification.

## Final Verification Checklist

Before considering the implementation complete:

- `pnpm install` succeeds.
- `pnpm typecheck` passes.
- `pnpm test` passes.
- No `any` types are present.
- Workflow YAML is valid.
- Probot app uses `context.octokit` only for GitHub API calls.
- Comment upsert does not duplicate comments.
- Check Run update path is idempotent.
- Override label behavior is tested.
- Config defaults are documented and tested.
- Secrets are not logged.
- README setup steps are complete.
- Open-source repository files are present and free of placeholders.
- Config examples in documentation are tested.

## References

- Probot: https://probot.github.io/
- Probot GitHub Actions adapter: https://github.com/probot/adapter-github-actions
- GitHub Checks API: https://docs.github.com/en/rest/checks/runs
- GitHub Actions workflow syntax: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions
- Knip unused exports: https://knip.dev/typescript/unused-exports
- ts-prune: https://github.com/nadeesha/ts-prune
- npm audit: https://docs.npmjs.com/cli/v7/commands/npm-audit/
- Snyk CLI severity thresholds: https://docs.snyk.io/developer-tools/snyk-cli/scan-and-maintain-projects-using-the-cli/set-severity-thresholds-for-cli-tests
- Autocannon: https://github.com/mcollina/autocannon
- Nx affected: https://nx.dev/docs/features/ci-features/affected
- Vitest changed tests: https://vitest.dev/guide/cli
