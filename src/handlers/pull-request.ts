import type { Context } from 'probot'
import { parseConfig } from '../config.js'
import { startCheckRun, completeCheckRun, failCheckRun } from '../lib/check-runs.js'
import { upsertComment, upsertErrorComment } from '../lib/comments.js'
import { diffSchemas } from '../lib/schema-differ.js'
import { enforceVersion } from '../lib/version-enforcer.js'
import { loadQualityGateResults } from '../lib/quality-gates/types.js'
import type { ContractReport } from '../types.js'

/**
 * Reads a version string from a JSON file via the GitHub API.
 */
async function readVersionFromFile(
  context: Context<'pull_request'>,
  ref: string,
  filePath: string,
): Promise<string | undefined> {
  try {
    const response = await context.octokit.rest.repos.getContent(
      context.repo({
        path: filePath,
        ref,
      }),
    )

    const data = response.data
    if ('content' in data && typeof data.content === 'string') {
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      const parsed: unknown = JSON.parse(content)
      if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
        const version = (parsed as Record<string, unknown>)['version']
        if (typeof version === 'string') {
          return version
        }
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Checks whether a label is present on the PR.
 */
function hasLabel(context: Context<'pull_request'>, labelName: string): boolean {
  const labels = context.payload.pull_request.labels
  return labels.some((label) => label.name === labelName)
}

/**
 * Handles pull_request.opened, pull_request.synchronize, and pull_request.reopened events.
 */
export async function handlePullRequest(
  context: Context<'pull_request'>,
): Promise<void> {
  const pr = context.payload.pull_request
  const headSha = pr.head.sha

  // Start or update the Check Run
  const checkRunId = await startCheckRun(context, headSha)

  // Load and validate config
  const rawConfig: unknown = await context.config('api-contract.yml')
  const configResult = parseConfig(rawConfig)

  if (!configResult.success) {
    await failCheckRun(context, checkRunId, configResult.error)
    await upsertErrorComment(context, pr.number, configResult.error)
    return
  }

  const config = configResult.config

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

  // Read versions
  const baseBranch = pr.base.ref
  const baseVersion = await readVersionFromFile(context, baseBranch, config.version_file)
  const prVersion = await readVersionFromFile(context, headSha, config.version_file)

  if (!baseVersion || !prVersion) {
    const msg = `Could not read version from "${config.version_file}" on both branches.`
    await failCheckRun(context, checkRunId, msg)
    await upsertErrorComment(context, pr.number, msg)
    return
  }

  // Enforce version
  const versionResult = enforceVersion(baseVersion, prVersion, diff, config.enforcement)

  // Check override label
  const overrideLabel = config.enforcement.allow_override_label
  const overrideActive = hasLabel(context, overrideLabel)

  // Load quality gate results if available
  const qualityGates = await loadQualityGateResults()

  // Build report
  const report: ContractReport = {
    diff,
    version: versionResult,
    override: {
      active: overrideActive,
      label: overrideLabel,
    },
    qualityGates,
  }

  // Complete Check Run and upsert PR comment
  await completeCheckRun(context, checkRunId, report)
  await upsertComment(context, pr.number, report)
}
