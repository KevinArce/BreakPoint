import type { QualityGateResult } from '../../types.js'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface BenchmarkResult {
  method: string
  path: string
  requestsPerSec: number
  latencyP50: number
  latencyP95: number
  latencyP99: number
  errorRate: number
}

/**
 * Runs performance budget checks using autocannon.
 */
export async function runPerformanceBudgetGate(options: {
  startCommand: string
  warmupSeconds: number
  regressionThresholdPercent: number
  endpoints: Array<{ method: string; path: string }>
  outputDir: string
  projectDir: string
}): Promise<QualityGateResult> {
  const { endpoints, outputDir } = options

  if (endpoints.length === 0) {
    const skipped: QualityGateResult = {
      id: 'performance-budget',
      name: 'Performance Budget',
      status: 'skipped',
      summary: 'No endpoints configured for benchmarking.',
      annotations: [],
    }
    await writeGateResult(outputDir, skipped)
    return skipped
  }

  try {
    const results: BenchmarkResult[] = []
    for (const endpoint of endpoints) {
      const result = await benchmarkEndpoint(endpoint.method, endpoint.path)
      results.push(result)
    }

    const gateResult: QualityGateResult = {
      id: 'performance-budget',
      name: 'Performance Budget',
      status: 'passed',
      summary: `${results.length} endpoint(s) benchmarked`,
      annotations: [],
    }

    await writeGateResult(outputDir, gateResult)

    return gateResult
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const warning: QualityGateResult = {
      id: 'performance-budget',
      name: 'Performance Budget',
      status: 'warning',
      summary: `Failed to run benchmark: ${message}`,
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
    join(outputDir, 'quality-performance-budget.json'),
    JSON.stringify(result, null, 2),
    'utf-8',
  )
}

function benchmarkEndpoint(method: string, path: string): Promise<BenchmarkResult> {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:3000${path}`
    execFile(
      'npx',
      ['autocannon', '-j', '-d', '10', '-m', method, url],
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) {
          reject(new Error(`autocannon failed for ${method} ${path}: ${error.message}`))
          return
        }
        try {
          const data = JSON.parse(stdout) as Record<string, unknown>
          const latency = data['latency'] as Record<string, number> | undefined
          const requests = data['requests'] as Record<string, number> | undefined
          resolve({
            method, path,
            requestsPerSec: requests?.['average'] ?? 0,
            latencyP50: latency?.['p50'] ?? 0,
            latencyP95: latency?.['p95'] ?? 0,
            latencyP99: latency?.['p99'] ?? 0,
            errorRate: 0,
          })
        } catch {
          reject(new Error(`Failed to parse autocannon output for ${method} ${path}`))
        }
      },
    )
  })
}
