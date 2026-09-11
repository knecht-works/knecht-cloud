export type EnvKind = 'ddev' | 'generated'

export type EnvSource
  = | 'default'
    | 'setting'
    | '.ddev/config.yaml'
    | 'composer.json'
    | 'mise.toml'
    | '.mise.toml'
    | '.tool-versions'
    | '.nvmrc'
    | 'package.json'
    | 'pnpm-lock.yaml'
    | 'yarn.lock'
    | 'bun.lock'
    | 'bun.lockb'
    | 'package-lock.json'

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const
export type PackageManagerName = (typeof PACKAGE_MANAGERS)[number]
export interface PackageManager {
  name: PackageManagerName
  version: string | null
}

export interface EnvSpec {
  phpVersion: string
  nodeVersion: string
  packageManager: PackageManager
  hasDb: boolean
  hosts: string[]
  devServer: string | null
  previewPort: number | null
}

export interface ResolvedField<T> {
  value: T
  source: EnvSource
}

export type ResolvedFields = { [K in keyof EnvSpec]: ResolvedField<EnvSpec[K]> }

export interface ResolvedEnv extends ResolvedFields {
  source: EnvKind
}

export interface DetectedEnv {
  source: EnvKind
  fields: Partial<ResolvedFields>
  warnings: string[]
}

export interface EnvOverrides {
  phpVersion: string | null
  nodeVersion: string | null
  packageManager: PackageManagerName | null
  devServer: string | null
  previewPort: number | null
}

// Must match the DDEV_VERSION the host runs; check on a ddev bump.
export const DDEV_PHP_VERSIONS = ['5.6', '7.0', '7.1', '7.2', '7.3', '7.4', '8.0', '8.1', '8.2', '8.3', '8.4'] as const
export const DDEV_DEFAULT_PHP = '8.4'
export const DDEV_DEFAULT_NODE = '22'
export const NODE_LTS_MAJORS = ['24', '22', '20', '18'] as const

export const NODE_VERSION_PATTERN = /^\d+(\.\d+)?$/

export const ENV_DEFAULTS: EnvSpec = {
  phpVersion: DDEV_DEFAULT_PHP,
  nodeVersion: DDEV_DEFAULT_NODE,
  packageManager: { name: 'npm', version: null },
  hasDb: false,
  hosts: [],
  devServer: null,
  previewPort: null,
}

export function projectDetectedEnv(env: { detected?: DetectedEnv } | null | undefined): DetectedEnv {
  return env?.detected ?? {
    source: 'ddev',
    fields: { hasDb: { value: true, source: '.ddev/config.yaml' } },
    warnings: [],
  }
}

export function resolveEnv(detected: DetectedEnv, overrides: EnvOverrides): ResolvedEnv {
  const detect = <K extends keyof EnvSpec>(key: K): ResolvedField<EnvSpec[K]> =>
    detected.fields[key] ?? { value: ENV_DEFAULTS[key], source: 'default' }
  const override = <K extends keyof EnvOverrides>(key: K, applies = true): ResolvedField<EnvSpec[K]> => {
    const value = overrides[key] as EnvSpec[K] | null
    return applies && value != null ? { value, source: 'setting' } : detect(key)
  }
  const generated = detected.source === 'generated'
  const packageManager = (): ResolvedField<PackageManager> => {
    const detectedPm = detect('packageManager')
    const name = overrides.packageManager
    if (!generated || name == null) return detectedPm
    return { value: { name, version: detectedPm.value.name === name ? detectedPm.value.version : null }, source: 'setting' }
  }
  return {
    source: detected.source,
    phpVersion: override('phpVersion', generated),
    nodeVersion: override('nodeVersion', generated),
    packageManager: packageManager(),
    hasDb: detect('hasDb'),
    hosts: detect('hosts'),
    devServer: override('devServer'),
    previewPort: override('previewPort'),
  }
}

export function sourceLabel(source: EnvSource): string {
  return source === 'default' ? 'default' : `from ${source}`
}

export function formatPackageManager({ name, version }: PackageManager): string {
  return version ? `${name} ${version}` : name
}

export function formatEnvSummary(env: ResolvedEnv): string {
  const devServer = env.devServer.value
    ? `dev server '${env.devServer.value}' on port ${env.previewPort.value ?? '?'}`
    : 'no dev server'
  if (env.source === 'ddev') {
    const hosts = env.hosts.value.length ? `: hosts ${env.hosts.value.join(', ')}` : ''
    return `from .ddev/config.yaml${hosts}${env.devServer.value ? `${hosts ? ',' : ':'} ${devServer}` : ''}`
  }
  return [
    `generated: PHP ${env.phpVersion.value} ${sourceLabel(env.phpVersion.source)}`,
    `Node ${env.nodeVersion.value} ${sourceLabel(env.nodeVersion.source)}`,
    `${formatPackageManager(env.packageManager.value)} ${sourceLabel(env.packageManager.source)}`,
    env.hasDb.value ? 'database' : 'no database',
    devServer,
  ].join(', ')
}
