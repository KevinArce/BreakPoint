import type { QualityGateResult } from '../../types.js'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface VulnerabilityCounts {
  info: number
  low: number
  moderate: number
  high: number
  critical: number
}

interface NpmAuditOutput {
  error?: {
    code?: string
    summary?: string
    detail?: string
  }
  metadata?: {
    vulnerabilities?: Partial<VulnerabilityCounts>
  }
  advisories?: Record<string, {
    severity?: string
  }>
  vulnerabilities?: Record<string, {
    severity?: string
  }>
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
    const auditResult = await runPackageAudit(projectDir, npmAuditLevel)
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
      `${auditResult.tool}: ${totalVulns} vulnerabilities (${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low)`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    summaryParts.push(`dependency audit: warning — ${message}`)
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
  await mkdir(outputDir, { recursive: true })
  await writeFile(
    join(outputDir, 'quality-dependency-risk.json'),
    JSON.stringify(result, null, 2),
    'utf-8',
  )

  return result
}

function runPackageAudit(
  projectDir: string,
  auditLevel: string,
): Promise<{
  tool: string
  counts: Partial<VulnerabilityCounts>
  failed: boolean
}> {
  const auditCommand = getAuditCommand(projectDir, auditLevel)

  return new Promise((resolve, reject) => {
    execFile(
      auditCommand.command,
      auditCommand.args,
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        try {
          const output: unknown = JSON.parse(stdout || '{}')
          const auditOutput = output as NpmAuditOutput
          if (auditOutput.error) {
            reject(new Error(auditOutput.error.summary ?? auditOutput.error.code ?? 'audit failed'))
            return
          }

          const counts = extractVulnerabilityCounts(auditOutput)
          const failed = hasSeverityAtOrAbove(counts, auditLevel)
          resolve({ tool: auditCommand.name, counts, failed })
        } catch {
          if (error && !stdout) {
            reject(new Error(`${auditCommand.name} failed: ${stderr.trim() || error.message}`))
          } else {
            resolve({ tool: auditCommand.name, counts: {}, failed: false })
          }
        }
      },
    )
  })
}

function getAuditCommand(
  projectDir: string,
  auditLevel: string,
): { name: string; command: string; args: string[] } {
  if (existsSync(join(projectDir, 'pnpm-lock.yaml'))) {
    return {
      name: 'pnpm audit',
      command: 'pnpm',
      args: ['audit', '--json', `--audit-level=${auditLevel}`],
    }
  }

  return {
    name: 'npm audit',
    command: 'npm',
    args: ['audit', '--json', `--audit-level=${auditLevel}`],
  }
}

function extractVulnerabilityCounts(
  auditOutput: NpmAuditOutput,
): Partial<VulnerabilityCounts> {
  if (auditOutput.metadata?.vulnerabilities) {
    return auditOutput.metadata.vulnerabilities
  }

  const counts: VulnerabilityCounts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
  }

  const advisoryValues = Object.values(auditOutput.advisories ?? {})
  const vulnerabilityValues = Object.values(auditOutput.vulnerabilities ?? {})

  for (const item of [...advisoryValues, ...vulnerabilityValues]) {
    const severity = item.severity
    if (isVulnerabilitySeverity(severity)) {
      counts[severity] += 1
    }
  }

  return counts
}

function hasSeverityAtOrAbove(
  counts: Partial<VulnerabilityCounts>,
  threshold: string,
): boolean {
  const rank: Record<keyof VulnerabilityCounts, number> = {
    info: 0,
    low: 1,
    moderate: 2,
    high: 3,
    critical: 4,
  }

  const thresholdRank = isVulnerabilitySeverity(threshold) ? rank[threshold] : rank.high

  return Object.entries(counts).some(([severity, count]) => {
    if (!isVulnerabilitySeverity(severity)) return false
    return rank[severity] >= thresholdRank && (count ?? 0) > 0
  })
}

function isVulnerabilitySeverity(
  value: string | undefined,
): value is keyof VulnerabilityCounts {
  return value === 'info' ||
    value === 'low' ||
    value === 'moderate' ||
    value === 'high' ||
    value === 'critical'
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
