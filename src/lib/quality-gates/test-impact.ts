import type { QualityGateResult } from '../../types.js'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Strategy = 'auto' | 'nx' | 'turbo' | 'vitest' | 'jest' | 'full'

/** Files that force a full test suite when changed. */
const FULL_SUITE_TRIGGERS = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'tsconfig.json',
  'jest.config',
  'vitest.config',
  '.env',
]

/**
 * Runs test impact analysis to determine which tests need to run.
 */
export async function runTestImpactGate(options: {
  strategy: Strategy
  fallbackToFullSuite: boolean
  outputDir: string
  projectDir: string
  baseBranch: string
  changedFiles?: string[]
}): Promise<QualityGateResult> {
  const { strategy, fallbackToFullSuite, outputDir, projectDir, baseBranch, changedFiles } = options

  // Check if changed files force a full suite
  const forceFullSuite = changedFiles?.some((file) =>
    FULL_SUITE_TRIGGERS.some((trigger) => file.includes(trigger)),
  ) ?? false

  let resolvedStrategy = strategy
  let suiteType: 'reduced' | 'full' = 'full'

  if (forceFullSuite || strategy === 'full') {
    resolvedStrategy = 'full'
  } else if (strategy === 'auto') {
    resolvedStrategy = await detectStrategy(projectDir)
  }

  try {
    let testResult: { passed: boolean; summary: string }

    if (resolvedStrategy === 'full' || forceFullSuite) {
      suiteType = 'full'
      testResult = await runFullSuite(projectDir)
    } else {
      suiteType = 'reduced'
      testResult = await runImpactedTests(projectDir, resolvedStrategy, baseBranch)

      if (!testResult.passed && fallbackToFullSuite) {
        suiteType = 'full'
        testResult = await runFullSuite(projectDir)
      }
    }

    const gateResult: QualityGateResult = {
      id: 'test-impact',
      name: 'Test Impact',
      status: testResult.passed ? 'passed' : 'failed',
      summary: `${suiteType === 'full' ? 'Full' : 'Reduced'} suite (${resolvedStrategy}): ${testResult.summary}`,
      annotations: [],
    }

    await writeGateResult(outputDir, gateResult)

    return gateResult
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const warning: QualityGateResult = {
      id: 'test-impact',
      name: 'Test Impact',
      status: 'warning',
      summary: `Test impact analysis failed: ${message}`,
      annotations: [],
    }
    await writeGateResult(outputDir, warning)
    return warning
  }
}

async function writeGateResult(
  outputDir: string,
  result: QualityGateResult,
): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  await writeFile(
    join(outputDir, 'quality-test-impact.json'),
    JSON.stringify(result, null, 2),
    'utf-8',
  )
}

async function detectStrategy(projectDir: string): Promise<Strategy> {
  if (existsSync(join(projectDir, 'nx.json'))) return 'nx'
  if (existsSync(join(projectDir, 'turbo.json'))) return 'turbo'
  if (existsSync(join(projectDir, 'vitest.config.ts')) || existsSync(join(projectDir, 'vitest.config.js'))) return 'vitest'
  if (existsSync(join(projectDir, 'jest.config.ts')) || existsSync(join(projectDir, 'jest.config.js'))) return 'jest'
  return 'full'
}

function runFullSuite(projectDir: string): Promise<{ passed: boolean; summary: string }> {
  return new Promise((resolve) => {
    execFile('npm', ['test'], { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 }, (error) => {
      resolve({
        passed: !error,
        summary: error ? 'Tests failed' : 'All tests passed',
      })
    })
  })
}

function runImpactedTests(
  projectDir: string,
  strategy: Strategy,
  baseBranch: string,
): Promise<{ passed: boolean; summary: string }> {
  return new Promise((resolve) => {
    let cmd: string
    let args: string[]

    switch (strategy) {
      case 'nx':
        cmd = 'npx'
        args = ['nx', 'affected', '-t', 'test', `--base=${baseBranch}`, '--head=HEAD']
        break
      case 'turbo':
        cmd = 'npx'
        args = ['turbo', 'run', 'test', '--filter=...[HEAD]']
        break
      case 'vitest':
        cmd = 'npx'
        args = ['vitest', 'run', '--changed', baseBranch]
        break
      case 'jest':
        cmd = 'npx'
        args = ['jest', '--changedSince', baseBranch]
        break
      default:
        resolve({ passed: true, summary: 'No impacted test strategy resolved' })
        return
    }

    execFile(cmd, args, { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 }, (error) => {
      resolve({
        passed: !error,
        summary: error ? `Impacted tests failed (${strategy})` : `Impacted tests passed (${strategy})`,
      })
    })
  })
}
