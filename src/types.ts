// ── Change Classification ───────────────────────────────────────────────────

export type ChangeClass = 'breaking' | 'non-breaking' | 'patch'

export interface ApiChange {
  id: string
  class: ChangeClass
  path?: string
  method?: string
  location?: string
  message: string
}

export interface DiffResult {
  breaking: ApiChange[]
  nonBreaking: ApiChange[]
  patch: ApiChange[]
}

// ── Version Enforcement ─────────────────────────────────────────────────────

export type BumpLevel = 'major' | 'minor' | 'patch' | 'none'

export interface VersionEnforcementResult {
  passed: boolean
  requiredBump: BumpLevel
  actualBump: BumpLevel
  baseVersion: string
  prVersion: string
  message: string
}

// ── Quality Gates ───────────────────────────────────────────────────────────

export type QualityGateStatus = 'passed' | 'failed' | 'warning' | 'skipped'

export interface QualityGateAnnotation {
  path?: string
  startLine?: number
  message: string
  level: 'notice' | 'warning' | 'failure'
}

export interface QualityGateResult {
  id: string
  name: string
  status: QualityGateStatus
  summary: string
  annotations: QualityGateAnnotation[]
}

// ── Contract Report ─────────────────────────────────────────────────────────

export interface ContractReport {
  diff: DiffResult
  version: VersionEnforcementResult
  override: {
    active: boolean
    label: string
  }
  qualityGates: QualityGateResult[]
}

// ── Package Manager ─────────────────────────────────────────────────────────

export type PackageManagerName = 'npm' | 'pnpm' | 'yarn'

export interface PackageManagerInfo {
  name: PackageManagerName
  lockfile: string
  installCommand: string
  runCommand: string
}
