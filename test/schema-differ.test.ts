import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { diffSchemas } from '../src/lib/schema-differ.js'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures')

const basePath = join(FIXTURES_DIR, 'openapi-base.json')
const breakingPath = join(FIXTURES_DIR, 'openapi-breaking.json')
const nonBreakingPath = join(FIXTURES_DIR, 'openapi-non-breaking.json')

describe('diffSchemas', () => {
  it('detects breaking changes', async () => {
    const result = await diffSchemas(basePath, breakingPath)
    expect(result.breaking.length).toBeGreaterThan(0)
    expect(result.breaking.every((c) => c.class === 'breaking')).toBe(true)
  })

  it('detects non-breaking changes', async () => {
    const result = await diffSchemas(basePath, nonBreakingPath)
    expect(result.nonBreaking.length).toBeGreaterThan(0)
    expect(result.nonBreaking.every((c) => c.class === 'non-breaking')).toBe(true)
  })

  it('returns empty diff for identical schemas', async () => {
    const result = await diffSchemas(basePath, basePath)
    expect(result.breaking).toHaveLength(0)
    expect(result.nonBreaking).toHaveLength(0)
    expect(result.patch).toHaveLength(0)
  })

  it('sorts changes deterministically', async () => {
    const result1 = await diffSchemas(basePath, breakingPath)
    const result2 = await diffSchemas(basePath, breakingPath)
    expect(result1.breaking.map((c) => c.id)).toEqual(result2.breaking.map((c) => c.id))
  })

  it('includes id for every change', async () => {
    const result = await diffSchemas(basePath, breakingPath)
    for (const change of [...result.breaking, ...result.nonBreaking, ...result.patch]) {
      expect(change.id).toBeTruthy()
    }
  })

  it('includes message for every change', async () => {
    const result = await diffSchemas(basePath, nonBreakingPath)
    for (const change of [...result.breaking, ...result.nonBreaking, ...result.patch]) {
      expect(change.message).toBeTruthy()
    }
  })

  it('throws for missing schema file', async () => {
    await expect(diffSchemas('/nonexistent/path.json', basePath)).rejects.toThrow(
      'Schema file not found',
    )
  })

  it('throws for invalid JSON', async () => {
    // Use a known non-JSON file (e.g., this test file itself)
    const thisFile = import.meta.filename
    await expect(diffSchemas(thisFile, basePath)).rejects.toThrow()
  })
})
