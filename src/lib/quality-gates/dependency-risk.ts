import type { QualityGateResult } from '../../types.js'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface VulnerabilityCounts {
  info: number
  low: number
  moderate: number
  high: number
  critical: number
}

interface NpmAuditOutput {
  metadata?: {
    vulnerabilities?: Partial<VulnerabilityCounts>
  }
}

interface SnykOutput {
  vulnerabilities?: Array<{
    severity?: string
    title?: string
    packageName?: string
  }>
}

/**
 * Runs dependency risk scanning using npm audit and optionally snyk.
 */
export async function runDependencyRiskGate(options: {
  npmAuditLevel: string
  snyk: { enabled: boolean; severityThreshold: string }
  outputDir: string
  projectDir: string
}): Promise<QualityGateResult> {
  const { npmAuditLevel, snyk, outputDir, projectDir } = options

  const annotations: QualityGateResult['annotations'] = []
  let totalVulns = 0
  let status: QualityGateResult['status'] = 'passed'
  const summaryParts: string[] = []

  // Run npm audit
  try {
    const auditResult = await runNpmAudit(projectDir, npmAuditLevel)
    const counts = auditResult.counts
    totalVulns =
      (counts.info ?? 0) +
      (counts.low ?? 0) +
      (counts.moderate ?? 0) +
      (counts.high ?? 0) +
      (counts.critical ?? 0)

    if (auditResult.failed) {
      status = 'failed'
    }

    summaryParts.push(
      `npm audit: ${totalVulns} vulnerabilities (${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low)`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    summaryParts.push(`npm audit: error — ${message}`)
    status = 'warning'
  }

  // Run snyk if enabled
  if (snyk.enabled) {
    const snykToken = process.env['SNYK_TOKEN']
    if (!snykToken) {
      summaryParts.push('Snyk: skipped (SNYK_TOKEN not set)')
    } else {
      try {
        const snykResult = await runSnyk(projectDir, snyk.severityThreshold)
        summaryParts.push(`Snyk: ${snykResult.count} vulnerabilities found`)

        for (const vuln of snykResult.vulnerabilities) {
          annotations.push({
            message: `[${vuln.severity}] ${vuln.title} in ${vuln.packageName}`,
            level: vuln.severity === 'critical' || vuln.severity === 'high' ? 'failure' : 'warning',
          })
        }

        if (snykResult.failed) {
          status = 'failed'
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        summaryParts.push(`Snyk: error — ${message}`)
        if (status !== 'failed') status = 'warning'
      }
    }
  }

  const result: QualityGateResult = {
    id: 'dependency-risk',
    name: 'Dependency Risk',
    status,
    summary: summaryParts.join('; '),
    annotations: annotations.slice(0, 50),
  }

  // Write report
  await writeFile(
    join(outputDir, 'quality-dependency-risk.json'),
    JSON.stringify(result, null, 2),
    'utf-8',
  )

  return result
}

function runNpmAudit(
  projectDir: string,
  auditLevel: string,
): Promise<{ counts: Partial<VulnerabilityCounts>; failed: boolean }> {
  return new Promise((resolve, reject) => {
    execFile(
      'npm',
      ['audit', '--json', `--audit-level=${auditLevel}`],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        // npm audit exits non-zero when vulnerabilities are found above threshold
        const exitCode = error?.code
        const failed = typeof exitCode === 'number' && exitCode > 0

        try {
          const output: unknown = JSON.parse(stdout || '{}')
          const auditOutput = output as NpmAuditOutput
          const counts: Partial<VulnerabilityCounts> =
            auditOutput.metadata?.vulnerabilities ?? {}

          resolve({ counts, failed })
        } catch {
          if (error && !stdout) {
            reject(new Error(`npm audit failed: ${error.message}`))
          } else {
            resolve({ counts: {}, failed: true })
          }
        }
      },
    )
  })
}

function runSnyk(
  projectDir: string,
  severityThreshold: string,
): Promise<{
  count: number
  vulnerabilities: Array<{ severity: string; title: string; packageName: string }>
  failed: boolean
}> {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['snyk', 'test', '--json', `--severity-threshold=${severityThreshold}`],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        const exitCode = error?.code
        const failed = typeof exitCode === 'number' && exitCode > 0

        try {
          const output: unknown = JSON.parse(stdout || '{}')
          const snykOutput = output as SnykOutput
          const vulnerabilities = (snykOutput.vulnerabilities ?? []).map((v) => ({
            severity: v.severity ?? 'unknown',
            title: v.title ?? 'Unknown vulnerability',
            packageName: v.packageName ?? 'unknown',
          }))

          resolve({ count: vulnerabilities.length, vulnerabilities, failed })
        } catch {
          if (error && !stdout) {
            reject(new Error(`snyk test failed: ${error.message}`))
          } else {
            resolve({ count: 0, vulnerabilities: [], failed })
          }
        }
      },
    )
  })
}
