import { describe, expect, it } from 'vitest'
import { enforceVersion, computeActualBump, determineRequiredBump } from '../src/lib/version-enforcer.js'
import type { DiffResult } from '../src/types.js'
import type { EnforcementConfig } from '../src/config.js'

const defaultEnforcement: EnforcementConfig = {
  breaking_requires_major: true,
  non_breaking_requires_minor: true,
  allow_override_label: 'override-breaking-change',
}

const emptyDiff: DiffResult = { breaking: [], nonBreaking: [], patch: [] }

const breakingDiff: DiffResult = {
  breaking: [{ id: 'b1', class: 'breaking', message: 'Removed endpoint' }],
  nonBreaking: [],
  patch: [],
}

const nonBreakingDiff: DiffResult = {
  breaking: [],
  nonBreaking: [{ id: 'nb1', class: 'non-breaking', message: 'Added endpoint' }],
  patch: [],
}

const patchDiff: DiffResult = {
  breaking: [],
  nonBreaking: [],
  patch: [{ id: 'p1', class: 'patch', message: 'Updated description' }],
}

describe('computeActualBump', () => {
  it('returns major when major is bumped', () => {
    expect(computeActualBump('1.0.0', '2.0.0')).toBe('major')
  })

  it('returns minor when minor is bumped', () => {
    expect(computeActualBump('1.0.0', '1.1.0')).toBe('minor')
  })

  it('returns patch when patch is bumped', () => {
    expect(computeActualBump('1.0.0', '1.0.1')).toBe('patch')
  })

  it('returns none when versions are equal', () => {
    expect(computeActualBump('1.0.0', '1.0.0')).toBe('none')
  })

  it('returns none for invalid versions', () => {
    expect(computeActualBump('invalid', '1.0.0')).toBe('none')
    expect(computeActualBump('1.0.0', 'invalid')).toBe('none')
  })

  it('returns major even when minor/patch also change', () => {
    expect(computeActualBump('1.2.3', '2.0.0')).toBe('major')
  })

  it('returns none for version downgrades', () => {
    expect(computeActualBump('2.0.0', '1.0.0')).toBe('none')
  })
})

describe('determineRequiredBump', () => {
  it('requires major for breaking changes when configured', () => {
    expect(determineRequiredBump(breakingDiff, defaultEnforcement)).toBe('major')
  })

  it('requires minor for non-breaking changes when configured', () => {
    expect(determineRequiredBump(nonBreakingDiff, defaultEnforcement)).toBe('minor')
  })

  it('requires patch for patch-only changes', () => {
    expect(determineRequiredBump(patchDiff, defaultEnforcement)).toBe('patch')
  })

  it('requires none when no changes', () => {
    expect(determineRequiredBump(emptyDiff, defaultEnforcement)).toBe('none')
  })

  it('does not require major when breaking_requires_major is false', () => {
    const enforcement = { ...defaultEnforcement, breaking_requires_major: false }
    expect(determineRequiredBump(breakingDiff, enforcement)).toBe('none')
  })

  it('does not require minor when non_breaking_requires_minor is false', () => {
    const enforcement = { ...defaultEnforcement, non_breaking_requires_minor: false }
    expect(determineRequiredBump(nonBreakingDiff, enforcement)).toBe('none')
  })
})

describe('enforceVersion', () => {
  it('passes when no changes and no bump', () => {
    const result = enforceVersion('1.0.0', '1.0.0', emptyDiff, defaultEnforcement)
    expect(result.passed).toBe(true)
    expect(result.requiredBump).toBe('none')
  })

  it('passes with correct major bump for breaking changes', () => {
    const result = enforceVersion('1.0.0', '2.0.0', breakingDiff, defaultEnforcement)
    expect(result.passed).toBe(true)
    expect(result.requiredBump).toBe('major')
    expect(result.actualBump).toBe('major')
  })

  it('fails without major bump for breaking changes', () => {
    const result = enforceVersion('1.0.0', '1.1.0', breakingDiff, defaultEnforcement)
    expect(result.passed).toBe(false)
    expect(result.requiredBump).toBe('major')
    expect(result.actualBump).toBe('minor')
  })

  it('passes with correct minor bump for non-breaking changes', () => {
    const result = enforceVersion('1.0.0', '1.1.0', nonBreakingDiff, defaultEnforcement)
    expect(result.passed).toBe(true)
    expect(result.requiredBump).toBe('minor')
    expect(result.actualBump).toBe('minor')
  })

  it('passes when major bump provided for minor requirement', () => {
    const result = enforceVersion('1.0.0', '2.0.0', nonBreakingDiff, defaultEnforcement)
    expect(result.passed).toBe(true)
    expect(result.requiredBump).toBe('minor')
    expect(result.actualBump).toBe('major')
  })

  it('fails without minor bump for non-breaking changes', () => {
    const result = enforceVersion('1.0.0', '1.0.1', nonBreakingDiff, defaultEnforcement)
    expect(result.passed).toBe(false)
    expect(result.requiredBump).toBe('minor')
    expect(result.actualBump).toBe('patch')
  })

  it('passes with patch bump for patch-only changes', () => {
    const result = enforceVersion('1.0.0', '1.0.1', patchDiff, defaultEnforcement)
    expect(result.passed).toBe(true)
  })

  it('fails on invalid base version', () => {
    const result = enforceVersion('invalid', '1.0.0', emptyDiff, defaultEnforcement)
    expect(result.passed).toBe(false)
    expect(result.message).toContain('not a valid semver')
  })

  it('fails on invalid PR version', () => {
    const result = enforceVersion('1.0.0', 'not-a-version', emptyDiff, defaultEnforcement)
    expect(result.passed).toBe(false)
    expect(result.message).toContain('not a valid semver')
  })

  it('fails when no bump is provided for breaking changes', () => {
    const result = enforceVersion('1.0.0', '1.0.0', breakingDiff, defaultEnforcement)
    expect(result.passed).toBe(false)
    expect(result.requiredBump).toBe('major')
    expect(result.actualBump).toBe('none')
  })

  it('passes when enforcement is disabled for breaking', () => {
    const enforcement = { ...defaultEnforcement, breaking_requires_major: false }
    const result = enforceVersion('1.0.0', '1.0.0', breakingDiff, enforcement)
    expect(result.passed).toBe(true)
  })

  it('passes when enforcement is disabled for non-breaking', () => {
    const enforcement = { ...defaultEnforcement, non_breaking_requires_minor: false }
    const result = enforceVersion('1.0.0', '1.0.0', nonBreakingDiff, enforcement)
    expect(result.passed).toBe(true)
  })
})
