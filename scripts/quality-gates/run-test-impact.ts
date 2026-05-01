#!/usr/bin/env tsx
import { runTestImpactGate } from '../../src/lib/quality-gates/test-impact.js'

type Strategy = 'auto' | 'nx' | 'turbo' | 'vitest' | 'jest' | 'full'

const strategy = (process.env['TEST_IMPACT_STRATEGY'] ?? 'auto') as Strategy
const fallbackToFullSuite = process.env['TEST_IMPACT_FALLBACK'] !== 'false'
const baseBranch = process.env['BASE_BRANCH'] ?? 'main'
const outputDir = process.env['QUALITY_REPORT_DIR'] ?? 'quality-reports'
const projectDir = process.cwd()

runTestImpactGate({
  strategy,
  fallbackToFullSuite,
  outputDir,
  projectDir,
  baseBranch,
})
  .then((result) => {
    console.log(`Test Impact: ${result.status} — ${result.summary}`)
    if (result.status === 'failed') process.exit(1)
  })
  .catch((error) => {
    console.error('Test impact gate error:', error)
    process.exit(1)
  })
