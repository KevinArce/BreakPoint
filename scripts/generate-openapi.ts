#!/usr/bin/env tsx

/**
 * OpenAPI Schema Generator
 *
 * Detects Zod schemas or falls back to ts-json-schema-generator.
 * Writes output to the configured openapi_output path.
 *
 * Usage: tsx scripts/generate-openapi.ts [--output path] [--project-dir path]
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'

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

async function detectZodSchemas(): Promise<boolean> {
  const pkgPath = join(projectDir, 'package.json')
  if (!existsSync(pkgPath)) return false

  try {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(pkgPath, 'utf-8')
    const pkg: unknown = JSON.parse(raw)

    if (typeof pkg === 'object' && pkg !== null) {
      const deps = {
        ...(pkg as Record<string, unknown>)['dependencies'] as Record<string, string> | undefined,
        ...(pkg as Record<string, unknown>)['devDependencies'] as Record<string, string> | undefined,
      }
      return 'zod-to-openapi' in deps || '@asteasolutions/zod-to-openapi' in deps
    }
  } catch {
    // Ignore parse errors
  }
  return false
}

async function generateViaZod(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['tsx', '-e', `
        const { OpenAPIRegistry, OpenApiGeneratorV3 } = require('@asteasolutions/zod-to-openapi');
        // Projects with Zod schemas should replace this starter registry with
        // imports from their own schema modules.
        const registry = new OpenAPIRegistry();
        const generator = new OpenApiGeneratorV3(registry.definitions);
        const doc = generator.generateDocument({
          openapi: '3.0.3',
          info: { title: 'API', version: '0.0.0' },
        });
        console.log(JSON.stringify(doc, null, 2));
      `],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`Zod OpenAPI generation failed: ${error.message}`))
          return
        }
        resolve(stdout)
      },
    )
  })
}

async function generateViaTsJsonSchema(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['ts-json-schema-generator', '--path', join(projectDir, 'src/**/*.ts'), '--type', '*'],
      { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error(`ts-json-schema-generator failed: ${error.message}`))
          return
        }
        resolve(stdout)
      },
    )
  })
}

async function main(): Promise<void> {
  console.log(`Generating OpenAPI schema to ${output}...`)

  let schema: string

  const hasZod = await detectZodSchemas()
  if (hasZod) {
    console.log('Detected Zod schemas — using zod-to-openapi path.')
    schema = await generateViaZod()
  } else {
    console.log('Falling back to ts-json-schema-generator.')
    schema = await generateViaTsJsonSchema()
  }

  // Ensure output directory exists
  const outputDir = dirname(output)
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true })
  }

  await writeFile(output, schema, 'utf-8')
  console.log(`Schema written to ${output}`)
}

main().catch((error) => {
  console.error('Schema generation failed:', error)
  process.exit(1)
})
