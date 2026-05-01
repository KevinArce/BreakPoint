import type { ContractReport } from '../types.js'
import type { QualityGateResult, QualityGateStatus } from '../types.js'

const MARKER = '<!-- api-contract-report -->'

/**
 * Returns the hidden marker used to identify bot comments.
 */
export function getCommentMarker(): string {
  return MARKER
}

/**
 * Builds the full Markdown report for a PR comment.
 */
export function buildComment(report: ContractReport): string {
  const sections: string[] = [MARKER, '']

  sections.push('## 📋 API Contract Report')
  sections.push('')

  // Summary table
  sections.push(buildSummaryTable(report))
  sections.push('')

  // Breaking changes
  if (report.diff.breaking.length > 0) {
    sections.push('### 🔴 Breaking Changes')
    sections.push('')
    for (const change of report.diff.breaking) {
      const location = formatLocation(change.path, change.method)
      sections.push(`- ${location}${change.message}`)
    }
    sections.push('')
  }

  // Non-breaking changes
  if (report.diff.nonBreaking.length > 0) {
    sections.push('### 🟡 Non-Breaking Changes')
    sections.push('')
    for (const change of report.diff.nonBreaking) {
      const location = formatLocation(change.path, change.method)
      sections.push(`- ${location}${change.message}`)
    }
    sections.push('')
  }

  // Patch changes
  if (report.diff.patch.length > 0) {
    sections.push('### 🟢 Patch Changes')
    sections.push('')
    for (const change of report.diff.patch) {
      const location = formatLocation(change.path, change.method)
      sections.push(`- ${location}${change.message}`)
    }
    sections.push('')
  }

  // Version enforcement
  sections.push('### 📦 Version Enforcement')
  sections.push('')
  sections.push(buildVersionSection(report))
  sections.push('')

  // Override status
  if (report.override.active) {
    sections.push('### ⚠️ Override Active')
    sections.push('')
    sections.push(`Enforcement overridden via label \`${report.override.label}\`. Breaking changes are still reported above but will not block the PR.`)
    sections.push('')
  }

  // Quality gates
  if (report.qualityGates.length > 0) {
    sections.push('### 🔍 Quality Gates')
    sections.push('')
    sections.push(buildQualityGatesTable(report.qualityGates))
    sections.push('')
  }

  return sections.join('\n').trimEnd()
}

function buildSummaryTable(report: ContractReport): string {
  const breakingCount = report.diff.breaking.length
  const nonBreakingCount = report.diff.nonBreaking.length
  const patchCount = report.diff.patch.length
  const versionStatus = report.version.passed ? '✅ Pass' : '❌ Fail'
  const overrideStatus = report.override.active ? '⚠️ Active' : '—'

  const lines = [
    '| Category | Count |',
    '| --- | --- |',
    `| Breaking Changes | ${breakingCount} |`,
    `| Non-Breaking Changes | ${nonBreakingCount} |`,
    `| Patch Changes | ${patchCount} |`,
    `| Version Enforcement | ${versionStatus} |`,
    `| Override | ${overrideStatus} |`,
  ]

  return lines.join('\n')
}

function buildVersionSection(report: ContractReport): string {
  const { version } = report
  const icon = version.passed ? '✅' : '❌'
  const lines = [
    `${icon} ${version.message}`,
    '',
    `- Base: \`${version.baseVersion}\``,
    `- PR: \`${version.prVersion}\``,
    `- Required bump: **${version.requiredBump}**`,
    `- Actual bump: **${version.actualBump}**`,
  ]
  return lines.join('\n')
}

function buildQualityGatesTable(gates: QualityGateResult[]): string {
  const lines = [
    '| Gate | Status | Summary |',
    '| --- | --- | --- |',
  ]

  for (const gate of gates) {
    const icon = statusIcon(gate.status)
    lines.push(`| ${gate.name} | ${icon} ${gate.status} | ${gate.summary} |`)
  }

  return lines.join('\n')
}

function statusIcon(status: QualityGateStatus): string {
  switch (status) {
    case 'passed':
      return '✅'
    case 'failed':
      return '❌'
    case 'warning':
      return '⚠️'
    case 'skipped':
      return '⏭️'
  }
}

function formatLocation(path?: string, method?: string): string {
  if (path && method) {
    return `\`${method.toUpperCase()} ${path}\`: `
  }
  if (path) {
    return `\`${path}\`: `
  }
  return ''
}
