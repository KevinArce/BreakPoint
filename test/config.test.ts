import { describe, expect, it } from 'vitest'
import { CONFIG_DEFAULTS, parseConfig } from '../src/config.js'

describe('parseConfig', () => {
  describe('defaults', () => {
    it('returns defaults when raw input is null', () => {
      const result = parseConfig(null)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config).toEqual(CONFIG_DEFAULTS)
      }
    })

    it('returns defaults when raw input is undefined', () => {
      const result = parseConfig(undefined)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config).toEqual(CONFIG_DEFAULTS)
      }
    })

    it('returns defaults when raw input is an empty object', () => {
      const result = parseConfig({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config).toEqual(CONFIG_DEFAULTS)
      }
    })

    it('has expected default values', () => {
      expect(CONFIG_DEFAULTS.openapi_output).toBe('openapi/schema.json')
      expect(CONFIG_DEFAULTS.generate_script).toBe('generate:openapi')
      expect(CONFIG_DEFAULTS.version_file).toBe('package.json')
      expect(CONFIG_DEFAULTS.base_branch).toBe('main')
      expect(CONFIG_DEFAULTS.monorepo.enabled).toBe(false)
      expect(CONFIG_DEFAULTS.monorepo.api_path).toBe('apps/api')
      expect(CONFIG_DEFAULTS.enforcement.breaking_requires_major).toBe(true)
      expect(CONFIG_DEFAULTS.enforcement.non_breaking_requires_minor).toBe(true)
      expect(CONFIG_DEFAULTS.enforcement.allow_override_label).toBe('override-breaking-change')
      expect(CONFIG_DEFAULTS.quality_gates.dead_code.enabled).toBe(false)
      expect(CONFIG_DEFAULTS.quality_gates.dependency_risk.enabled).toBe(true)
      expect(CONFIG_DEFAULTS.quality_gates.performance_budget.enabled).toBe(false)
      expect(CONFIG_DEFAULTS.quality_gates.test_impact.enabled).toBe(false)
    })
  })

  describe('partial overrides', () => {
    it('accepts the unwrapped object returned by context.config', () => {
      const result = parseConfig({
        generate_script: 'build:openapi',
        enforcement: {
          allow_override_label: 'api-break-approved',
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.generate_script).toBe('build:openapi')
        expect(result.config.enforcement.allow_override_label).toBe('api-break-approved')
      }
    })

    it('merges partial enforcement overrides with defaults', () => {
      const result = parseConfig({
        'api-contract': {
          enforcement: {
            breaking_requires_major: false,
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.enforcement.breaking_requires_major).toBe(false)
        expect(result.config.enforcement.non_breaking_requires_minor).toBe(true)
        expect(result.config.enforcement.allow_override_label).toBe('override-breaking-change')
      }
    })

    it('merges partial monorepo overrides', () => {
      const result = parseConfig({
        'api-contract': {
          monorepo: {
            enabled: true,
            api_path: 'packages/server',
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.monorepo.enabled).toBe(true)
        expect(result.config.monorepo.api_path).toBe('packages/server')
      }
    })

    it('merges nested quality gate overrides', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            dead_code: {
              enabled: true,
              tool: 'knip',
              max_findings: 5,
              mode: 'failure',
            },
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.quality_gates.dead_code.enabled).toBe(true)
        expect(result.config.quality_gates.dead_code.tool).toBe('knip')
        expect(result.config.quality_gates.dead_code.max_findings).toBe(5)
        expect(result.config.quality_gates.dead_code.mode).toBe('failure')
        // Other gates should still have defaults
        expect(result.config.quality_gates.dependency_risk.enabled).toBe(true)
      }
    })

    it('overrides openapi_output path', () => {
      const result = parseConfig({
        'api-contract': {
          openapi_output: 'docs/api.json',
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.openapi_output).toBe('docs/api.json')
        expect(result.config.version_file).toBe('package.json')
      }
    })
  })

  describe('invalid config', () => {
    it('fails on invalid enforcement enum value', () => {
      const result = parseConfig({
        'api-contract': {
          enforcement: {
            breaking_requires_major: 'yes',
          },
        },
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Invalid api-contract configuration')
      }
    })

    it('fails on invalid dead_code tool', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            dead_code: {
              tool: 'invalid-tool',
            },
          },
        },
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Invalid api-contract configuration')
      }
    })

    it('fails on invalid npm_audit_level', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            dependency_risk: {
              npm_audit_level: 'extreme',
            },
          },
        },
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Invalid api-contract configuration')
      }
    })

    it('fails on negative max_findings', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            dead_code: {
              max_findings: -1,
            },
          },
        },
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Invalid api-contract configuration')
      }
    })

    it('fails on invalid test_impact strategy', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            test_impact: {
              strategy: 'magic',
            },
          },
        },
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain('Invalid api-contract configuration')
      }
    })
  })

  describe('snyk config', () => {
    it('accepts valid snyk config', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            dependency_risk: {
              snyk: {
                enabled: true,
                severity_threshold: 'critical',
              },
            },
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.quality_gates.dependency_risk.snyk.enabled).toBe(true)
        expect(result.config.quality_gates.dependency_risk.snyk.severity_threshold).toBe('critical')
      }
    })

    it('defaults snyk to disabled', () => {
      const result = parseConfig({})
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.quality_gates.dependency_risk.snyk.enabled).toBe(false)
      }
    })
  })

  describe('performance budget endpoints', () => {
    it('accepts endpoints array', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            performance_budget: {
              enabled: true,
              endpoints: [
                { method: 'GET', path: '/health' },
                { method: 'POST', path: '/api/users' },
              ],
            },
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        const perf = result.config.quality_gates.performance_budget
        expect(perf.enabled).toBe(true)
        expect(perf.endpoints).toHaveLength(2)
        expect(perf.endpoints[0]?.method).toBe('GET')
        expect(perf.endpoints[0]?.path).toBe('/health')
      }
    })
  })

  // ── README documented examples ──────────────────────────────────────────
  // These tests ensure that every config example in the README is valid.
  // If a config field is renamed, these tests must be updated alongside the docs.

  describe('documented config examples', () => {
    it('accepts the "basic" example from the README', () => {
      const result = parseConfig({
        'api-contract': {
          generate_script: 'generate:openapi',
          version_file: 'package.json',
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.generate_script).toBe('generate:openapi')
        expect(result.config.version_file).toBe('package.json')
        expect(result.config.openapi_output).toBe('openapi/schema.json')
        expect(result.config.enforcement.breaking_requires_major).toBe(true)
      }
    })

    it('accepts the "monorepo" example from the README', () => {
      const result = parseConfig({
        'api-contract': {
          monorepo: {
            enabled: true,
            api_path: 'packages/api',
          },
          generate_script: 'generate:openapi',
          version_file: 'package.json',
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.monorepo.enabled).toBe(true)
        expect(result.config.monorepo.api_path).toBe('packages/api')
      }
    })

    it('accepts the "custom override label" example from the README', () => {
      const result = parseConfig({
        'api-contract': {
          enforcement: {
            allow_override_label: 'api-break-approved',
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.enforcement.allow_override_label).toBe('api-break-approved')
        expect(result.config.enforcement.breaking_requires_major).toBe(true)
        expect(result.config.enforcement.non_breaking_requires_minor).toBe(true)
      }
    })

    it('accepts the "full quality gates" example from the README', () => {
      const result = parseConfig({
        'api-contract': {
          quality_gates: {
            dead_code: {
              enabled: true,
              tool: 'knip',
              max_findings: 0,
              mode: 'failure',
            },
            dependency_risk: {
              enabled: true,
              npm_audit_level: 'moderate',
              snyk: {
                enabled: true,
                severity_threshold: 'high',
              },
            },
            performance_budget: {
              enabled: true,
              start_command: 'start:prod',
              warmup_seconds: 15,
              regression_threshold_percent: 5,
              endpoints: [
                { method: 'GET', path: '/health' },
                { method: 'GET', path: '/api/v1/status' },
              ],
            },
            test_impact: {
              enabled: true,
              strategy: 'vitest',
              fallback_to_full_suite: true,
            },
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        const qg = result.config.quality_gates
        expect(qg.dead_code.enabled).toBe(true)
        expect(qg.dead_code.tool).toBe('knip')
        expect(qg.dead_code.max_findings).toBe(0)
        expect(qg.dead_code.mode).toBe('failure')
        expect(qg.dependency_risk.enabled).toBe(true)
        expect(qg.dependency_risk.npm_audit_level).toBe('moderate')
        expect(qg.dependency_risk.snyk.enabled).toBe(true)
        expect(qg.dependency_risk.snyk.severity_threshold).toBe('high')
        expect(qg.performance_budget.enabled).toBe(true)
        expect(qg.performance_budget.start_command).toBe('start:prod')
        expect(qg.performance_budget.warmup_seconds).toBe(15)
        expect(qg.performance_budget.regression_threshold_percent).toBe(5)
        expect(qg.performance_budget.endpoints).toHaveLength(2)
        expect(qg.performance_budget.endpoints[0]?.path).toBe('/health')
        expect(qg.performance_budget.endpoints[1]?.path).toBe('/api/v1/status')
        expect(qg.test_impact.enabled).toBe(true)
        expect(qg.test_impact.strategy).toBe('vitest')
        expect(qg.test_impact.fallback_to_full_suite).toBe(true)
      }
    })

    it('accepts the complete config reference block from the README', () => {
      const result = parseConfig({
        'api-contract': {
          openapi_output: 'openapi/schema.json',
          generate_script: 'generate:openapi',
          version_file: 'package.json',
          base_branch: 'main',
          monorepo: {
            enabled: false,
            api_path: 'apps/api',
          },
          enforcement: {
            breaking_requires_major: true,
            non_breaking_requires_minor: true,
            allow_override_label: 'override-breaking-change',
          },
          quality_gates: {
            dead_code: {
              enabled: false,
              tool: 'knip',
              max_findings: 0,
              mode: 'warning',
            },
            dependency_risk: {
              enabled: true,
              npm_audit_level: 'high',
              snyk: {
                enabled: false,
                severity_threshold: 'high',
              },
            },
            performance_budget: {
              enabled: false,
              start_command: 'start',
              warmup_seconds: 10,
              regression_threshold_percent: 10,
              endpoints: [
                { method: 'GET', path: '/health' },
              ],
            },
            test_impact: {
              enabled: false,
              strategy: 'auto',
              fallback_to_full_suite: true,
            },
          },
        },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.config.openapi_output).toBe('openapi/schema.json')
        expect(result.config.enforcement.allow_override_label).toBe('override-breaking-change')
        expect(result.config.quality_gates.performance_budget.endpoints).toHaveLength(1)
      }
    })
  })
})
