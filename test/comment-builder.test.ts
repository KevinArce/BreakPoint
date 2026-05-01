import { describe, expect, it } from 'vitest'
import { buildComment, getCommentMarker } from '../src/lib/comment-builder.js'
import type { ContractReport, DiffResult, VersionEnforcementResult } from '../src/types.js'

const emptyDiff: DiffResult = { breaking: [], nonBreaking: [], patch: [] }

const passingVersion: VersionEnforcementResult = {
  passed: true,
  requiredBump: 'none',
  actualBump: 'none',
  baseVersion: '1.0.0',
  prVersion: '1.0.0',
  message: 'No API changes detected — no version bump required.',
}

function makeReport(overrides: Partial<ContractReport> = {}): ContractReport {
  return {
    diff: emptyDiff,
    version: passingVersion,
    override: { active: false, label: 'override-breaking-change' },
    qualityGates: [],
    ...overrides,
  }
}

describe('getCommentMarker', () => {
  it('returns the expected marker', () => {
    expect(getCommentMarker()).toBe('<!-- api-contract-report -->')
  })
})

describe('buildComment', () => {
  it('starts with the hidden marker', () => {
    const comment = buildComment(makeReport())
    expect(comment.startsWith('<!-- api-contract-report -->')).toBe(true)
  })

  it('contains the report header', () => {
    const comment = buildComment(makeReport())
    expect(comment).toContain('## 📋 API Contract Report')
  })

  it('renders summary table with counts', () => {
    const comment = buildComment(makeReport())
    expect(comment).toContain('| Breaking Changes | 0 |')
    expect(comment).toContain('| Non-Breaking Changes | 0 |')
    expect(comment).toContain('| Patch Changes | 0 |')
    expect(comment).toContain('| Version Enforcement | ✅ Pass |')
  })

  it('renders breaking changes section', () => {
    const report = makeReport({
      diff: {
        breaking: [
          { id: 'b1', class: 'breaking', path: '/users', method: 'DELETE', message: 'Removed endpoint' },
        ],
        nonBreaking: [],
        patch: [],
      },
    })
    const comment = buildComment(report)
    expect(comment).toContain('### 🔴 Breaking Changes')
    expect(comment).toContain('`DELETE /users`')
    expect(comment).toContain('Removed endpoint')
  })

  it('renders non-breaking changes section', () => {
    const report = makeReport({
      diff: {
        breaking: [],
        nonBreaking: [
          { id: 'nb1', class: 'non-breaking', path: '/users', method: 'POST', message: 'Added endpoint' },
        ],
        patch: [],
      },
    })
    const comment = buildComment(report)
    expect(comment).toContain('### 🟡 Non-Breaking Changes')
    expect(comment).toContain('Added endpoint')
  })

  it('renders patch changes section', () => {
    const report = makeReport({
      diff: {
        breaking: [],
        nonBreaking: [],
        patch: [
          { id: 'p1', class: 'patch', message: 'Updated description' },
        ],
      },
    })
    const comment = buildComment(report)
    expect(comment).toContain('### 🟢 Patch Changes')
    expect(comment).toContain('Updated description')
  })

  it('omits empty change sections', () => {
    const comment = buildComment(makeReport())
    expect(comment).not.toContain('### 🔴 Breaking Changes')
    expect(comment).not.toContain('### 🟡 Non-Breaking Changes')
    expect(comment).not.toContain('### 🟢 Patch Changes')
  })

  it('renders version enforcement failure', () => {
    const report = makeReport({
      version: {
        passed: false,
        requiredBump: 'major',
        actualBump: 'minor',
        baseVersion: '1.0.0',
        prVersion: '1.1.0',
        message: 'API changes require a major bump, but version went from 1.0.0 → 1.1.0 (minor bump).',
      },
    })
    const comment = buildComment(report)
    expect(comment).toContain('❌')
    expect(comment).toContain('major bump')
    expect(comment).toContain('| Version Enforcement | ❌ Fail |')
  })

  it('renders override status when active', () => {
    const report = makeReport({
      override: { active: true, label: 'override-breaking-change' },
    })
    const comment = buildComment(report)
    expect(comment).toContain('### ⚠️ Override Active')
    expect(comment).toContain('`override-breaking-change`')
    expect(comment).toContain('| Override | ⚠️ Active |')
  })

  it('omits override section when inactive', () => {
    const comment = buildComment(makeReport())
    expect(comment).not.toContain('### ⚠️ Override Active')
    expect(comment).toContain('| Override | — |')
  })

  it('renders quality gates table', () => {
    const report = makeReport({
      qualityGates: [
        { id: 'dead-code', name: 'Dead Code', status: 'passed', summary: '0 findings', annotations: [] },
        { id: 'dep-risk', name: 'Dependency Risk', status: 'warning', summary: '2 moderate vulns', annotations: [] },
      ],
    })
    const comment = buildComment(report)
    expect(comment).toContain('### 🔍 Quality Gates')
    expect(comment).toContain('| Dead Code | ✅ passed | 0 findings |')
    expect(comment).toContain('| Dependency Risk | ⚠️ warning | 2 moderate vulns |')
  })

  it('omits quality gates section when empty', () => {
    const comment = buildComment(makeReport())
    expect(comment).not.toContain('### 🔍 Quality Gates')
  })

  it('produces deterministic output for the same input', () => {
    const report = makeReport({
      diff: {
        breaking: [{ id: 'b1', class: 'breaking', path: '/a', method: 'GET', message: 'Removed' }],
        nonBreaking: [{ id: 'nb1', class: 'non-breaking', path: '/b', method: 'POST', message: 'Added' }],
        patch: [{ id: 'p1', class: 'patch', message: 'Docs update' }],
      },
      version: {
        passed: true,
        requiredBump: 'major',
        actualBump: 'major',
        baseVersion: '1.0.0',
        prVersion: '2.0.0',
        message: 'Version bump 1.0.0 → 2.0.0 satisfies required major bump.',
      },
    })

    const comment1 = buildComment(report)
    const comment2 = buildComment(report)
    expect(comment1).toBe(comment2)
  })

  it('matches snapshot for a full report', () => {
    const report = makeReport({
      diff: {
        breaking: [
          { id: 'b1', class: 'breaking', path: '/users/{id}', method: 'DELETE', message: 'Removed endpoint' },
        ],
        nonBreaking: [
          { id: 'nb1', class: 'non-breaking', path: '/users', method: 'POST', message: 'Added optional field `nickname`' },
        ],
        patch: [
          { id: 'p1', class: 'patch', message: 'Updated API description' },
        ],
      },
      version: {
        passed: true,
        requiredBump: 'major',
        actualBump: 'major',
        baseVersion: '1.0.0',
        prVersion: '2.0.0',
        message: 'Version bump 1.0.0 → 2.0.0 satisfies required major bump.',
      },
      override: { active: false, label: 'override-breaking-change' },
      qualityGates: [
        { id: 'dep-risk', name: 'Dependency Risk', status: 'passed', summary: 'No vulnerabilities found', annotations: [] },
      ],
    })

    expect(buildComment(report)).toMatchSnapshot()
  })
})
