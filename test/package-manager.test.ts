import { describe, expect, it, vi, beforeEach } from 'vitest'
import { detectPackageManager, getPackageManagerInfo } from '../src/lib/package-manager.js'

// Mock fs modules
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const mockExistsSync = vi.mocked(existsSync)
const mockReadFile = vi.mocked(readFile)

describe('detectPackageManager', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('detects pnpm from packageManager field', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValue(JSON.stringify({ packageManager: 'pnpm@9.15.4' }))

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('pnpm')
    expect(result.installCommand).toBe('pnpm install --frozen-lockfile')
  })

  it('detects yarn from packageManager field', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValue(JSON.stringify({ packageManager: 'yarn@4.0.0' }))

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('yarn')
  })

  it('detects npm from packageManager field', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValue(JSON.stringify({ packageManager: 'npm@10.0.0' }))

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('npm')
  })

  it('detects pnpm from lockfile when no packageManager field', async () => {
    mockExistsSync.mockImplementation((path) => {
      const p = String(path)
      if (p.endsWith('package.json')) return true
      if (p.endsWith('pnpm-lock.yaml')) return true
      return false
    })
    mockReadFile.mockResolvedValue(JSON.stringify({ name: 'test' }))

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('pnpm')
  })

  it('detects yarn from lockfile', async () => {
    mockExistsSync.mockImplementation((path) => {
      const p = String(path)
      if (p.endsWith('package.json')) return true
      if (p.endsWith('yarn.lock')) return true
      return false
    })
    mockReadFile.mockResolvedValue(JSON.stringify({ name: 'test' }))

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('yarn')
  })

  it('detects npm from lockfile', async () => {
    mockExistsSync.mockImplementation((path) => {
      const p = String(path)
      if (p.endsWith('package.json')) return true
      if (p.endsWith('package-lock.json')) return true
      return false
    })
    mockReadFile.mockResolvedValue(JSON.stringify({ name: 'test' }))

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('npm')
  })

  it('defaults to npm when no signals are found', async () => {
    mockExistsSync.mockReturnValue(false)

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('npm')
    expect(result.installCommand).toBe('npm ci')
  })

  it('ignores unrecognized packageManager names', async () => {
    mockExistsSync.mockImplementation((path) => {
      const p = String(path)
      if (p.endsWith('package.json')) return true
      return false
    })
    mockReadFile.mockResolvedValue(JSON.stringify({ packageManager: 'bun@1.0.0' }))

    const result = await detectPackageManager('/project')
    expect(result.name).toBe('npm')
  })
})

describe('getPackageManagerInfo', () => {
  it('returns info for pnpm', () => {
    const info = getPackageManagerInfo('pnpm')
    expect(info.name).toBe('pnpm')
    expect(info.lockfile).toBe('pnpm-lock.yaml')
    expect(info.runCommand).toBe('pnpm run')
  })

  it('returns info for yarn', () => {
    const info = getPackageManagerInfo('yarn')
    expect(info.name).toBe('yarn')
    expect(info.lockfile).toBe('yarn.lock')
  })

  it('returns info for npm', () => {
    const info = getPackageManagerInfo('npm')
    expect(info.name).toBe('npm')
    expect(info.lockfile).toBe('package-lock.json')
  })
})
