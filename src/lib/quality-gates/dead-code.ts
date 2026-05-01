import type { QualityGateResult } from '../../types.js'
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface DeadCodeFinding {
  file: string
  name: string
  line?: number
  type: string
}

interface KnipOutput {
  files?: string[]
  issues?: Array<{
    file: string
    symbols?: Array<{
      symbol: string
      line?: number
      type?: string
    }>
  }>
}

/**
 * Runs dead code detection using knip or ts-prune.
 */
export async function runDeadCodeGate(options: {
  tool: 'knip' | 'ts-prune'
  maxFindings: number
  mode: 'warning' | 'failure'
  outputDir: string
  projectDir: string
}): Promise<QualityGateResult> {
  const { tool, maxFindings, mode, outputDir, projectDir } = options

  let findings: DeadCodeFinding[]

  try {
    if (tool === 'knip') {
      findings = await runKnip(projectDir)
    } else {
      findings = await runTsPrune(projectDir)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      id: 'dead-code',
      name: 'Dead Code',
      status: 'warning',
      summary: `Failed to run ${tool}: ${message}`,
      annotations: [],
    }
  }

  // Write report
  const report = { tool, findings, count: findings.length }
  await writeFile(
    join(outputDir, 'quality-dead-code.json'),
    JSON.stringify(
      {
        id: 'dead-code',
        name: 'Dead Code',
        status: determineStatus(findings.length, maxFindings, mode),
        summary: `${findings.length} finding(s) from ${tool}`,
        annotations: findings.slice(0, 50).map((f) => ({
          path: f.file,
          startLine: f.line,
          message: `Unused ${f.type}: ${f.name}`,
          level: mode === 'failure' ? ('failure' as const) : ('warning' as const),
        })),
      },
      null,
      2,
    ),
    'utf-8',
  )

  return {
    id: 'dead-code',
    name: 'Dead Code',
    status: determineStatus(findings.length, maxFindings, mode),
    summary: `${findings.length} finding(s) from ${tool}`,
    annotations: findings.slice(0, 50).map((f) => ({
      path: f.file,
      startLine: f.line,
      message: `Unused ${f.type}: ${f.name}`,
      level: mode === 'failure' ? ('failure' as const) : ('warning' as const),
    })),
  }
}

function determineStatus(
  count: number,
  maxFindings: number,
  mode: 'warning' | 'failure',
): 'passed' | 'failed' | 'warning' {
  if (count === 0) return 'passed'
  if (mode === 'failure' && count > maxFindings) return 'failed'
  return 'warning'
}

function runKnip(projectDir: string): Promise<DeadCodeFinding[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['knip', '--reporter', 'json'],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        // knip exits non-zero when it finds issues — that's expected
        if (error && !stdout) {
          reject(new Error(`knip failed: ${error.message}`))
          return
        }

        try {
          const output: unknown = JSON.parse(stdout)
          const findings = parseKnipOutput(output as KnipOutput)
          resolve(findings)
        } catch (parseError) {
          reject(new Error(`Failed to parse knip output: ${String(parseError)}`))
        }
      },
    )
  })
}

function parseKnipOutput(output: KnipOutput): DeadCodeFinding[] {
  const findings: DeadCodeFinding[] = []

  // Unused files
  if (output.files) {
    for (const file of output.files) {
      findings.push({ file, name: file, type: 'file' })
    }
  }

  // Unused exports
  if (output.issues) {
    for (const issue of output.issues) {
      if (issue.symbols) {
        for (const symbol of issue.symbols) {
          findings.push({
            file: issue.file,
            name: symbol.symbol,
            line: symbol.line,
            type: symbol.type ?? 'export',
          })
        }
      }
    }
  }

  return findings
}

function runTsPrune(projectDir: string): Promise<DeadCodeFinding[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['ts-prune'],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) {
          reject(new Error(`ts-prune failed: ${error.message}`))
          return
        }

        const findings: DeadCodeFinding[] = []
        const lines = stdout.split('\n').filter((line) => line.trim())

        for (const line of lines) {
          // ts-prune output format: "file.ts:line - symbolName"
          const match = /^(.+):(\d+)\s+-\s+(.+)$/.exec(line)
          if (match && match[1] && match[2] && match[3]) {
            findings.push({
              file: match[1],
              name: match[3].trim(),
              line: parseInt(match[2], 10),
              type: 'export',
            })
          }
        }

        resolve(findings)
      },
    )
  })
}
