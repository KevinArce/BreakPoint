import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { ApiChange, DiffResult } from '../types.js'

interface OpenApiDiffChange {
  code: string
  action?: string
  entity?: string
  source?: string
  sourceSpecEntityDetails?: Array<{
    location?: string
  }>
  destinationSpecEntityDetails?: Array<{
    location?: string
  }>
}

interface OpenApiDiffResult {
  breakingDifferences: OpenApiDiffChange[]
  nonBreakingDifferences: OpenApiDiffChange[]
  unclassifiedDifferences: OpenApiDiffChange[]
}

/**
 * Reads and parses a JSON schema file. Throws a readable error if the file
 * is missing or contains invalid JSON.
 */
async function loadSchema(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    throw new Error(`Schema file not found: ${filePath}`)
  }

  const raw = await readFile(filePath, 'utf-8')
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Schema file does not contain a JSON object: ${filePath}`)
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Schema file contains invalid JSON: ${filePath}`)
    }
    throw error
  }
}

/**
 * Extracts a path and method from an openapi-diff change's location string.
 * Location strings typically look like: "/paths/~1users/{id}/get"
 */
function extractPathAndMethod(change: OpenApiDiffChange): { path?: string; method?: string } {
  const details =
    change.destinationSpecEntityDetails?.[0] ??
    change.sourceSpecEntityDetails?.[0]

  const location = details?.location
  if (!location) {
    return {}
  }

  // Parse location strings like "/paths/~1users~1{id}/get/responses/200"
  const pathMatch = /^\/paths\/([^/]+)(?:\/([^/]+))?/.exec(location)
  if (!pathMatch) {
    return {}
  }

  const rawPath = pathMatch[1]
  const method = pathMatch[2]

  // Decode OpenAPI JSON Pointer encoding: ~1 = /, ~0 = ~
  const path = rawPath
    ? '/' + rawPath.replace(/~1/g, '/').replace(/~0/g, '~')
    : undefined

  return { path, method: method?.toUpperCase() }
}

/**
 * Classifies a patch-level change vs keeping the openapi-diff classification.
 */
function isPatchChange(change: OpenApiDiffChange): boolean {
  const code = change.code.toLowerCase()
  return (
    code.includes('description') ||
    code.includes('summary') ||
    code.includes('example') ||
    code.includes('x-')
  )
}

/**
 * Maps an openapi-diff change to our internal ApiChange model.
 */
function mapChange(change: OpenApiDiffChange, classification: ApiChange['class']): ApiChange {
  const { path, method } = extractPathAndMethod(change)

  const message =
    change.action && change.entity
      ? `${change.action} ${change.entity}`
      : change.code

  return {
    id: `${classification}-${change.code}-${path ?? 'global'}-${method ?? 'any'}`,
    class: classification,
    path,
    method,
    location: change.sourceSpecEntityDetails?.[0]?.location ??
              change.destinationSpecEntityDetails?.[0]?.location,
    message,
  }
}

/**
 * Sorts changes deterministically by id.
 */
function sortChanges(changes: ApiChange[]): ApiChange[] {
  return [...changes].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Diffs two OpenAPI schema files and returns a normalized DiffResult.
 */
export async function diffSchemas(
  baseSchemaPath: string,
  prSchemaPath: string,
): Promise<DiffResult> {
  const [baseSpec, prSpec] = await Promise.all([
    loadSchema(baseSchemaPath),
    loadSchema(prSchemaPath),
  ])

  // Dynamic import for the CJS module
  const openapiDiff = await import('openapi-diff')
  const diffSpecs = openapiDiff.default?.diffSpecs ?? (openapiDiff as unknown as { diffSpecs: (opts: { sourceSpec: { content: string; location: string; format: string }; destinationSpec: { content: string; location: string; format: string } }) => Promise<OpenApiDiffResult> }).diffSpecs

  let result: OpenApiDiffResult
  try {
    const outcome = await diffSpecs({
      sourceSpec: {
        content: JSON.stringify(baseSpec),
        location: baseSchemaPath,
        format: 'openapi3',
      },
      destinationSpec: {
        content: JSON.stringify(prSpec),
        location: prSchemaPath,
        format: 'openapi3',
      },
    })

    // Normalize: DiffOutcomeSuccess doesn't have breakingDifferences
    result = {
      breakingDifferences: 'breakingDifferences' in outcome ? (outcome as OpenApiDiffResult).breakingDifferences : [],
      nonBreakingDifferences: outcome.nonBreakingDifferences as unknown as OpenApiDiffChange[],
      unclassifiedDifferences: outcome.unclassifiedDifferences as unknown as OpenApiDiffChange[],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to diff schemas: ${message}`)
  }

  const breaking: ApiChange[] = []
  const nonBreaking: ApiChange[] = []
  const patch: ApiChange[] = []

  for (const change of result.breakingDifferences) {
    if (isPatchChange(change)) {
      patch.push(mapChange(change, 'patch'))
    } else {
      breaking.push(mapChange(change, 'breaking'))
    }
  }

  for (const change of result.nonBreakingDifferences) {
    if (isPatchChange(change)) {
      patch.push(mapChange(change, 'patch'))
    } else {
      nonBreaking.push(mapChange(change, 'non-breaking'))
    }
  }

  for (const change of result.unclassifiedDifferences) {
    if (isPatchChange(change)) {
      patch.push(mapChange(change, 'patch'))
    } else {
      // Unclassified changes default to non-breaking
      nonBreaking.push(mapChange(change, 'non-breaking'))
    }
  }

  return {
    breaking: sortChanges(breaking),
    nonBreaking: sortChanges(nonBreaking),
    patch: sortChanges(patch),
  }
}
