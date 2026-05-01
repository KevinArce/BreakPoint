#!/usr/bin/env tsx
import { runDeadCodeGate } from '../../src/lib/quality-gates/dead-code.js'

const tool = (process.env['DEAD_CODE_TOOL'] ?? 'knip') as 'knip' | 'ts-prune'
const maxFindings = parseInt(process.env['DEAD_CODE_MAX_FINDINGS'] ?? '0', 10)
const mode = (process.env['DEAD_CODE_MODE'] ?? 'warning') as 'warning' | 'failure'
const outputDir = process.env['QUALITY_REPORT_DIR'] ?? 'quality-reports'
const projectDir = process.cwd()

runDeadCodeGate({ tool, maxFindings, mode, outputDir, projectDir })
  .then((result) => {
    console.log(`Dead Code: ${result.status} — ${result.summary}`)
    if (result.status === 'failed') process.exit(1)
  })
  .catch((error) => {
    console.error('Dead code gate error:', error)
    process.exit(1)
  })
