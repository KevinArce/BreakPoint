#!/usr/bin/env tsx
import { runPerformanceBudgetGate } from '../../src/lib/quality-gates/performance-budget.js'

const startCommand = process.env['PERF_START_COMMAND'] ?? 'start'
const warmupSeconds = parseInt(process.env['PERF_WARMUP_SECONDS'] ?? '10', 10)
const threshold = parseInt(process.env['PERF_REGRESSION_THRESHOLD'] ?? '10', 10)
const outputDir = process.env['QUALITY_REPORT_DIR'] ?? 'quality-reports'
const projectDir = process.cwd()

// Parse endpoints from environment (JSON array)
let endpoints: Array<{ method: string; path: string }> = []
try {
  const raw = process.env['PERF_ENDPOINTS']
  if (raw) endpoints = JSON.parse(raw) as typeof endpoints
} catch {
  console.warn('Failed to parse PERF_ENDPOINTS, using empty array')
}

runPerformanceBudgetGate({
  startCommand,
  warmupSeconds,
  regressionThresholdPercent: threshold,
  endpoints,
  outputDir,
  projectDir,
})
  .then((result) => {
    console.log(`Performance Budget: ${result.status} — ${result.summary}`)
    if (result.status === 'failed') process.exit(1)
  })
  .catch((error) => {
    console.error('Performance budget gate error:', error)
    process.exit(1)
  })
