import type { Context } from 'probot'
import { parseConfig } from '../config.js'
import { startCheckRun, completeCheckRun, failCheckRun } from '../lib/check-runs.js'
import { upsertComment, upsertErrorComment } from '../lib/comments.js'
import { diffSchemas } from '../lib/schema-differ.js'
import { enforceVersion } from '../lib/version-enforcer.js'
import { loadQualityGateResults } from '../lib/quality-gates/types.js'
import type { ContractReport } from '../types.js'

/**
 * Handles the pull_request.labeled event.
 *
 * When the configured override label is added, re-evaluates the existing report
 * so the Check Run and PR comment reflect the override state.
 */
export async function handleLabelOverride(
  context: Context<'pull_request.labeled'>,
): Promise<void> {
  const pr = context.payload.pull_request
  const headSha = pr.head.sha
  const addedLabel = context.payload.label?.name

  // Load config to determine the override label
  const rawConfig: unknown = await context.config('api-contract.yml')
  const configResult = parseConfig(
    rawConfig ? { 'api-contract': rawConfig } : null,
  )

  if (!configResult.success) {
    // Config is invalid; nothing to re-evaluate
    return
  }

  const config = configResult.config
  const overrideLabel = config.enforcement.allow_override_label

  // Only act when the override label is the one that was added
  if (addedLabel !== overrideLabel) {
    return
  }

  // Start or update the Check Run
  const checkRunId = await startCheckRun(context, headSha)

  // Read schema paths from environment
  const prSchemaPath = process.env['PR_SCHEMA_PATH']
  const baseSchemaPath = process.env['BASE_SCHEMA_PATH']

  if (!prSchemaPath || !baseSchemaPath) {
    const msg = 'Missing PR_SCHEMA_PATH or BASE_SCHEMA_PATH environment variables.'
    await failCheckRun(context, checkRunId, msg)
    await upsertErrorComment(context, pr.number, msg)
    return
  }

  // Diff schemas
  let diff
  try {
    diff = await diffSchemas(baseSchemaPath, prSchemaPath)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown schema diff error'
    await failCheckRun(context, checkRunId, msg)
    await upsertErrorComment(context, pr.number, msg)
    return
  }

  // Read versions via GitHub API
  const baseBranch = pr.base.ref

  let baseVersion: string | undefined
  let prVersion: string | undefined

  try {
    const baseResponse = await context.octokit.repos.getContent(
      context.repo({ path: config.version_file, ref: baseBranch }),
    )
    if ('content' in baseResponse.data && typeof baseResponse.data.content === 'string') {
      const content = Buffer.from(baseResponse.data.content, 'base64').toString('utf-8')
      const parsed: unknown = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
        const v = (parsed as Record<string, unknown>)['version']
        if (typeof v === 'string') baseVersion = v
      }
    }
  } catch {
    // version read failed
  }

  try {
    const prResponse = await context.octokit.repos.getContent(
      context.repo({ path: config.version_file, ref: headSha }),
    )
    if ('content' in prResponse.data && typeof prResponse.data.content === 'string') {
      const content = Buffer.from(prResponse.data.content, 'base64').toString('utf-8')
      const parsed: unknown = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
        const v = (parsed as Record<string, unknown>)['version']
        if (typeof v === 'string') prVersion = v
      }
    }
  } catch {
    // version read failed
  }

  if (!baseVersion || !prVersion) {
    const msg = `Could not read version from "${config.version_file}" on both branches.`
    await failCheckRun(context, checkRunId, msg)
    await upsertErrorComment(context, pr.number, msg)
    return
  }

  const versionResult = enforceVersion(baseVersion, prVersion, diff, config.enforcement)

  const qualityGates = await loadQualityGateResults()

  const report: ContractReport = {
    diff,
    version: versionResult,
    override: {
      active: true, // Override is active because we only run when the label is added
      label: overrideLabel,
    },
    qualityGates,
  }

  await completeCheckRun(context, checkRunId, report)
  await upsertComment(context, pr.number, report)
}
