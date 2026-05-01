import type { Context } from 'probot'
import { getCommentMarker, buildComment } from './comment-builder.js'
import type { ContractReport } from '../types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProbotContext = Context<any>

/**
 * Finds the existing bot comment in the PR by the hidden marker.
 */
async function findExistingComment(
  context: ProbotContext,
  prNumber: number,
): Promise<number | undefined> {
  const marker = getCommentMarker()

  const { data: comments } = await context.octokit.rest.issues.listComments(
    context.repo({
      issue_number: prNumber,
      per_page: 100,
    }),
  )

  for (const comment of comments) {
    if (comment.body?.startsWith(marker)) {
      return comment.id
    }
  }

  return undefined
}

/**
 * Creates or updates the PR comment with the contract report.
 * Idempotent: edits existing comment if found, creates new one otherwise.
 */
export async function upsertComment(
  context: ProbotContext,
  prNumber: number,
  report: ContractReport,
): Promise<void> {
  const body = buildComment(report)
  const existingCommentId = await findExistingComment(context, prNumber)

  if (existingCommentId !== undefined) {
    await context.octokit.rest.issues.updateComment(
      context.repo({
        comment_id: existingCommentId,
        body,
      }),
    )
  } else {
    await context.octokit.rest.issues.createComment(
      context.repo({
        issue_number: prNumber,
        body,
      }),
    )
  }
}

/**
 * Posts an error comment when the report cannot be generated (e.g., config failure).
 */
export async function upsertErrorComment(
  context: ProbotContext,
  prNumber: number,
  errorMessage: string,
): Promise<void> {
  const marker = getCommentMarker()
  const body = `${marker}\n\n## ❌ API Contract Report\n\n${errorMessage}`

  const existingCommentId = await findExistingComment(context, prNumber)

  if (existingCommentId !== undefined) {
    await context.octokit.rest.issues.updateComment(
      context.repo({
        comment_id: existingCommentId,
        body,
      }),
    )
  } else {
    await context.octokit.rest.issues.createComment(
      context.repo({
        issue_number: prNumber,
        body,
      }),
    )
  }
}
