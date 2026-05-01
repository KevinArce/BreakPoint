#!/usr/bin/env tsx
import { runDependencyRiskGate } from '../../src/lib/quality-gates/dependency-risk.js'

const npmAuditLevel = process.env['NPM_AUDIT_LEVEL'] ?? 'high'
const snykEnabled = process.env['SNYK_ENABLED'] === 'true'
const snykSeverity = process.env['SNYK_SEVERITY_THRESHOLD'] ?? 'high'
const outputDir = process.env['QUALITY_REPORT_DIR'] ?? 'quality-reports'
const projectDir = process.cwd()

runDependencyRiskGate({
  npmAuditLevel,
  snyk: { enabled: snykEnabled, severityThreshold: snykSeverity },
  outputDir,
  projectDir,
})
  .then((result) => {
    console.log(`Dependency Risk: ${result.status} — ${result.summary}`)
    if (result.status === 'failed') process.exit(1)
  })
  .catch((error) => {
    console.error('Dependency risk gate error:', error)
    process.exit(1)
  })
