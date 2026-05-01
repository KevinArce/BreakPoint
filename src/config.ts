import { z } from 'zod'

// ── Quality Gate Sub-Schemas ────────────────────────────────────────────────

const deadCodeConfigSchema = z.object({
  enabled: z.boolean().default(false),
  tool: z.enum(['knip', 'ts-prune']).default('knip'),
  max_findings: z.number().int().min(0).default(0),
  mode: z.enum(['warning', 'failure']).default('warning'),
})

const snykConfigSchema = z.object({
  enabled: z.boolean().default(false),
  severity_threshold: z.enum(['low', 'medium', 'high', 'critical']).default('high'),
})

const dependencyRiskConfigSchema = z.object({
  enabled: z.boolean().default(true),
  npm_audit_level: z.enum(['low', 'moderate', 'high', 'critical']).default('high'),
  snyk: snykConfigSchema.default({}),
})

const performanceEndpointSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  path: z.string(),
})

const performanceBudgetConfigSchema = z.object({
  enabled: z.boolean().default(false),
  start_command: z.string().default('start'),
  warmup_seconds: z.number().int().min(0).default(10),
  regression_threshold_percent: z.number().min(0).default(10),
  endpoints: z.array(performanceEndpointSchema).default([]),
})

const testImpactConfigSchema = z.object({
  enabled: z.boolean().default(false),
  strategy: z.enum(['auto', 'nx', 'turbo', 'vitest', 'jest', 'full']).default('auto'),
  fallback_to_full_suite: z.boolean().default(true),
})

const qualityGatesConfigSchema = z.object({
  dead_code: deadCodeConfigSchema.default({}),
  dependency_risk: dependencyRiskConfigSchema.default({}),
  performance_budget: performanceBudgetConfigSchema.default({}),
  test_impact: testImpactConfigSchema.default({}),
})

// ── Enforcement Schema ──────────────────────────────────────────────────────

const enforcementConfigSchema = z.object({
  breaking_requires_major: z.boolean().default(true),
  non_breaking_requires_minor: z.boolean().default(true),
  allow_override_label: z.string().default('override-breaking-change'),
})

// ── Monorepo Schema ─────────────────────────────────────────────────────────

const monorepoConfigSchema = z.object({
  enabled: z.boolean().default(false),
  api_path: z.string().default('apps/api'),
})

// ── Root Config Schema ──────────────────────────────────────────────────────

const apiContractRootSchema = z.object({
  openapi_output: z.string().default('openapi/schema.json'),
  generate_script: z.string().default('generate:openapi'),
  version_file: z.string().default('package.json'),
  base_branch: z.string().default('main'),
  monorepo: monorepoConfigSchema.default({}),
  enforcement: enforcementConfigSchema.default({}),
  quality_gates: qualityGatesConfigSchema.default({}),
})

export const apiContractConfigSchema = z.object({
  'api-contract': apiContractRootSchema.default({}),
})

// ── Derived Types ───────────────────────────────────────────────────────────

export type ApiContractConfig = z.infer<typeof apiContractRootSchema>
export type EnforcementConfig = z.infer<typeof enforcementConfigSchema>
export type QualityGatesConfig = z.infer<typeof qualityGatesConfigSchema>
export type DeadCodeConfig = z.infer<typeof deadCodeConfigSchema>
export type DependencyRiskConfig = z.infer<typeof dependencyRiskConfigSchema>
export type PerformanceBudgetConfig = z.infer<typeof performanceBudgetConfigSchema>
export type TestImpactConfig = z.infer<typeof testImpactConfigSchema>
export type MonorepoConfig = z.infer<typeof monorepoConfigSchema>

// ── Defaults ────────────────────────────────────────────────────────────────

export const CONFIG_DEFAULTS: ApiContractConfig = apiContractRootSchema.parse({})

// ── Config Parsing ──────────────────────────────────────────────────────────

export interface ConfigParseSuccess {
  success: true
  config: ApiContractConfig
}

export interface ConfigParseFailure {
  success: false
  error: string
}

export type ConfigParseResult = ConfigParseSuccess | ConfigParseFailure

/**
 * Parses and validates a raw config object loaded from `.github/api-contract.yml`.
 * Returns either the validated config or a descriptive error.
 */
export function parseConfig(raw: unknown): ConfigParseResult {
  const result = apiContractConfigSchema.safeParse(raw ?? {})

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    return {
      success: false,
      error: `Invalid api-contract configuration:\n${issues}`,
    }
  }

  return {
    success: true,
    config: result.data['api-contract'],
  }
}
