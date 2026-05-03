#!/usr/bin/env tsx

/**
 * OpenAPI Schema Generator
 *
 * Writes a deterministic starter OpenAPI document to the configured
 * openapi_output path. API projects should replace this with a generator
 * that emits their actual route, request, and response contract.
 *
 * Usage: tsx scripts/generate-openapi.ts [--output path] [--project-dir path]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

const args = process.argv.slice(2)

function getArg(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1 && args[idx + 1] !== undefined) {
    return args[idx + 1] as string
  }
  return defaultValue
}

const output = getArg('output', 'openapi/schema.json')
const projectDir = getArg('project-dir', process.cwd())

interface PackageMetadata {
  title: string
  version: string
  description?: string
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

async function readPackageMetadata(): Promise<PackageMetadata> {
  const pkgPath = join(projectDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return {
      title: 'API',
      version: '0.0.0',
    }
  }

  try {
    const raw = await readFile(pkgPath, 'utf-8')
    const pkg: unknown = JSON.parse(raw)

    if (typeof pkg === 'object' && pkg !== null) {
      const data = pkg as Record<string, unknown>
      return {
        title: stringField(data['name']) ?? 'API',
        version: stringField(data['version']) ?? '0.0.0',
        description: stringField(data['description']),
      }
    }
  } catch {
    // Fall through to safe defaults.
  }

  return {
    title: 'API',
    version: '0.0.0',
  }
}

async function generateStarterOpenApi(): Promise<string> {
  const metadata = await readPackageMetadata()
  const info = {
    title: metadata.title,
    version: metadata.version,
    ...(metadata.description ? { description: metadata.description } : {}),
  }

  return `${JSON.stringify({
    openapi: '3.0.3',
    info,
    paths: {},
    components: {
      schemas: {},
    },
  }, null, 2)}\n`
}

async function main(): Promise<void> {
  console.log(`Generating OpenAPI schema to ${output}...`)
  console.log('Writing starter OpenAPI document. Replace this script to emit your real API contract.')

  const schema = await generateStarterOpenApi()
  const outputPath = isAbsolute(output) ? output : join(projectDir, output)
  const outputDir = dirname(outputPath)
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true })
  }

  await writeFile(outputPath, schema, 'utf-8')
  console.log(`Schema written to ${output}`)
}

main().catch((error) => {
  console.error('Schema generation failed:', error)
  process.exit(1)
})
