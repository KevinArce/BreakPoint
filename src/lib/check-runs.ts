import type { Context } from 'probot'
import type { ContractReport, QualityGateAnnotation } from '../types.js'

const CHECK_RUN_NAME = 'API Contract'

/** Maximum annotations per Check Run update (GitHub API limit). */
const MAX_ANNOTATIONS = 50

/** Simplified Probot context type to avoid TS2590 union complexity. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProbotContext = Context<any>

interface CheckRunAnnotation {
  path: string
  start_line: number
  end_line: number
  annotation_level: 'notice' | 'warning' | 'failure'
  message: string
}

/**
 * Determines the Check Run conclusion from the contract report.
 */
function determineConclusion(
  report: ContractReport,
): 'success' | 'failure' | 'neutral' {
  const versionFailed = !report.version.passed
  const hasBreaking = report.diff.breaking.length > 0
  const hasFailedGates = report.qualityGates.some((g) => g.status === 'failed')

  if (report.override.active && versionFailed && hasBreaking && !hasFailedGates) {
    return 'neutral'
  }

  if (versionFailed || hasFailedGates) {
    return 'failure'
  }

  return 'success'
}

/**
 * Builds Check Run annotations from the report.
 */
function buildAnnotations(report: ContractReport): CheckRunAnnotation[] {
  const annotations: CheckRunAnnotation[] = []

  // Breaking change annotations
  for (const change of report.diff.breaking) {
    annotations.push({
      path: change.path ?? 'openapi/schema.json',
      start_line: 1,
      end_line: 1,
      annotation_level: 'failure',
      message: `Breaking: ${change.message}`,
    })
  }

  // Quality gate annotations
  for (const gate of report.qualityGates) {
    for (const annotation of gate.annotations) {
      annotations.push(mapGateAnnotation(annotation))
    }
  }

  // Override warning
  if (report.override.active) {
    annotations.push({
      path: 'openapi/schema.json',
      start_line: 1,
      end_line: 1,
      annotation_level: 'warning',
      message: `Enforcement overridden via label "${report.override.label}". Breaking changes are still reported.`,
    })
  }

  return annotations.slice(0, MAX_ANNOTATIONS)
}

function mapGateAnnotation(annotation: QualityGateAnnotation): CheckRunAnnotation {
  return {
    path: annotation.path ?? 'openapi/schema.json',
    start_line: annotation.startLine ?? 1,
    end_line: annotation.startLine ?? 1,
    annotation_level: annotation.level,
    message: annotation.message,
  }
}

/**
 * Builds the Check Run output summary text.
 */
function buildSummary(report: ContractReport): string {
  const lines: string[] = []

  lines.push(`**Breaking:** ${report.diff.breaking.length}`)
  lines.push(`**Non-breaking:** ${report.diff.nonBreaking.length}`)
  lines.push(`**Patch:** ${report.diff.patch.length}`)
  lines.push('')
  lines.push(`**Version:** ${report.version.message}`)

  if (report.override.active) {
    lines.push(`**Override:** Active (${report.override.label})`)
  }

  for (const gate of report.qualityGates) {
    lines.push(`**${gate.name}:** ${gate.status} — ${gate.summary}`)
  }

  return lines.join('\n')
}

/**
 * Finds the existing Check Run for the given head SHA, or returns undefined.
 */
async function findExistingCheckRun(
  context: ProbotContext,
  headSha: string,
): Promise<number | undefined> {
  const response = await context.octokit.checks.listForRef(
    context.repo({
      ref: headSha,
      check_name: CHECK_RUN_NAME,
    }),
  )

  const runs = response.data.check_runs
  if (runs.length === 0) {
    return undefined
  }

  // Return the newest matching run
  return runs[0]?.id
}

/**
 * Creates or updates an in-progress Check Run for the PR.
 */
export async function startCheckRun(
  context: ProbotContext,
  headSha: string,
): Promise<number> {
  const existingId = await findExistingCheckRun(context, headSha)

  if (existingId !== undefined) {
    await context.octokit.checks.update(
      context.repo({
        check_run_id: existingId,
        status: 'in_progress' as const,
        started_at: new Date().toISOString(),
        output: {
          title: CHECK_RUN_NAME,
          summary: 'Analyzing API contract changes…',
        },
      }),
    )
    return existingId
  }

  const result = await context.octokit.checks.create(
    context.repo({
      name: CHECK_RUN_NAME,
      head_sha: headSha,
      status: 'in_progress' as const,
      started_at: new Date().toISOString(),
      output: {
        title: CHECK_RUN_NAME,
        summary: 'Analyzing API contract changes…',
      },
    }),
  )

  return result.data.id
}

/**
 * Completes a Check Run with the final report.
 */
export async function completeCheckRun(
  context: ProbotContext,
  checkRunId: number,
  report: ContractReport,
): Promise<void> {
  const conclusion = determineConclusion(report)
  const annotations = buildAnnotations(report)
  const summary = buildSummary(report)

  await context.octokit.checks.update(
    context.repo({
      check_run_id: checkRunId,
      status: 'completed' as const,
      completed_at: new Date().toISOString(),
      conclusion,
      output: {
        title: CHECK_RUN_NAME,
        summary,
        annotations,
      },
    }),
  )
}

/**
 * Fails a Check Run with an error message (e.g., for config validation failures).
 */
export async function failCheckRun(
  context: ProbotContext,
  checkRunId: number,
  errorMessage: string,
): Promise<void> {
  await context.octokit.checks.update(
    context.repo({
      check_run_id: checkRunId,
      status: 'completed' as const,
      completed_at: new Date().toISOString(),
      conclusion: 'failure' as const,
      output: {
        title: CHECK_RUN_NAME,
        summary: `❌ ${errorMessage}`,
      },
    }),
  )
}
