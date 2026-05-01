import * as semver from 'semver'
import type { DiffResult, BumpLevel, VersionEnforcementResult } from '../types.js'
import type { EnforcementConfig } from '../config.js'

/**
 * Determines the required semver bump level based on the diff result and enforcement config.
 */
export function determineRequiredBump(
  diff: DiffResult,
  enforcement: EnforcementConfig,
): BumpLevel {
  if (diff.breaking.length > 0 && enforcement.breaking_requires_major) {
    return 'major'
  }
  if (diff.nonBreaking.length > 0 && enforcement.non_breaking_requires_minor) {
    return 'minor'
  }
  if (diff.patch.length > 0) {
    return 'patch'
  }
  return 'none'
}

/**
 * Computes the actual bump level between two semver strings.
 * Returns 'none' if versions are equal or unparseable.
 */
export function computeActualBump(baseVersion: string, prVersion: string): BumpLevel {
  const base = semver.parse(baseVersion)
  const pr = semver.parse(prVersion)

  if (!base || !pr) {
    return 'none'
  }

  if (pr.major > base.major) return 'major'
  if (pr.major === base.major && pr.minor > base.minor) return 'minor'
  if (pr.major === base.major && pr.minor === base.minor && pr.patch > base.patch) return 'patch'

  return 'none'
}

/**
 * Checks whether a given actual bump satisfies the required bump level.
 */
function bumpSatisfies(actual: BumpLevel, required: BumpLevel): boolean {
  const rank: Record<BumpLevel, number> = {
    none: 0,
    patch: 1,
    minor: 2,
    major: 3,
  }
  return rank[actual] >= rank[required]
}

/**
 * Enforces version bump rules against the diff result.
 */
export function enforceVersion(
  baseVersion: string,
  prVersion: string,
  diff: DiffResult,
  enforcement: EnforcementConfig,
): VersionEnforcementResult {
  const baseParsed = semver.parse(baseVersion)
  const prParsed = semver.parse(prVersion)

  if (!baseParsed) {
    return {
      passed: false,
      requiredBump: 'none',
      actualBump: 'none',
      baseVersion,
      prVersion,
      message: `Base version "${baseVersion}" is not a valid semver string.`,
    }
  }

  if (!prParsed) {
    return {
      passed: false,
      requiredBump: 'none',
      actualBump: 'none',
      baseVersion,
      prVersion,
      message: `PR version "${prVersion}" is not a valid semver string.`,
    }
  }

  const requiredBump = determineRequiredBump(diff, enforcement)
  const actualBump = computeActualBump(baseVersion, prVersion)

  if (requiredBump === 'none') {
    return {
      passed: true,
      requiredBump,
      actualBump,
      baseVersion,
      prVersion,
      message: 'No API changes detected — no version bump required.',
    }
  }

  const passed = bumpSatisfies(actualBump, requiredBump)

  if (passed) {
    return {
      passed: true,
      requiredBump,
      actualBump,
      baseVersion,
      prVersion,
      message: `Version bump ${baseVersion} → ${prVersion} satisfies required ${requiredBump} bump.`,
    }
  }

  return {
    passed: false,
    requiredBump,
    actualBump,
    baseVersion,
    prVersion,
    message: `API changes require a ${requiredBump} bump, but version went from ${baseVersion} → ${prVersion} (${actualBump || 'no'} bump).`,
  }
}
