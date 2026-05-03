# Coding Agent Integration Guide

Use this guide when adding BreakPoint to an existing TypeScript or Node.js API repository.

BreakPoint should be installed as a GitHub Actions workflow that calls the released composite action:

```yaml
uses: KevinArce/BreakPoint/.github/actions/api-contract-probot@v0.1.0
```

If a newer BreakPoint release exists with Node 24 workflow updates, prefer that newer release over `v0.1.0`.

Do not copy BreakPoint's starter `generate:openapi` implementation into real API repositories. Each target repository must generate its own real OpenAPI document from its routes, controllers, or schema definitions.

## Agent Goal

Add API contract validation to the target repository so every pull request:

- generates an OpenAPI schema for the PR branch,
- generates an OpenAPI schema for the base branch,
- compares both schemas,
- enforces semantic version bumps for API changes,
- posts a GitHub Check Run and PR comment.

## Inputs To Discover First

Before editing files, inspect the target repository and determine:

- package manager: `pnpm`, `npm`, or `yarn`;
- supported Node.js version from `engines`, `.nvmrc`, `.node-version`, `.tool-versions`, Dockerfiles, or existing CI;
- default branch name, usually `main`;
- API framework: Express, Fastify, NestJS, Hono, Koa, Next.js route handlers, or another framework;
- whether an OpenAPI generator already exists;
- whether the repository is a monorepo;
- where the API package lives if it is a monorepo;
- where the version file lives, usually `package.json`;
- whether the repo already has `.github/workflows` files and branch naming conventions.

Prefer the repository's existing framework conventions. Do not introduce a second OpenAPI system if the app already has one.

## Required Output

After integration, the target repository should contain:

- `.github/workflows/api-contract.yml`
- `.github/api-contract.yml`
- a package script named `generate:openapi`, or another script referenced by `.github/api-contract.yml`
- a generated OpenAPI output path, defaulting to `openapi/schema.json`

The generated schema file may be ignored by git if it is reproducible in CI.

## Step 1: Add Or Verify OpenAPI Generation

Check whether the target repo already has an OpenAPI generation command.

Look for:

- `generate:openapi`, `openapi`, `swagger`, `docs:generate`, or similar scripts in `package.json`;
- existing files under `openapi/`, `swagger/`, `docs/api/`, or `src/docs/`;
- framework packages such as `@nestjs/swagger`, `swagger-jsdoc`, `tsoa`, `zod-to-openapi`, `@asteasolutions/zod-to-openapi`, `@fastify/swagger`, or `hono-openapi`.

If a generator already exists, wire BreakPoint to that command instead of creating a new one.

If no generator exists, add the smallest framework-native generator that produces a real OpenAPI 3.x JSON document. Do not emit an empty placeholder except for a temporary smoke test that is clearly documented and replaced before relying on BreakPoint for enforcement.

Common approaches:

| Framework | Preferred generator direction |
| --- | --- |
| NestJS | Use `@nestjs/swagger` and bootstrap the app into a document. |
| Express/Koa | Use existing route schemas if present; otherwise use `swagger-jsdoc` with route annotations. |
| Fastify | Use `@fastify/swagger` if routes have schemas. |
| Hono | Use the repo's existing OpenAPI middleware or route schema tooling. |
| TSOA | Use the existing `tsoa spec` flow. |
| Zod-heavy apps | Use `@asteasolutions/zod-to-openapi` or the repo's existing Zod OpenAPI adapter. |

The script must write JSON to the configured path. Default:

```text
openapi/schema.json
```

Example `package.json` script:

```json
{
  "scripts": {
    "generate:openapi": "tsx scripts/generate-openapi.ts"
  }
}
```

## Step 2: Add BreakPoint Config

Create `.github/api-contract.yml`.

For a normal single-package repository:

```yaml
api-contract:
  generate_script: generate:openapi
  openapi_output: openapi/schema.json
  version_file: package.json
  base_branch: main
  quality_gates:
    dependency_risk:
      enabled: false
    dead_code:
      enabled: false
    performance_budget:
      enabled: false
    test_impact:
      enabled: false
```

For a monorepo where the API lives in `packages/api`:

```yaml
api-contract:
  generate_script: generate:openapi
  openapi_output: openapi/schema.json
  version_file: package.json
  base_branch: main
  monorepo:
    enabled: true
    api_path: packages/api
  quality_gates:
    dependency_risk:
      enabled: false
    dead_code:
      enabled: false
    performance_budget:
      enabled: false
    test_impact:
      enabled: false
```

Start with optional quality gates disabled unless the user explicitly asks to enable them. This keeps the first rollout focused on API contract validation. They can be enabled later once the repo's dependency, dead-code, performance, and test-impact behavior is understood.

## Step 3: Add The GitHub Actions Workflow

Create `.github/workflows/api-contract.yml`.

Use this workflow for most TypeScript or Node.js repositories. It uses Node 24-compatible GitHub Action majors to avoid the Node 20 Actions runtime deprecation. The `node-version` below controls the Node.js version used by the target project commands; keep `24` unless the repository explicitly pins another supported version.

```yaml
name: API Contract Check

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened, labeled]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  api-contract:
    name: API Contract Validation
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout PR branch
        uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          package-manager-cache: false

      - name: Detect package manager
        id: detect-pm
        run: |
          MANAGER=""
          if [ -f "package.json" ]; then
            MANAGER=$(node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); const pm=typeof pkg.packageManager === 'string' ? pkg.packageManager.split('@')[0] : ''; if (['pnpm','yarn','npm'].includes(pm)) process.stdout.write(pm);")
          fi

          if [ "$MANAGER" = "pnpm" ] || { [ -z "$MANAGER" ] && [ -f "pnpm-lock.yaml" ]; }; then
            echo "manager=pnpm" >> $GITHUB_OUTPUT
            echo "install=pnpm install --frozen-lockfile" >> $GITHUB_OUTPUT
            echo "run=pnpm run" >> $GITHUB_OUTPUT
          elif [ "$MANAGER" = "yarn" ] || { [ -z "$MANAGER" ] && [ -f "yarn.lock" ]; }; then
            echo "manager=yarn" >> $GITHUB_OUTPUT
            echo "install=yarn install --frozen-lockfile" >> $GITHUB_OUTPUT
            echo "run=yarn run" >> $GITHUB_OUTPUT
          else
            echo "manager=npm" >> $GITHUB_OUTPUT
            echo "install=npm ci" >> $GITHUB_OUTPUT
            echo "run=npm run" >> $GITHUB_OUTPUT
          fi

      - name: Setup pnpm
        if: steps.detect-pm.outputs.manager == 'pnpm'
        uses: pnpm/action-setup@v5

      - name: Cache dependencies
        uses: actions/cache@v5
        with:
          path: |
            node_modules
            ~/.pnpm-store
            ~/.npm
            ~/.yarn/cache
          key: ${{ runner.os }}-${{ steps.detect-pm.outputs.manager }}-${{ hashFiles('**/pnpm-lock.yaml', '**/yarn.lock', '**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-${{ steps.detect-pm.outputs.manager }}-

      - name: Install dependencies (PR branch)
        run: ${{ steps.detect-pm.outputs.install }}

      - name: Read config
        id: config
        run: |
          ruby <<'RUBY' >> "$GITHUB_OUTPUT"
          require "yaml"

          raw = File.exist?(".github/api-contract.yml") ? (YAML.load_file(".github/api-contract.yml") || {}) : {}
          config = raw.fetch("api-contract", raw)
          monorepo = config.fetch("monorepo", {}) || {}

          script = config.fetch("generate_script", "generate:openapi")
          output = config.fetch("openapi_output", "openapi/schema.json")
          api_path = monorepo.fetch("api_path", "apps/api")
          monorepo_enabled = monorepo.fetch("enabled", false)
          schema_root = monorepo_enabled ? api_path : "."

          puts "script=#{script}"
          puts "output=#{output}"
          puts "api_path=#{api_path}"
          puts "monorepo=#{monorepo_enabled}"
          puts "schema_root=#{schema_root}"
          RUBY

      - name: Generate PR OpenAPI schema
        working-directory: ${{ steps.config.outputs.schema_root }}
        run: ${{ steps.detect-pm.outputs.run }} ${{ steps.config.outputs.script }}

      - name: Save PR schema
        run: |
          mkdir -p /tmp/api-contract
          output="${{ steps.config.outputs.output }}"
          schema_root="${{ steps.config.outputs.schema_root }}"
          if [[ "$output" = /* ]]; then
            source="$output"
          else
            source="$schema_root/$output"
          fi
          cp "$source" /tmp/api-contract/pr-schema.json

      - name: Checkout base branch
        uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.base.ref }}
          clean: false

      - name: Install dependencies (base branch)
        run: ${{ steps.detect-pm.outputs.install }}

      - name: Generate base OpenAPI schema
        working-directory: ${{ steps.config.outputs.schema_root }}
        run: ${{ steps.detect-pm.outputs.run }} ${{ steps.config.outputs.script }}

      - name: Save base schema
        run: |
          output="${{ steps.config.outputs.output }}"
          schema_root="${{ steps.config.outputs.schema_root }}"
          if [[ "$output" = /* ]]; then
            source="$output"
          else
            source="$schema_root/$output"
          fi
          cp "$source" /tmp/api-contract/base-schema.json

      - name: Checkout PR branch again
        uses: actions/checkout@v5
        with:
          clean: false

      - name: Install dependencies (PR branch for quality gates)
        run: ${{ steps.detect-pm.outputs.install }}

      - name: Run API Contract Probot
        uses: KevinArce/BreakPoint/.github/actions/api-contract-probot@v0.1.0
        with:
          pr-schema-path: /tmp/api-contract/pr-schema.json
          base-schema-path: /tmp/api-contract/base-schema.json
          quality-report-dir: quality-reports
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Upload artifacts
        if: always()
        uses: actions/upload-artifact@v6
        with:
          name: api-contract-schemas
          path: |
            /tmp/api-contract/pr-schema.json
            /tmp/api-contract/base-schema.json
            quality-reports/
          retention-days: 7
```

If the target repository uses a base branch other than `main`, update both:

- `on.pull_request.branches`
- `.github/api-contract.yml` `base_branch`

If the target repository uses self-hosted runners, confirm the runner version supports Node 24 JavaScript actions before using these action majors. GitHub-hosted `ubuntu-latest` runners already satisfy this requirement.

## Step 4: Validate Locally

Run the target repository's generator before opening a PR:

```bash
pnpm run generate:openapi
```

or:

```bash
npm run generate:openapi
```

or:

```bash
yarn run generate:openapi
```

Then validate that the file exists and is valid JSON:

```bash
node -e "const fs=require('fs'); JSON.parse(fs.readFileSync('openapi/schema.json','utf8')); console.log('OpenAPI JSON is valid')"
```

Also run the repository's normal checks, such as:

```bash
pnpm typecheck
pnpm test
```

Use the repo's actual package manager and scripts.

## Step 5: Open A Test PR

Create a small PR against the configured base branch.

Good smoke-test options:

- a harmless markdown file change;
- a non-breaking API addition if the repo already has a reliable OpenAPI generator;
- a deliberate API contract change if the user wants to verify semver enforcement.

After opening the PR, verify that these checks appear:

- `API Contract Validation`
- `API Contract`

The workflow should upload schema artifacts named `api-contract-schemas`.

## Step 6: Troubleshoot Common Failures

If schema generation fails:

- run the same `generate:openapi` command locally;
- ensure the script writes to the configured `openapi_output`;
- ensure the output is JSON, not YAML;
- ensure the generator does not require secrets unavailable on pull requests;
- ensure generated paths are deterministic between CI runs.

If the action cannot be found:

- confirm the workflow references an existing BreakPoint release, such as `KevinArce/BreakPoint/.github/actions/api-contract-probot@v0.1.0`;
- confirm the selected release exists on GitHub, for example `https://github.com/KevinArce/BreakPoint/releases/tag/v0.1.0`;
- if BreakPoint is made private later, configure repository access under BreakPoint repository Settings -> Actions -> General -> Access.

If GitHub logs warn that Node.js 20 actions are deprecated:

- update standard actions to Node 24-compatible majors such as `actions/checkout@v5`, `actions/setup-node@v6`, `actions/cache@v5`, `actions/upload-artifact@v6`, and `pnpm/action-setup@v5`;
- keep `package-manager-cache: false` on `actions/setup-node@v6` if the workflow also uses an explicit `actions/cache` step;
- use `node-version: 24` by default for project commands, unless the target repository explicitly requires another supported Node.js version.
- if the warning points at `KevinArce/BreakPoint`, upgrade the workflow to the newest BreakPoint release that includes the Node 24 composite-action update.

If the PR comment or check cannot be created:

- confirm workflow permissions include `pull-requests: write` and `checks: write`;
- confirm the workflow runs on `pull_request`;
- inspect the Actions logs for the `Run API Contract Probot` step.

If semver enforcement fails:

- inspect the PR comment for the required version bump;
- update the configured `version_file`;
- use the override label only if the team intentionally accepts the contract change without the requested bump.

## Agent Completion Checklist

Before reporting completion, confirm:

- the workflow file exists and references an existing BreakPoint release tag;
- the workflow uses Node 24-compatible action majors;
- `.github/api-contract.yml` matches the repo layout;
- `generate:openapi` exists or the config references the correct script;
- the generator produces a real OpenAPI JSON file;
- local JSON validation passes;
- normal repo checks pass or any failures are clearly unrelated;
- a test PR has been opened or the user has been given exact next steps to open one.

## Suggested Final Response

When finished, summarize:

- files changed;
- generator strategy used;
- config values chosen;
- validation commands run;
- whether a test PR was opened;
- any remaining setup the user must do in GitHub.
