import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { QualityGateResult, QualityGateStatus } from '../../types.js'

export type { QualityGateResult, QualityGateStatus }

/** Directory where quality gate runners emit their JSON results. */
const DEFAULT_REPORT_DIR = process.env['QUALITY_REPORT_DIR'] ?? 'quality-reports'

const GATE_FILES: Record<string, string> = {
  'dead-code': 'quality-dead-code.json',
  'dependency-risk': 'quality-dependency-risk.json',
  'performance-budget': 'quality-performance-budget.json',
  'test-impact': 'quality-test-impact.json',
}

/**
 * Loads quality gate result files from the report directory.
 * Missing files are silently skipped.
 */
export async function loadQualityGateResults(
  reportDir?: string,
): Promise<QualityGateResult[]> {
  const dir = reportDir ?? DEFAULT_REPORT_DIR
  const results: QualityGateResult[] = []

  for (const [id, filename] of Object.entries(GATE_FILES)) {
    const filePath = join(dir, filename)
    if (!existsSync(filePath)) {
      continue
    }

    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)

      if (isValidGateResult(parsed)) {
        results.push(parsed)
      }
    } catch {
      results.push({
        id,
        name: id,
        status: 'warning',
        summary: `Failed to parse ${filename}`,
        annotations: [],
      })
    }
  }

  return results
}

function isValidGateResult(value: unknown): value is QualityGateResult {
  if (typeof value !== 'object' || value === null) return false

  const obj = value as Record<string, unknown>
  return (
    typeof obj['id'] === 'string' &&
    typeof obj['name'] === 'string' &&
    typeof obj['status'] === 'string' &&
    isValidStatus(obj['status']) &&
    typeof obj['summary'] === 'string' &&
    Array.isArray(obj['annotations'])
  )
}

function isValidStatus(value: string): value is QualityGateStatus {
  return ['passed', 'failed', 'warning', 'skipped'].includes(value)
}
