import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PackageManagerInfo, PackageManagerName } from '../types.js'

const LOCKFILE_MAP: Record<string, PackageManagerName> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
}

const MANAGER_INFO: Record<PackageManagerName, PackageManagerInfo> = {
  pnpm: {
    name: 'pnpm',
    lockfile: 'pnpm-lock.yaml',
    installCommand: 'pnpm install --frozen-lockfile',
    runCommand: 'pnpm run',
  },
  yarn: {
    name: 'yarn',
    lockfile: 'yarn.lock',
    installCommand: 'yarn install --frozen-lockfile',
    runCommand: 'yarn run',
  },
  npm: {
    name: 'npm',
    lockfile: 'package-lock.json',
    installCommand: 'npm ci',
    runCommand: 'npm run',
  },
}

/**
 * Detects the package manager for a project directory.
 *
 * Detection priority:
 * 1. `packageManager` field in package.json (e.g., "pnpm@9.15.4")
 * 2. Presence of lockfiles in the directory
 * 3. Falls back to npm if no signal is found
 */
export async function detectPackageManager(
  projectDir: string,
): Promise<PackageManagerInfo> {
  // 1. Check package.json packageManager field
  const pkgPath = join(projectDir, 'package.json')
  if (existsSync(pkgPath)) {
    const raw = await readFile(pkgPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'packageManager' in parsed &&
      typeof (parsed as Record<string, unknown>)['packageManager'] === 'string'
    ) {
      const pmField = (parsed as Record<string, unknown>)['packageManager'] as string
      const managerName = pmField.split('@')[0] as string | undefined
      if (managerName && managerName in MANAGER_INFO) {
        return MANAGER_INFO[managerName as PackageManagerName]
      }
    }
  }

  // 2. Check for lockfiles
  for (const [lockfile, manager] of Object.entries(LOCKFILE_MAP)) {
    if (existsSync(join(projectDir, lockfile))) {
      return MANAGER_INFO[manager]
    }
  }

  // 3. Default to npm
  return MANAGER_INFO.npm
}

/**
 * Returns the info object for a known package manager name.
 */
export function getPackageManagerInfo(name: PackageManagerName): PackageManagerInfo {
  return MANAGER_INFO[name]
}
