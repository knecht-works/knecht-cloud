import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'
import { parse } from 'yaml'
import { DDEV_DEFAULT_NODE, DDEV_DEFAULT_PHP, DDEV_PHP_VERSIONS, NODE_LTS_MAJORS, PACKAGE_MANAGERS, type DetectedEnv, type EnvSource, type PackageManagerName, type ResolvedFields } from '../../shared/utils/env-spec'

// Null only for a missing file. Anything else throws: a permission problem must
// not pass as "the repo has no composer.json".
export type ReadFile = (path: string) => string | null

export type EnvFile = Exclude<EnvSource, 'default' | 'setting'>

export const ENV_DETECT_FILES: EnvFile[] = [
  '.ddev/config.yaml',
  'composer.json',
  'mise.toml',
  '.mise.toml',
  '.tool-versions',
  '.nvmrc',
  'package.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
]

export const GENERATED_MARKER = '#knecht-generated'

export function repoShipsDdevConfig(text: string | null): text is string {
  return text !== null && !text.startsWith(GENERATED_MARKER)
}

export function checkoutReader(dir: string): ReadFile {
  return (path) => {
    try {
      return readFileSync(join(dir, path), 'utf8')
    }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      throw e
    }
  }
}

export function detectEnv(readFile: ReadFile): DetectedEnv {
  const warnings: string[] = []
  const fields: Partial<ResolvedFields> = {}

  const pm = detectPackageManager(readFile, warnings)
  if (pm) fields.packageManager = pm

  const ddev = readFile('.ddev/config.yaml')
  if (repoShipsDdevConfig(ddev)) {
    const cfg = parseDdevConfig(ddev)
    if (!cfg) {
      warnings.push('.ddev/config.yaml could not be parsed; ddev may refuse to start')
      fields.hasDb = { value: true, source: '.ddev/config.yaml' }
      return { source: 'ddev', fields, warnings }
    }
    fields.hasDb = { value: cfg.hasDb, source: '.ddev/config.yaml' }
    fields.hosts = { value: cfg.hosts, source: '.ddev/config.yaml' }
    if (cfg.phpVersion) fields.phpVersion = { value: cfg.phpVersion, source: '.ddev/config.yaml' }
    if (cfg.nodeVersion) fields.nodeVersion = { value: cfg.nodeVersion, source: '.ddev/config.yaml' }
    return { source: 'ddev', fields, warnings }
  }

  const php = detectPhp(readFile, warnings)
  if (php) fields.phpVersion = php
  const node = detectNode(readFile, warnings)
  if (node) fields.nodeVersion = node
  return { source: 'generated', fields, warnings }
}

export interface DdevConfigFile {
  generated: boolean
  type: string | null
  webserver: string
  hosts: string[] // primary first, then additional_hostnames and additional_fqdns
  hasDb: boolean
  dbType: string | null
  dbVersion: string | null
  phpVersion: string | null
  nodeVersion: string | null
}

export function parseDdevConfig(text: string): DdevConfigFile | null {
  let cfg: {
    name?: string
    type?: string
    webserver_type?: string
    project_tld?: string
    additional_hostnames?: string[]
    additional_fqdns?: string[]
    omit_containers?: string[]
    php_version?: string | number
    nodejs_version?: string | number
    database?: { type?: string, version?: string | number }
  } | null
  try {
    cfg = parse(text)
  }
  catch {
    return null
  }
  if (!cfg || typeof cfg !== 'object') return null
  const tld = cfg.project_tld || 'ddev.site'
  const hosts = cfg.name
    ? [
        `${cfg.name}.${tld}`,
        ...(Array.isArray(cfg.additional_hostnames) ? cfg.additional_hostnames : []).map(h => `${h}.${tld}`),
        ...(Array.isArray(cfg.additional_fqdns) ? cfg.additional_fqdns : []),
      ]
    : []
  return {
    generated: text.startsWith(GENERATED_MARKER),
    type: cfg.type ?? null,
    webserver: cfg.webserver_type ?? 'nginx-fpm',
    hosts,
    hasDb: !(Array.isArray(cfg.omit_containers) && cfg.omit_containers.includes('db')),
    dbType: cfg.database?.type ?? null,
    dbVersion: str(cfg.database?.version),
    phpVersion: str(cfg.php_version),
    nodeVersion: str(cfg.nodejs_version),
  }
}

const str = (v: unknown): string | null => (v == null ? null : String(v))

function detectPhp(readFile: ReadFile, warnings: string[]): ResolvedFields['phpVersion'] | null {
  const text = readFile('composer.json')
  if (text === null) return null
  let constraint: unknown
  try {
    constraint = (JSON.parse(text) as { require?: Record<string, unknown> }).require?.php
  }
  catch {
    warnings.push(`composer.json could not be parsed, using PHP ${DDEV_DEFAULT_PHP}`)
    return null
  }
  if (typeof constraint !== 'string' || !constraint.trim()) return null
  const version = normalizePhpConstraint(constraint)
  if (!version) {
    warnings.push(`composer.json requires php '${constraint}', which no ddev PHP version satisfies, using PHP ${DDEV_DEFAULT_PHP}`)
    return null
  }
  return { value: version, source: 'composer.json' }
}

// Composer syntax differs from npm semver: two-part `~8.1` means >=8.1 <9.0
// (caret in npm), comma is AND, a single pipe is OR.
export function normalizePhpConstraint(constraint: string): string | null {
  const range = constraint
    .trim()
    .replace(/\|+/g, ' || ')
    .replace(/,/g, ' ')
    .replace(/~(\d+\.\d+)(?![.\d])/g, '^$1')
  if (!semver.validRange(range)) return null
  const best = semver.maxSatisfying(DDEV_PHP_VERSIONS.map(v => `${v}.0`), range)
  return best ? best.replace(/\.0$/, '') : null
}

const NODE_LTS_NAMES: Record<string, string> = {
  hydrogen: '18',
  iron: '20',
  jod: '22',
  krypton: '24',
}

function detectNode(readFile: ReadFile, warnings: string[]): ResolvedFields['nodeVersion'] | null {
  const candidates: { source: EnvSource, read: (text: string) => string | null }[] = [
    { source: 'mise.toml', read: miseNode },
    { source: '.mise.toml', read: miseNode },
    { source: '.tool-versions', read: toolVersionsNode },
    { source: '.nvmrc', read: t => t.trim() },
    { source: 'package.json', read: enginesNode },
  ]
  for (const { source, read } of candidates) {
    const text = readFile(source)
    if (text === null) continue
    let raw: string | null
    try {
      raw = read(text)
    }
    catch {
      warnings.push(`${source} could not be parsed, using Node ${DDEV_DEFAULT_NODE}`)
      continue
    }
    if (!raw) continue
    const version = source === 'package.json' ? normalizeNodeConstraint(raw) : normalizeNodeVersion(raw)
    if (!version) {
      warnings.push(`${source} names Node '${raw}', which Knecht cannot pin, using Node ${DDEV_DEFAULT_NODE}`)
      return null
    }
    return { value: version, source }
  }
  return null
}

function miseNode(text: string): string | null {
  let inTools = false
  for (const line of text.split('\n')) {
    const section = /^\s*\[([^\]]+)\]/.exec(line)
    if (section) {
      inTools = section[1]!.trim() === 'tools'
      continue
    }
    if (!inTools) continue
    const m = /^\s*(?:node|nodejs)\s*=\s*"([^"]*)"/.exec(line)
    if (m) return m[1]!
  }
  return null
}

function toolVersionsNode(text: string): string | null {
  for (const line of text.split('\n')) {
    const m = /^\s*(?:nodejs|node)\s+(\S+)/.exec(line)
    if (m) return m[1]!
  }
  return null
}

function enginesNode(text: string): string | null {
  const node = (JSON.parse(text) as { engines?: { node?: unknown } }).engines?.node
  return typeof node === 'string' && node.trim() ? node.trim() : null
}

// Major.minor at most, which keeps ddev's `n` install predictable. `lts/*`,
// `latest` and the like are moving targets: null, so the default applies.
export function normalizeNodeVersion(raw: string): string | null {
  const value = raw.trim()
  const lts = /^lts\/([a-z]+)$/i.exec(value)
  if (lts) return NODE_LTS_NAMES[lts[1]!.toLowerCase()] ?? null
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.\d+)?$/.exec(value)
  if (!m) return null
  return m[2] === undefined ? m[1]! : `${m[1]}.${m[2]}`
}

export function normalizeNodeConstraint(constraint: string): string | null {
  if (!semver.validRange(constraint)) return null
  if (semver.satisfies(`${DDEV_DEFAULT_NODE}.0.0`, constraint)) return DDEV_DEFAULT_NODE
  const best = semver.maxSatisfying(NODE_LTS_MAJORS.map(v => `${v}.0.0`), constraint)
  return best ? best.split('.')[0]! : null
}

const LOCKFILES: { source: EnvSource, name: PackageManagerName }[] = [
  { source: 'pnpm-lock.yaml', name: 'pnpm' },
  { source: 'yarn.lock', name: 'yarn' },
  { source: 'bun.lock', name: 'bun' },
  { source: 'bun.lockb', name: 'bun' },
  { source: 'package-lock.json', name: 'npm' },
]

function detectPackageManager(readFile: ReadFile, warnings: string[]): ResolvedFields['packageManager'] | null {
  const pkg = readFile('package.json')
  if (pkg !== null) {
    let field: unknown
    try {
      field = (JSON.parse(pkg) as { packageManager?: unknown }).packageManager
    }
    catch {
      warnings.push('package.json could not be parsed, using npm')
      field = undefined
    }
    if (typeof field === 'string' && field.trim()) {
      const [name, spec] = field.trim().split('@')
      if (!isPackageManager(name)) {
        warnings.push(`package.json names package manager '${field}', which Knecht does not know, using npm`)
        return null
      }
      // semver.valid normalizes: a stray newline must not reach the Dockerfile.
      const rawVersion = spec?.split('+')[0] || null
      const version = rawVersion ? semver.valid(rawVersion) : null
      if (rawVersion && !version) {
        warnings.push(`package.json pins ${name} to '${spec}', which is not a version, using ${name} without a pin`)
      }
      return { value: { name, version }, source: 'package.json' }
    }
  }
  for (const { source, name } of LOCKFILES) {
    if (readFile(source) !== null) return { value: { name, version: null }, source }
  }
  return null
}

const isPackageManager = (name: string | undefined): name is PackageManagerName =>
  PACKAGE_MANAGERS.includes(name as PackageManagerName)
